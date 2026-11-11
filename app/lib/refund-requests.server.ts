import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  RefundStatus,
  users,
  videoWatchEvents,
  type SeatBreakdownEntry,
} from "~/db/schema";
import { sendEmail } from "~/lib/email.server";
import {
  buildRefundApprovedEmail,
  buildRefundDeclinedEmail,
  buildRefundFailedEmail,
  buildRefundIssuedEmail,
  buildRefundRequestReceivedEmail,
  buildSeatRefundApprovedEmail,
  buildSeatRefundIssuedEmail,
} from "~/lib/emails";
import { restoreEnrollment, revokeEnrollment } from "~/lib/enrollments.server";
import {
  calculateTeamRefund,
  type SeatRefundBlocker,
  type TeamSeat,
} from "~/lib/team-refund";

// ─── Refund Requests ───
// One place for the life of a Refund Request: who may submit one and for how
// much, what it means for Content Access while it is decided, and the Admin's
// decisions and refund status updates. See GLOSSARY.md → "Refund requests and
// refunds", ADR 0001 and ADR 0002.
//
// Uses positional parameters (project convention).

export const REFUND_REQUEST_WINDOW_DAYS = 14;
const MAX_SECONDS_WATCHED = 2 * 60 * 60;
const MAX_COURSE_PROGRESS = 0.5;

type Purchase = typeof purchases.$inferSelect;

// ─── Purchases ───

function getPurchase(purchaseId: number) {
  return db.select().from(purchases).where(eq(purchases.id, purchaseId)).get();
}

function getSeatCodes(purchaseId: number) {
  return db
    .select()
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .orderBy(coupons.id)
    .all();
}

function isTeamPurchase(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(eq(coupons.purchaseId, purchaseId))
    .get();
}

/** The Purchaser's latest Purchase of the course for themselves. */
export function findIndividualPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        sql`not exists (select 1 from ${coupons} where ${coupons.purchaseId} = ${purchases.id})`
      )
    )
    .orderBy(desc(purchases.createdAt), desc(purchases.id))
    .get();
}

// ─── Progress limits ───

function getLessonIdsForCourse(courseId: number): number[] {
  return db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(modules.courseId, courseId))
    .all()
    .map((row) => row.id);
}

function getCompletedLessonCount(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, userId),
        eq(lessonProgress.status, LessonProgressStatus.Completed),
        inArray(lessonProgress.lessonId, lessonIds)
      )
    )
    .get();

  return result?.count ?? 0;
}

function getSecondsWatched(userId: number, lessonIds: number[]) {
  if (lessonIds.length === 0) return 0;

  const furthestPerLesson = db
    .select({
      furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
    })
    .from(videoWatchEvents)
    .where(
      and(
        eq(videoWatchEvents.userId, userId),
        inArray(videoWatchEvents.lessonId, lessonIds)
      )
    )
    .groupBy(videoWatchEvents.lessonId)
    .all();

  return furthestPerLesson.reduce((total, row) => total + row.furthest, 0);
}

function hasCompletedCourse(userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        isNotNull(enrollments.completedAt)
      )
    )
    .get();
}

export type StudentProgress = {
  completedLessons: number;
  totalLessons: number;
  secondsWatched: number;
};

export function getStudentProgress(
  userId: number,
  courseId: number
): StudentProgress {
  const lessonIds = getLessonIdsForCourse(courseId);
  return {
    completedLessons: getCompletedLessonCount(userId, lessonIds),
    totalLessons: lessonIds.length,
    secondsWatched: getSecondsWatched(userId, lessonIds),
  };
}

/**
 * Why this Student's progress rules out a Refund, or null if they are below
 * the progress limits.
 */
function checkProgressLimits(
  userId: number,
  courseId: number
): SeatRefundBlocker | null {
  if (hasCompletedCourse(userId, courseId)) return "completed_course";

  const progress = getStudentProgress(userId, courseId);

  if (
    progress.totalLessons > 0 &&
    progress.completedLessons / progress.totalLessons >= MAX_COURSE_PROGRESS
  ) {
    return progress.completedLessons === progress.totalLessons
      ? "completed_course"
      : "too_much_completed";
  }

  if (progress.secondsWatched >= MAX_SECONDS_WATCHED) {
    return "too_much_watched";
  }

  return null;
}

