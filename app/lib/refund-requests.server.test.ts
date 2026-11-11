import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "~/db/schema";
import { createTestDb, seedBaseData } from "~/test/setup";

const testDb = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createTestDb> | undefined,
}));

vi.mock("~/db", () => ({
  get db() {
    if (!testDb.current) throw new Error("Test database not created");
    return testDb.current;
  },
}));

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string }[]);

vi.mock("~/lib/email.server", () => ({
  sendEmail: (email: { to: string; subject: string }) => sentEmails.push(email),
}));

import { isEnrolled } from "./enrollments.server";
import {
  approveRefundRequest,
  checkRefundRequestEligibility,
  checkSeatCodeRedeemable,
  createRefundOverride,
  declineRefundRequest,
  hasIssuedRefundForCourse,
  isReadOnly,
  listRefundRequestsForPurchaser,
  markRefundFailed,
  markRefundIssued,
  restoreRefundedAccess,
  submitRefundRequest,
} from "./refund-requests.server";

// ─── Fixtures ───

type Db = ReturnType<typeof createTestDb>;
let db: Db;
let base: ReturnType<typeof seedBaseData>;
let lessonIds: number[];

function daysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function createUser(name: string, role = schema.UserRole.Student) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function createLessons(count: number) {
  const mod = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module", position: 1 })
    .returning()
    .get();
  return Array.from({ length: count }, (_, i) =>
    db
      .insert(schema.lessons)
      .values({ moduleId: mod.id, title: `Lesson ${i + 1}`, position: i + 1 })
      .returning()
      .get().id
  );
}

function buyIndividually(
  userId: number,
  options: { amountPaid?: number; createdAt?: string } = {}
) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: options.amountPaid ?? 7900,
      createdAt: options.createdAt ?? daysAgo(3),
    })
    .returning()
    .get();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
  return purchase;
}

function buySeats(
  userId: number,
  seats: number,
  options: { amountPaid?: number; createdAt?: string } = {}
) {
  const purchase = db
    .insert(schema.purchases)
    .values({
      userId,
      courseId: base.course.id,
      amountPaid: options.amountPaid ?? 50000,
      createdAt: options.createdAt ?? daysAgo(3),
    })
    .returning()
    .get();
  const team = db.insert(schema.teams).values({}).returning().get();
  const coupons = Array.from({ length: seats }, (_, i) =>
    db
      .insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: `CODE-${purchase.id}-${i}`,
        purchaseId: purchase.id,
      })
      .returning()
      .get()
  );
  return { purchase, coupons };
}

function redeemSeat(couponId: number, userId: number) {
  db.update(schema.coupons)
    .set({ redeemedByUserId: userId, redeemedAt: daysAgo(1) })
    .where(eq(schema.coupons.id, couponId))
    .run();
  db.insert(schema.enrollments)
    .values({ userId, courseId: base.course.id })
    .run();
}

function completeLessons(userId: number, count: number) {
  for (const lessonId of lessonIds.slice(0, count)) {
    db.insert(schema.lessonProgress)
      .values({
        userId,
        lessonId,
        status: schema.LessonProgressStatus.Completed,
        completedAt: daysAgo(1),
      })
      .run();
  }
}

beforeEach(() => {
  testDb.current = createTestDb();
  db = testDb.current;
  base = seedBaseData(db);
  lessonIds = createLessons(10);
  sentEmails.length = 0;
});

// ─── Submitting a Refund Request ───

