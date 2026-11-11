import { describe, expect, it } from "vitest";
import {
  buildPurchaseConfirmationEmail,
  buildRefundApprovedEmail,
  buildRefundDeclinedEmail,
  buildRefundIssuedEmail,
  buildSeatRefundIssuedEmail,
} from "./emails";

const liam = { name: "Liam", email: "liam@example.com" };

describe("emails", () => {
  it("tells the Purchaser why their Refund Request was declined and how to reach support", () => {
    const email = buildRefundDeclinedEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      declineReason: "You have finished most of the course.",
    });

    expect(email.to).toBe("liam@example.com");
    expect(email.body).toContain("You have finished most of the course.");
    expect(email.body).toContain("support@cadence.dev");
  });

  it("tells the Purchaser the approved amount", () => {
    const email = buildRefundApprovedEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      amount: 7900,
      seatBreakdown: null,
    });

    expect(email.body).toContain("$79.00");
  });

  it("lists every seat of a Team Purchase in the approval email", () => {
    const email = buildRefundApprovedEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      amount: 30000,
      seatBreakdown: [
        {
          couponId: 1,
          holderUserId: 10,
          holderName: "Ava",
          refunded: false,
          reason: "Ava has completed the course.",
        },
        { couponId: 2, holderUserId: null, holderName: null, refunded: true, reason: null },
      ],
    });

    expect(email.body).toContain("$300.00");
    expect(email.body).toContain("Ava: not refunded. Ava has completed the course.");
    expect(email.body).toContain("Unredeemed seat: refunded");
  });

  it("confirms every purchase with the Amount Paid", () => {
    const email = buildPurchaseConfirmationEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      amountPaid: 7900,
      seats: null,
      boughtAfterRefund: false,
    });

    expect(email.to).toBe("liam@example.com");
    expect(email.body).toContain("$79.00");
    expect(email.body).not.toContain("not eligible for a self-service refund");
  });

  it("warns a returning Purchaser that buying again after a Refund is not refundable by themselves", () => {
    const email = buildPurchaseConfirmationEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      amountPaid: 7900,
      seats: null,
      boughtAfterRefund: true,
    });

    expect(email.body).toContain("not eligible for a self-service refund");
  });

  it("tells the Purchaser access has ended once the Refund is Issued", () => {
    const email = buildRefundIssuedEmail({
      purchaser: liam,
      courseTitle: "Introduction to TypeScript",
      amount: 7900,
    });

    expect(email.body).toContain("$79.00");
    expect(email.body).toContain("has now ended");
  });

  it("tells a seat holder their access has ended once the Refund is Issued", () => {
    const email = buildSeatRefundIssuedEmail({
      holder: { name: "Ava", email: "ava@example.com" },
      courseTitle: "Introduction to TypeScript",
    });

    expect(email.to).toBe("ava@example.com");
    expect(email.body).toContain("has now ended");
  });
});