// ─── Refund Eligibility ───

export type RefundRequestIneligibility =
  | "no_purchase"
  | "open_refund_request"
  | "approved_refund_request"
  | "declined_refund_request"
  | "redeemed_seat_code"
  | "previously_refunded"
  | "outside_window"
  | "too_much_completed"
  | "too_much_watched";

export type RefundRequestEligibility =
  | {
      eligible: true;
      purchase: Purchase;
      amount: number;
      lastDayInWindow: string;
    }
  | { eligible: false; reason: RefundRequestIneligibility };

function getRefundRequestForPurchase(purchaseId: number) {
  return db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.purchaseId, purchaseId))
    .orderBy(desc(refundRequests.id))
    .get();
}

// The window is counted in whole days, not hours — someone who purchases at
// 23:00 should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

function lastDayInWindow(purchase: Purchase) {
  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_REQUEST_WINDOW_DAYS);
  return calendarDay(windowEnd);
}

function isInsideWindow(purchase: Purchase) {
  const today = calendarDay(new Date());
  return (
    today >= calendarDay(new Date(purchase.createdAt)) &&
    today <= lastDayInWindow(purchase)
  );
}

/**
 * May this Purchaser submit a Refund Request for this Purchase themselves,
 * and for how much? Checked once, when the request is submitted.
 */
export function checkRefundRequestEligibility(
  userId: number,
  purchaseId: number
): RefundRequestEligibility {
  const purchase = getPurchase(purchaseId);

  if (!purchase || purchase.userId !== userId) {
    return { eligible: false, reason: "no_purchase" };
  }

  const existing = getRefundRequestForPurchase(purchase.id);
  if (existing?.status === RefundRequestStatus.Open) {
    return { eligible: false, reason: "open_refund_request" };
  }
  if (existing?.status === RefundRequestStatus.Approved) {
    return { eligible: false, reason: "approved_refund_request" };
  }
  if (existing?.status === RefundRequestStatus.Declined) {
    return { eligible: false, reason: "declined_refund_request" };
  }

  const team = isTeamPurchase(purchase.id);

  // Once a Seat Code from a Team Purchase has been Redeemed, that Seat belongs
  // to its recipient — the Purchaser cannot hand it back on their own.
  if (team && getSeatCodes(purchase.id).some((code) => code.redeemedAt)) {
    return { eligible: false, reason: "redeemed_seat_code" };
  }

  if (hasIssuedRefundForCourse(userId, purchase.courseId)) {
    return { eligible: false, reason: "previously_refunded" };
  }

  if (!isInsideWindow(purchase)) {
    return { eligible: false, reason: "outside_window" };
  }

  if (!team) {
    const blocker = checkProgressLimits(userId, purchase.courseId);
    if (blocker === "too_much_watched") {
      return { eligible: false, reason: "too_much_watched" };
    }
    if (blocker) return { eligible: false, reason: "too_much_completed" };
  }

  return {
    eligible: true,
    purchase,
    amount: purchase.amountPaid,
    lastDayInWindow: lastDayInWindow(purchase),
  };
}

// ─── Submitting ───

type RefundRequest = typeof refundRequests.$inferSelect;

function getUser(userId: number) {
  return db.select().from(users).where(eq(users.id, userId)).get();
}

function getCourse(courseId: number) {
  return db.select().from(courses).where(eq(courses.id, courseId)).get();
}

export type SubmitRefundRequestResult =
  | { ok: true; refundRequest: RefundRequest }
  | { ok: false; reason: RefundRequestIneligibility };

export function submitRefundRequest(
  userId: number,
  purchaseId: number,
  reason: string
): SubmitRefundRequestResult {
  const eligibility = checkRefundRequestEligibility(userId, purchaseId);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };

  const refundRequest = db
    .insert(refundRequests)
    .values({
      purchaseId,
      status: RefundRequestStatus.Open,
      reason,
      amount: eligibility.amount,
    })
    .returning()
    .get();

  const purchaser = getUser(userId);
  const course = getCourse(eligibility.purchase.courseId);
  if (purchaser && course) {
    sendEmail(
      buildRefundRequestReceivedEmail({
        purchaser,
        courseTitle: course.title,
        amount: refundRequest.amount,
      })
    );
  }

  return { ok: true, refundRequest };
}