describe("submitting a Refund Request", () => {
  it("promises the Amount Paid, not the current Course Price", () => {
    db.update(schema.courses).set({ price: 9900 }).run();
    const purchase = buyIndividually(base.user.id, { amountPaid: 7900 });

    const eligibility = checkRefundRequestEligibility(base.user.id, purchase.id);

    expect(eligibility).toMatchObject({ eligible: true, amount: 7900 });
  });

  it("stores the promised amount and emails the Purchaser", () => {
    const purchase = buyIndividually(base.user.id, { amountPaid: 7900 });

    const result = submitRefundRequest(base.user.id, purchase.id, "Not what I expected.");

    expect(result).toMatchObject({
      ok: true,
      refundRequest: { amount: 7900, status: schema.RefundRequestStatus.Open },
    });
    expect(sentEmails).toEqual([
      expect.objectContaining({ to: "test@example.com", subject: expect.stringContaining("received") }),
    ]);
  });

  it("refunds the full Amount Paid of a Team Purchase with no Redeemed seats", () => {
    const { purchase } = buySeats(base.user.id, 5, { amountPaid: 50000 });

    expect(checkRefundRequestEligibility(base.user.id, purchase.id)).toMatchObject({
      eligible: true,
      amount: 50000,
    });
  });

  it("does not accept a request for a Team Purchase with a Redeemed seat", () => {
    const { purchase, coupons } = buySeats(base.user.id, 5);
    redeemSeat(coupons[0].id, createUser("Ava").id);

    expect(checkRefundRequestEligibility(base.user.id, purchase.id)).toEqual({
      eligible: false,
      reason: "redeemed_seat_code",
    });
  });

  it("does not accept a second request once one was Declined", () => {
    const purchase = buyIndividually(base.user.id);
    submitRefundRequest(base.user.id, purchase.id, "Not what I expected.");
    const admin = createUser("Admin", schema.UserRole.Admin);
    const [request] = listRefundRequestsForPurchaser(base.user.id, null);
    declineRefundRequest(request.id, admin.id, "You have already watched most of it.");

    expect(submitRefundRequest(base.user.id, purchase.id, "Please reconsider.")).toEqual({
      ok: false,
      reason: "declined_refund_request",
    });
  });

  it("does not accept a request outside the Refund Window", () => {
    const purchase = buyIndividually(base.user.id, { createdAt: daysAgo(15) });

    expect(checkRefundRequestEligibility(base.user.id, purchase.id)).toEqual({
      eligible: false,
      reason: "outside_window",
    });
  });

  it("does not accept a request once half the lessons are Completed", () => {
    const purchase = buyIndividually(base.user.id);
    completeLessons(base.user.id, 5);

    expect(checkRefundRequestEligibility(base.user.id, purchase.id)).toEqual({
      eligible: false,
      reason: "too_much_completed",
    });
  });
});

// ─── Deciding and refund status ───

function openRequest(userId: number, purchaseId: number) {
  const result = submitRefundRequest(userId, purchaseId, "Not what I expected.");
  if (!result.ok) throw new Error(`Could not submit: ${result.reason}`);
  return result.refundRequest;
}

describe("Read-only Access while a refund is in progress", () => {
  it("makes the Student read-only while their request is Open", () => {
    const purchase = buyIndividually(base.user.id);
    expect(isReadOnly(base.user.id, base.course.id)).toBe(false);

    openRequest(base.user.id, purchase.id);

    expect(isReadOnly(base.user.id, base.course.id)).toBe(true);
  });

  it("restores full access when the request is Declined", () => {
    const admin = createUser("Admin", schema.UserRole.Admin);
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);

    declineRefundRequest(request.id, admin.id, "You have already watched most of it.");

    expect(isReadOnly(base.user.id, base.course.id)).toBe(false);
  });
});

