import type { SeatBreakdownEntry } from "~/db/schema";

// ─── Team Refund ───
// Works out the Refund for a Team Purchase that has Redeemed seats (ADR 0002):
//
//   seat price = Amount Paid ÷ seats
//   refund     = Amount Paid − seat price × seats that cannot be refunded
//
// Pure, so it can run in the confirmation dialog, on approval and in tests.

/** Why a Redeemed seat cannot be refunded. */
export type SeatRefundBlocker =
  | "completed_course"
  | "too_much_completed"
  | "too_much_watched";

export type TeamSeat = {
  couponId: number;
  holderUserId: number | null;
  /** Null for an unredeemed seat. */
  holderName: string | null;
  /** Null when the seat is a Refundable Seat. */
  blocker: SeatRefundBlocker | null;
};

function explainBlocker(holderName: string, blocker: SeatRefundBlocker) {
  switch (blocker) {
    case "completed_course":
      return `${holderName} has completed the course.`;
    case "too_much_completed":
      return `${holderName} has completed half or more of the lessons.`;
    case "too_much_watched":
      return `${holderName} has watched 2 hours or more of video.`;
  }
}

export function calculateTeamRefund(amountPaid: number, seats: TeamSeat[]) {
  const nonRefundable = seats.filter((seat) => seat.blocker !== null).length;
  // Rounding the deduction down hands any leftover cent to the Purchaser.
  const deduction = Math.floor((amountPaid * nonRefundable) / seats.length);

  const breakdown: SeatBreakdownEntry[] = seats.map((seat) => ({
    couponId: seat.couponId,
    holderUserId: seat.holderUserId,
    holderName: seat.holderName,
    refunded: seat.blocker === null,
    reason:
      seat.blocker === null
        ? null
        : explainBlocker(seat.holderName ?? "The seat holder", seat.blocker),
  }));

  return { amount: amountPaid - deduction, breakdown };
}

/** One line of the per-seat breakdown, for emails and banners. */
export function describeSeat(seat: SeatBreakdownEntry) {
  const who = seat.holderName ?? "Unredeemed seat";
  if (seat.refunded) return `${who}: refunded`;
  return `${who}: not refunded. ${seat.reason ?? ""}`.trimEnd();
}