// ─── Admin decisions ───

export type RefundActionResult = { ok: true } | { ok: false; error: string };

function getRefundRequest(refundRequestId: number) {
  return db
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.id, refundRequestId))
    .get();
}

/** The Purchaser and course a Refund Request is about, for emails. */
function getParties(refundRequest: RefundRequest) {
  const purchase = getPurchase(refundRequest.purchaseId);
  if (!purchase) return undefined;
  const purchaser = getUser(purchase.userId);
  const course = getCourse(purchase.courseId);
  if (!purchaser || !course) return undefined;
  return { purchase, purchaser, course };
}

export function declineRefundRequest(
  refundRequestId: number,
  adminId: number,
  declineReason: string
): RefundActionResult {
  const refundRequest = getRefundRequest(refundRequestId);
  if (!refundRequest) return { ok: false, error: "Refund request not found." };
  if (refundRequest.status !== RefundRequestStatus.Open) {
    return { ok: false, error: "Only an open refund request can be declined." };
  }

  db.update(refundRequests)
    .set({
      status: RefundRequestStatus.Declined,
      declineReason,
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: adminId,
    })
    .where(eq(refundRequests.id, refundRequest.id))
    .run();

  const parties = getParties(refundRequest);
  if (parties) {
    sendEmail(
      buildRefundDeclinedEmail({
        purchaser: parties.purchaser,
        courseTitle: parties.course.title,
        declineReason,
      })
    );
  }

  return { ok: true };
}

// ─── The Purchaser's view ───

export type PurchaserRefundRequest = {
  id: number;
  purchaseId: number;
  courseTitle: string;
  courseSlug: string;
  amount: number;
  status: RefundRequestStatus;
  refundStatus: RefundStatus | null;
  reason: string;
  declineReason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  seatBreakdown: SeatBreakdownEntry[] | null;
};

/**
 * Every Refund Request on the user's Purchases, newest first. Pass a date to
 * keep only requests made since then.
 */
export function listRefundRequestsForPurchaser(
  userId: number,
  since: Date | null
): PurchaserRefundRequest[] {
  return db
    .select({
      id: refundRequests.id,
      purchaseId: refundRequests.purchaseId,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      amount: refundRequests.amount,
      status: refundRequests.status,
      refundStatus: refundRequests.refundStatus,
      reason: refundRequests.reason,
      declineReason: refundRequests.declineReason,
      requestedAt: refundRequests.requestedAt,
      decidedAt: refundRequests.resolvedAt,
      seatBreakdown: refundRequests.seatBreakdown,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(
      and(
        eq(purchases.userId, userId),
        since ? gte(refundRequests.requestedAt, since.toISOString()) : undefined
      )
    )
    .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
    .all();
}

// ─── Who a Refund affects ───

/** True for a Refund Request whose Refund has not been Issued yet. */
function isInProgress(refundRequest: RefundRequest) {
  return (
    refundRequest.status === RefundRequestStatus.Open ||
    (refundRequest.status === RefundRequestStatus.Approved &&
      refundRequest.refundStatus !== RefundStatus.Issued)
  );
}

function isSeatRefunded(refundRequest: RefundRequest, couponId: number) {
  if (!refundRequest.seatBreakdown) return true;
  return refundRequest.seatBreakdown.some(
    (seat) => seat.couponId === couponId && seat.refunded
  );
}

/** The Students whose Enrollment this Refund ends once it is Issued. */
function getAffectedStudentIds(refundRequest: RefundRequest, purchase: Purchase) {
  const seatCodes = getSeatCodes(purchase.id);
  if (seatCodes.length === 0) return [purchase.userId];

  return seatCodes.flatMap((code) =>
    code.redeemedByUserId !== null && isSeatRefunded(refundRequest, code.id)
      ? [code.redeemedByUserId]
      : []
  );
}

function getRefundRequestsAffecting(userId: number, courseId: number) {
  const individual = db
    .select({ refundRequest: refundRequests })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        sql`not exists (select 1 from ${coupons} where ${coupons.purchaseId} = ${purchases.id})`
      )
    )
    .all()
    .map((row) => row.refundRequest);

  const seats = db
    .select({ refundRequest: refundRequests, couponId: coupons.id })
    .from(refundRequests)
    .innerJoin(coupons, eq(coupons.purchaseId, refundRequests.purchaseId))
    .where(
      and(eq(coupons.redeemedByUserId, userId), eq(coupons.courseId, courseId))
    )
    .all()
    .filter((row) => isSeatRefunded(row.refundRequest, row.couponId))
    .map((row) => row.refundRequest);

  return [...individual, ...seats];
}