describe("approving and issuing a Refund", () => {
  let admin: typeof schema.users.$inferSelect;

  beforeEach(() => {
    admin = createUser("Admin", schema.UserRole.Admin);
  });

  it("creates a Pending Refund for the stored amount and keeps the Student read-only", () => {
    const purchase = buyIndividually(base.user.id, { amountPaid: 7900 });
    const request = openRequest(base.user.id, purchase.id);
    sentEmails.length = 0;

    expect(approveRefundRequest(request.id, admin.id)).toEqual({ ok: true });

    expect(listRefundRequestsForPurchaser(base.user.id, null)[0]).toMatchObject({
      status: schema.RefundRequestStatus.Approved,
      refundStatus: schema.RefundStatus.Pending,
      amount: 7900,
    });
    expect(isReadOnly(base.user.id, base.course.id)).toBe(true);
    expect(sentEmails).toEqual([
      expect.objectContaining({ to: "test@example.com", subject: expect.stringContaining("approved") }),
    ]);
  });

  it("never moves an Approved request back to Declined", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);
    approveRefundRequest(request.id, admin.id);

    expect(declineRefundRequest(request.id, admin.id, "Changed my mind, sorry.")).toMatchObject({
      ok: false,
    });
  });

  it("ends Content Access when the Refund is Issued", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);
    approveRefundRequest(request.id, admin.id);
    sentEmails.length = 0;

    expect(markRefundIssued(request.id)).toEqual({ ok: true });

    expect(isEnrolled(base.user.id, base.course.id)).toBe(false);
    expect(isReadOnly(base.user.id, base.course.id)).toBe(false);
    expect(sentEmails).toEqual([
      expect.objectContaining({ to: "test@example.com", subject: expect.stringContaining("sent") }),
    ]);
  });

  it("keeps a Failed Refund Approved and read-only, and can still Issue it later", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);
    approveRefundRequest(request.id, admin.id);

    expect(markRefundFailed(request.id)).toEqual({ ok: true });
    expect(listRefundRequestsForPurchaser(base.user.id, null)[0]).toMatchObject({
      status: schema.RefundRequestStatus.Approved,
      refundStatus: schema.RefundStatus.Failed,
    });
    expect(isReadOnly(base.user.id, base.course.id)).toBe(true);

    expect(markRefundIssued(request.id)).toEqual({ ok: true });
    expect(isEnrolled(base.user.id, base.course.id)).toBe(false);
  });

  it("cannot mark an Open request as Issued", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);

    expect(markRefundIssued(request.id)).toMatchObject({ ok: false });
  });

  it("restores access by hand after the Refund is Issued", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);
    approveRefundRequest(request.id, admin.id);
    markRefundIssued(request.id);

    expect(restoreRefundedAccess(request.id)).toEqual({ ok: true });

    expect(isEnrolled(base.user.id, base.course.id)).toBe(true);
    expect(isReadOnly(base.user.id, base.course.id)).toBe(false);
  });

  it("does not let a Student who was refunded request a refund for buying again", () => {
    const first = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, first.id);
    approveRefundRequest(request.id, admin.id);
    markRefundIssued(request.id);

    const second = buyIndividually(base.user.id);

    expect(hasIssuedRefundForCourse(base.user.id, base.course.id)).toBe(true);
    expect(checkRefundRequestEligibility(base.user.id, second.id)).toEqual({
      eligible: false,
      reason: "previously_refunded",
    });
  });
});

// ─── Seat Codes ───

describe("Seat Codes of a Team Purchase", () => {
  it("cannot be Redeemed while the request is Open, and can again once Declined", () => {
    const admin = createUser("Admin", schema.UserRole.Admin);
    const { purchase, coupons } = buySeats(base.user.id, 2);
    const request = openRequest(base.user.id, purchase.id);

    expect(checkSeatCodeRedeemable(coupons[0].id)).toEqual({
      redeemable: false,
      reason: "refund_in_progress",
    });

    declineRefundRequest(request.id, admin.id, "Your team is already using it.");

    expect(checkSeatCodeRedeemable(coupons[0].id)).toEqual({ redeemable: true });
  });

  it("become permanently invalid once the Refund is Issued", () => {
    const admin = createUser("Admin", schema.UserRole.Admin);
    const { purchase, coupons } = buySeats(base.user.id, 2);
    const request = openRequest(base.user.id, purchase.id);
    approveRefundRequest(request.id, admin.id);
    markRefundIssued(request.id);

    expect(checkSeatCodeRedeemable(coupons[1].id)).toEqual({
      redeemable: false,
      reason: "invalidated",
    });
  });
});

// ─── Refund Override ───

