import { describe, expect, it } from "vitest";
import { calculateTeamRefund, type TeamSeat } from "./team-refund";

function unredeemed(couponId: number): TeamSeat {
  return { couponId, holderUserId: null, holderName: null, blocker: null };
}

describe("calculateTeamRefund", () => {
  it("refunds $300 of $500 for 5 seats when 2 holders completed the course", () => {
    const seats: TeamSeat[] = [
      { couponId: 1, holderUserId: 10, holderName: "Ava", blocker: "completed_course" },
      { couponId: 2, holderUserId: 11, holderName: "Noah", blocker: "completed_course" },
      unredeemed(3),
      unredeemed(4),
      unredeemed(5),
    ];

    expect(calculateTeamRefund(50000, seats).amount).toBe(30000);
  });

  it("gives the rounding remainder to the Purchaser", () => {
    // $100 for 3 seats: a seat costs $33.333…, so one used seat keeps $33.33
    // and the Purchaser gets $66.67 back, not $66.66.
    const seats: TeamSeat[] = [
      { couponId: 1, holderUserId: 10, holderName: "Ava", blocker: "too_much_watched" },
      unredeemed(2),
      unredeemed(3),
    ];

    expect(calculateTeamRefund(10000, seats).amount).toBe(6667);
  });

  it("explains for each seat whether it is refunded, and why not", () => {
    const seats: TeamSeat[] = [
      { couponId: 1, holderUserId: 10, holderName: "Ava", blocker: "completed_course" },
      { couponId: 2, holderUserId: 11, holderName: "Noah", blocker: "too_much_completed" },
      { couponId: 3, holderUserId: 12, holderName: "Isla", blocker: "too_much_watched" },
      { couponId: 4, holderUserId: 13, holderName: "Ethan", blocker: null },
      unredeemed(5),
    ];

    expect(calculateTeamRefund(50000, seats).breakdown).toEqual([
      {
        couponId: 1,
        holderUserId: 10,
        holderName: "Ava",
        refunded: false,
        reason: "Ava has completed the course.",
      },
      {
        couponId: 2,
        holderUserId: 11,
        holderName: "Noah",
        refunded: false,
        reason: "Noah has completed half or more of the lessons.",
      },
      {
        couponId: 3,
        holderUserId: 12,
        holderName: "Isla",
        refunded: false,
        reason: "Isla has watched 2 hours or more of video.",
      },
      { couponId: 4, holderUserId: 13, holderName: "Ethan", refunded: true, reason: null },
      { couponId: 5, holderUserId: null, holderName: null, refunded: true, reason: null },
    ]);
  });
});