/**
 * Is this Student limited to Read-only Access because a Refund affecting
 * their Enrollment is in progress?
 */
export function isReadOnly(userId: number, courseId: number) {
  return getRefundRequestsAffecting(userId, courseId).some(isInProgress);
}

/**
 * Has this user had an Issued Refund for this course before, from a Purchase
 * of their own or from a seat they Redeemed?
 */
export function hasIssuedRefundForCourse(userId: number, courseId: number) {
  const ownPurchase = db
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.courseId, courseId),
        eq(refundRequests.refundStatus, RefundStatus.Issued)
      )
    )
    .get();

  return (
    !!ownPurchase ||
    getRefundRequestsAffecting(userId, courseId).some(
      (refundRequest) => refundRequest.refundStatus === RefundStatus.Issued
    )
  );
}

// ─── Quoting a Refund Override ───

export type RefundQuote =
  | {
      refundable: true;
      amount: number;
      seatBreakdown: SeatBreakdownEntry[] | null;
      /** Students who go read-only on approval and lose access when Issued. */
      affectedStudents: { id: number; name: string }[];
    }
  | { refundable: false; reason: string };

const PROGRESS_REASONS: Record<SeatRefundBlocker, string> = {
  completed_course: "The Student has completed the course.",
  too_much_completed: "The Student has completed half or more of the lessons.",
  too_much_watched: "The Student has watched 2 hours or more of video.",
};

/**
 * What a Refund of this Purchase would return if the Admin approved it now.
 * Waives only the Refund Window — the progress limits still apply, per seat
 * for a Team Purchase.
 */
export function quoteRefund(purchaseId: number): RefundQuote {
  const purchase = getPurchase(purchaseId);
  if (!purchase) return { refundable: false, reason: "Purchase not found." };

  const seatCodes = getSeatCodes(purchase.id);

  if (seatCodes.length === 0) {
    const blocker = checkProgressLimits(purchase.userId, purchase.courseId);
    if (blocker) return { refundable: false, reason: PROGRESS_REASONS[blocker] };
    const student = getUser(purchase.userId);
    return {
      refundable: true,
      amount: purchase.amountPaid,
      seatBreakdown: null,
      affectedStudents: student ? [{ id: student.id, name: student.name }] : [],
    };
  }

  if (!seatCodes.some((code) => code.redeemedByUserId !== null)) {
    return {
      refundable: true,
      amount: purchase.amountPaid,
      seatBreakdown: null,
      affectedStudents: [],
    };
  }

  const seats: TeamSeat[] = seatCodes.map((code) => {
    if (code.redeemedByUserId === null) {
      return { couponId: code.id, holderUserId: null, holderName: null, blocker: null };
    }
    const holder = getUser(code.redeemedByUserId);
    return {
      couponId: code.id,
      holderUserId: code.redeemedByUserId,
      holderName: holder?.name ?? "A seat holder",
      blocker: checkProgressLimits(code.redeemedByUserId, purchase.courseId),
    };
  });

  const { amount, breakdown } = calculateTeamRefund(purchase.amountPaid, seats);

  if (amount <= 0) {
    return {
      refundable: false,
      reason: "None of the seats can be refunded, because every seat holder is over the progress limits.",
    };
  }

  return {
    refundable: true,
    amount,
    seatBreakdown: breakdown,
    affectedStudents: breakdown.flatMap((seat) =>
      seat.refunded && seat.holderUserId !== null
        ? [{ id: seat.holderUserId, name: seat.holderName ?? "A seat holder" }]
        : []
    ),
  };
}

// ─── Approving ───

function notifyApproval(refundRequest: RefundRequest) {
  const parties = getParties(refundRequest);
  if (!parties) return;

  sendEmail(
    buildRefundApprovedEmail({
      purchaser: parties.purchaser,
      courseTitle: parties.course.title,
      amount: refundRequest.amount,
      seatBreakdown: refundRequest.seatBreakdown,
    })
  );

  if (getSeatCodes(parties.purchase.id).length === 0) return;
  for (const holderId of getAffectedStudentIds(refundRequest, parties.purchase)) {
    const holder = getUser(holderId);
    if (holder) {
      sendEmail(buildSeatRefundApprovedEmail({ holder, courseTitle: parties.course.title }));
    }
  }
}