describe("Refund Override", () => {
  let admin: typeof schema.users.$inferSelect;

  beforeEach(() => {
    admin = createUser("Admin", schema.UserRole.Admin);
  });

  it("approves a Declined request outside the Refund Window", () => {
    const purchase = buyIndividually(base.user.id, { createdAt: daysAgo(10) });
    const request = openRequest(base.user.id, purchase.id);
    declineRefundRequest(request.id, admin.id, "We need more information.");
    db.update(schema.purchases).set({ createdAt: daysAgo(40) }).run();

    expect(approveRefundRequest(request.id, admin.id)).toEqual({ ok: true });
    expect(isReadOnly(base.user.id, base.course.id)).toBe(true);
  });

  it("still applies the progress limits", () => {
    const purchase = buyIndividually(base.user.id);
    const request = openRequest(base.user.id, purchase.id);
    declineRefundRequest(request.id, admin.id, "We need more information.");
    completeLessons(base.user.id, 6);

    expect(approveRefundRequest(request.id, admin.id)).toMatchObject({ ok: false });
  });

  it("creates a New refund, already Approved, for a purchase with no request", () => {
    const purchase = buyIndividually(base.user.id, { createdAt: daysAgo(60), amountPaid: 4900 });

    expect(createRefundOverride(purchase.id, admin.id, "Charged twice by mistake.")).toEqual({
      ok: true,
    });

    expect(listRefundRequestsForPurchaser(base.user.id, null)).toEqual([
      expect.objectContaining({
        status: schema.RefundRequestStatus.Approved,
        refundStatus: schema.RefundStatus.Pending,
        amount: 4900,
        reason: "Charged twice by mistake.",
      }),
    ]);
    expect(createRefundOverride(purchase.id, admin.id, "Again, please.")).toMatchObject({
      ok: false,
    });
  });

  describe("a Team Purchase with Redeemed seats", () => {
    // $500 for 5 seats: Ava and Noah completed the course, Isla is below the
    // progress limits and two seats are unredeemed.
    let ava: typeof schema.users.$inferSelect;
    let noah: typeof schema.users.$inferSelect;
    let isla: typeof schema.users.$inferSelect;
    let purchaseId: number;

    beforeEach(() => {
      ava = createUser("Ava");
      noah = createUser("Noah");
      isla = createUser("Isla");
      const { purchase, coupons } = buySeats(base.user.id, 5, { amountPaid: 50000 });
      purchaseId = purchase.id;
      redeemSeat(coupons[0].id, ava.id);
      redeemSeat(coupons[1].id, noah.id);
      redeemSeat(coupons[2].id, isla.id);
      completeLessons(ava.id, 10);
      completeLessons(noah.id, 10);
      completeLessons(isla.id, 1);
      sentEmails.length = 0;
    });

    it("refunds only the Refundable Seats", () => {
      createRefundOverride(purchaseId, admin.id, "The team was disbanded.");

      const [request] = listRefundRequestsForPurchaser(base.user.id, null);
      expect(request.amount).toBe(30000);
      expect(request.seatBreakdown?.map((seat) => [seat.holderName, seat.refunded])).toEqual([
        ["Ava", false],
        ["Noah", false],
        ["Isla", true],
        [null, true],
        [null, true],
      ]);
    });

    it("makes only holders of Refundable Seats read-only, and emails only them", () => {
      createRefundOverride(purchaseId, admin.id, "The team was disbanded.");

      expect(isReadOnly(isla.id, base.course.id)).toBe(true);
      expect(isReadOnly(ava.id, base.course.id)).toBe(false);
      expect(sentEmails.map((email) => email.to).sort()).toEqual([
        "isla@example.com",
        "test@example.com",
      ]);
    });

    it("ends access only for holders of Refundable Seats when Issued", () => {
      createRefundOverride(purchaseId, admin.id, "The team was disbanded.");
      const [request] = listRefundRequestsForPurchaser(base.user.id, null);
      sentEmails.length = 0;

      markRefundIssued(request.id);

      expect(isEnrolled(isla.id, base.course.id)).toBe(false);
      expect(isEnrolled(ava.id, base.course.id)).toBe(true);
      expect(isEnrolled(noah.id, base.course.id)).toBe(true);
      expect(sentEmails.map((email) => email.to).sort()).toEqual([
        "isla@example.com",
        "test@example.com",
      ]);
    });
  });
});