/**
 * Approves an Open request for its stored amount, or approves a Declined one
 * as a Refund Override, working the amount out now.
 */
export function approveRefundRequest(
  refundRequestId: number,
  adminId: number
): RefundActionResult {
  const refundRequest = getRefundRequest(refundRequestId);
  if (!refundRequest) return { ok: false, error: "Refund request not found." };

  let amount = refundRequest.amount;
  let seatBreakdown = refundRequest.seatBreakdown;

  if (refundRequest.status === RefundRequestStatus.Declined) {
    const quote = quoteRefund(refundRequest.purchaseId);
    if (!quote.refundable) return { ok: false, error: quote.reason };
    amount = quote.amount;
    seatBreakdown = quote.seatBreakdown;
  } else if (refundRequest.status !== RefundRequestStatus.Open) {
    return { ok: false, error: "This refund request has already been approved." };
  }

  const approved = db
    .update(refundRequests)
    .set({
      status: RefundRequestStatus.Approved,
      amount,
      seatBreakdown,
      refundStatus: RefundStatus.Pending,
      refundStatusAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      resolvedByUserId: adminId,
    })
    .where(eq(refundRequests.id, refundRequest.id))
    .returning()
    .get();

  notifyApproval(approved);
  return { ok: true };
}

/**
 * A Refund Override for a Purchase that has no Refund Request: the Admin
 * gives the reason and the request is created already Approved.
 */
export function createRefundOverride(
  purchaseId: number,
  adminId: number,
  reason: string
): RefundActionResult {
  if (getRefundRequestForPurchase(purchaseId)) {
    return { ok: false, error: "This purchase already has a refund request." };
  }

  const quote = quoteRefund(purchaseId);
  if (!quote.refundable) return { ok: false, error: quote.reason };

  const now = new Date().toISOString();
  const created = db
    .insert(refundRequests)
    .values({
      purchaseId,
      status: RefundRequestStatus.Approved,
      reason,
      amount: quote.amount,
      seatBreakdown: quote.seatBreakdown,
      refundStatus: RefundStatus.Pending,
      refundStatusAt: now,
      requestedAt: now,
      resolvedAt: now,
      resolvedByUserId: adminId,
    })
    .returning()
    .get();

  notifyApproval(created);
  return { ok: true };
}

// ─── Refund status ───

function isAwaitingPayment(refundRequest: RefundRequest) {
  return (
    refundRequest.status === RefundRequestStatus.Approved &&
    (refundRequest.refundStatus === RefundStatus.Pending ||
      refundRequest.refundStatus === RefundStatus.Failed)
  );
}

export function markRefundIssued(refundRequestId: number): RefundActionResult {
  const refundRequest = getRefundRequest(refundRequestId);
  if (!refundRequest) return { ok: false, error: "Refund request not found." };
  if (!isAwaitingPayment(refundRequest)) {
    return { ok: false, error: "Only a pending or failed refund can be marked as issued." };
  }
  const parties = getParties(refundRequest);
  if (!parties) return { ok: false, error: "Purchase not found." };

  const now = new Date().toISOString();
  db.update(refundRequests)
    .set({ refundStatus: RefundStatus.Issued, refundStatusAt: now })
    .where(eq(refundRequests.id, refundRequest.id))
    .run();

  const studentIds = getAffectedStudentIds(refundRequest, parties.purchase);
  for (const studentId of studentIds) {
    revokeEnrollment(studentId, parties.purchase.courseId);
  }

  for (const code of getSeatCodes(parties.purchase.id)) {
    if (isSeatRefunded(refundRequest, code.id)) {
      db.update(coupons)
        .set({ invalidatedAt: now })
        .where(eq(coupons.id, code.id))
        .run();
    }
  }

  sendEmail(
    buildRefundIssuedEmail({
      purchaser: parties.purchaser,
      courseTitle: parties.course.title,
      amount: refundRequest.amount,
    })
  );
  if (getSeatCodes(parties.purchase.id).length > 0) {
    for (const holderId of studentIds) {
      const holder = getUser(holderId);
      if (holder) {
        sendEmail(buildSeatRefundIssuedEmail({ holder, courseTitle: parties.course.title }));
      }
    }
  }

  return { ok: true };
}

export function markRefundFailed(refundRequestId: number): RefundActionResult {
  const refundRequest = getRefundRequest(refundRequestId);
  if (!refundRequest) return { ok: false, error: "Refund request not found." };
  if (
    refundRequest.status !== RefundRequestStatus.Approved ||
    refundRequest.refundStatus !== RefundStatus.Pending
  ) {
    return { ok: false, error: "Only a pending refund can be marked as failed." };
  }

  db.update(refundRequests)
    .set({ refundStatus: RefundStatus.Failed, refundStatusAt: new Date().toISOString() })
    .where(eq(refundRequests.id, refundRequest.id))
    .run();

  const parties = getParties(refundRequest);
  if (parties) {
    sendEmail(
      buildRefundFailedEmail({
        purchaser: parties.purchaser,
        courseTitle: parties.course.title,
        amount: refundRequest.amount,
      })
    );
  }

  return { ok: true };
}

/**
 * Gives back Content Access that an Issued Refund ended. Does not touch the
 * money.
 */
export function restoreRefundedAccess(refundRequestId: number): RefundActionResult {
  const refundRequest = getRefundRequest(refundRequestId);
  if (!refundRequest) return { ok: false, error: "Refund request not found." };
  if (refundRequest.refundStatus !== RefundStatus.Issued) {
    return { ok: false, error: "Access can only be restored after the refund is issued." };
  }
  const purchase = getPurchase(refundRequest.purchaseId);
  if (!purchase) return { ok: false, error: "Purchase not found." };

  for (const studentId of getAffectedStudentIds(refundRequest, purchase)) {
    restoreEnrollment(studentId, purchase.courseId);
  }

  return { ok: true };
}

// ─── Seat Codes ───

export type SeatCodeRedeemability =
  | { redeemable: true }
  | { redeemable: false; reason: "refund_in_progress" | "invalidated" };

/**
 * May this Seat Code be Redeemed, as far as Refunds are concerned? A seat on
 * its way to being refunded cannot be handed out, and a refunded one never.
 */
export function checkSeatCodeRedeemable(couponId: number): SeatCodeRedeemability {
  const code = db.select().from(coupons).where(eq(coupons.id, couponId)).get();
  if (code?.invalidatedAt) return { redeemable: false, reason: "invalidated" };
  if (!code) return { redeemable: true };

  const refundRequest = getRefundRequestForPurchase(code.purchaseId);
  if (
    refundRequest &&
    isInProgress(refundRequest) &&
    isSeatRefunded(refundRequest, code.id)
  ) {
    return { redeemable: false, reason: "refund_in_progress" };
  }

  return { redeemable: true };
}

// ─── Read models for pages ───

/** The latest Refund Request for a Purchase, for status banners. */
export function getLatestRefundRequest(purchaseId: number) {
  return getRefundRequestForPurchase(purchaseId);
}

export const REFUND_REQUEST_FILTERS = [
  "open",
  "approved",
  "declined",
  "pending",
  "failed",
  "issued",
  "all",
] as const;

export type RefundRequestFilter = (typeof REFUND_REQUEST_FILTERS)[number];

function filterCondition(filter: RefundRequestFilter) {
  switch (filter) {
    case "open":
      return eq(refundRequests.status, RefundRequestStatus.Open);
    case "approved":
      return eq(refundRequests.status, RefundRequestStatus.Approved);
    case "declined":
      return eq(refundRequests.status, RefundRequestStatus.Declined);
    case "pending":
      return eq(refundRequests.refundStatus, RefundStatus.Pending);
    case "failed":
      return eq(refundRequests.refundStatus, RefundStatus.Failed);
    case "issued":
      return eq(refundRequests.refundStatus, RefundStatus.Issued);
    case "all":
      return undefined;
  }
}

export type RefundPreview = {
  amount: number;
  seatBreakdown: SeatBreakdownEntry[] | null;
  affectedStudents: { id: number; name: string }[];
};

export type AdminRefundRequestRow = PurchaserRefundRequest & {
  purchaserName: string;
  purchaserEmail: string;
  amountPaid: number;
  /** Null for an individual purchase. */
  seats: { total: number; redeemed: number } | null;
  /** The individual Purchaser's progress; null for a Team Purchase. */
  progress: StudentProgress | null;
  /** What approving would do, or why it cannot be approved. */
  approval: RefundQuote | null;
  /** Students whose access this Refund affects, for the dialogs. */
  affectedStudents: { id: number; name: string }[];
  /** Has an Issued Refund revoked an Enrollment that is still revoked? */
  accessRevoked: boolean;
};

function describeSeats(purchaseId: number) {
  const seatCodes = getSeatCodes(purchaseId);
  if (seatCodes.length === 0) return null;
  return {
    total: seatCodes.length,
    redeemed: seatCodes.filter((code) => code.redeemedByUserId !== null).length,
  };
}

function namesOf(userIds: number[]) {
  return userIds.flatMap((id) => {
    const user = getUser(id);
    return user ? [{ id: user.id, name: user.name }] : [];
  });
}

function isRevoked(userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        isNotNull(enrollments.revokedAt)
      )
    )
    .get();
}

export function listRefundRequestsForAdmin(
  filter: RefundRequestFilter
): AdminRefundRequestRow[] {
  const rows = db
    .select({
      refundRequest: refundRequests,
      purchase: purchases,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      purchaserName: users.name,
      purchaserEmail: users.email,
    })
    .from(refundRequests)
    .innerJoin(purchases, eq(refundRequests.purchaseId, purchases.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(filterCondition(filter))
    .orderBy(desc(refundRequests.requestedAt), desc(refundRequests.id))
    .all();

  return rows.map(({ refundRequest, purchase, ...row }) => {
    const seats = describeSeats(purchase.id);
    const affectedIds = getAffectedStudentIds(refundRequest, purchase);

    let approval: RefundQuote | null = null;
    if (refundRequest.status === RefundRequestStatus.Open) {
      approval = {
        refundable: true,
        amount: refundRequest.amount,
        seatBreakdown: refundRequest.seatBreakdown,
        affectedStudents: namesOf(affectedIds),
      };
    } else if (refundRequest.status === RefundRequestStatus.Declined) {
      approval = quoteRefund(purchase.id);
    }

    return {
      id: refundRequest.id,
      purchaseId: purchase.id,
      courseTitle: row.courseTitle,
      courseSlug: row.courseSlug,
      amount: refundRequest.amount,
      status: refundRequest.status,
      refundStatus: refundRequest.refundStatus,
      reason: refundRequest.reason,
      declineReason: refundRequest.declineReason,
      requestedAt: refundRequest.requestedAt,
      decidedAt: refundRequest.resolvedAt,
      seatBreakdown: refundRequest.seatBreakdown,
      purchaserName: row.purchaserName,
      purchaserEmail: row.purchaserEmail,
      amountPaid: purchase.amountPaid,
      seats,
      progress: seats ? null : getStudentProgress(purchase.userId, purchase.courseId),
      approval,
      affectedStudents: namesOf(affectedIds),
      accessRevoked:
        refundRequest.refundStatus === RefundStatus.Issued &&
        affectedIds.some((id) => isRevoked(id, purchase.courseId)),
    };
  });
}

export type PurchaseWithoutRefundRequest = {
  purchaseId: number;
  purchaserName: string;
  purchaserEmail: string;
  courseTitle: string;
  amountPaid: number;
  purchasedAt: string;
  seats: { total: number; redeemed: number } | null;
  quote: RefundQuote;
};

/** Purchases an Admin can create a New refund for. */
export function listPurchasesWithoutRefundRequest(): PurchaseWithoutRefundRequest[] {
  return db
    .select({
      purchaseId: purchases.id,
      purchaserName: users.name,
      purchaserEmail: users.email,
      courseTitle: courses.title,
      amountPaid: purchases.amountPaid,
      purchasedAt: purchases.createdAt,
    })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .where(
      sql`not exists (select 1 from ${refundRequests} where ${refundRequests.purchaseId} = ${purchases.id})`
    )
    .orderBy(desc(purchases.createdAt))
    .all()
    .map((row) => ({
      ...row,
      seats: describeSeats(row.purchaseId),
      quote: quoteRefund(row.purchaseId),
    }));
}
