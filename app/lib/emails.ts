import type { SeatBreakdownEntry } from "~/db/schema";
import { describeSeat } from "~/lib/team-refund";
import { formatPrice } from "~/lib/utils";

// ─── Emails ───
// Builders for every email the platform sends. They are pure so they can be
// tested; `sendEmail()` in email.server.ts delivers them.

export const SUPPORT_EMAIL = "support@cadence.dev";

export type Email = { to: string; subject: string; body: string };

type Recipient = { name: string; email: string };

const SIGN_OFF = ["", "— The Cadence team"];

function email(to: Recipient, subject: string, lines: string[]): Email {
  return {
    to: to.email,
    subject,
    body: [`Hi ${to.name},`, "", ...lines, ...SIGN_OFF].join("\n"),
  };
}

export function buildRefundApprovedEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  amount: number;
  seatBreakdown: SeatBreakdownEntry[] | null;
}) {
  const breakdown = input.seatBreakdown
    ? [
        "",
        "Here is how we worked out the amount, seat by seat:",
        ...input.seatBreakdown.map((seat) => `- ${describeSeat(seat)}`),
      ]
    : [];

  return email(
    input.purchaser,
    `Your refund request was approved — ${input.courseTitle}`,
    [
      `Good news: we have approved your refund request for "${input.courseTitle}".`,
      `We will send ${formatPrice(input.amount)} back to the card you paid with.`,
      ...breakdown,
      "",
      "Until the refund has been sent, the course stays available in read-only mode for everyone the refund covers. Access ends once the refund has been issued, and we will email you when that happens.",
    ]
  );
}

export function buildRefundDeclinedEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  declineReason: string;
}) {
  return email(
    input.purchaser,
    `Your refund request was declined — ${input.courseTitle}`,
    [
      `We have reviewed your refund request for "${input.courseTitle}" and we are not able to approve it.`,
      "",
      `Our reason: ${input.declineReason}`,
      "",
      "Everything is back to how it was before you made your request.",
      `If you would like to talk about this decision, please email us at ${SUPPORT_EMAIL}.`,
    ]
  );
}

/** Shown before buying, and repeated in the purchase confirmation email. */
export const BOUGHT_AFTER_REFUND_NOTE =
  "You have been refunded for this course before, so this purchase is not eligible for a self-service refund. If something goes wrong, please contact us and we will help.";

export function buildPurchaseConfirmationEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  amountPaid: number;
  /** Null for an individual purchase. */
  seats: number | null;
  boughtAfterRefund: boolean;
}) {
  const what =
    input.seats === null
      ? `your purchase of "${input.courseTitle}"`
      : `your purchase of ${input.seats} ${input.seats === 1 ? "seat" : "seats"} for "${input.courseTitle}"`;
  const next =
    input.seats === null
      ? "You can start learning straight away."
      : "Share the seat codes from your Team page with the people you bought them for.";

  return email(input.purchaser, `Thank you for your purchase — ${input.courseTitle}`, [
    `Thank you for ${what}. You paid ${formatPrice(input.amountPaid)}.`,
    next,
    ...(input.boughtAfterRefund ? ["", BOUGHT_AFTER_REFUND_NOTE] : []),
  ]);
}

export function buildRefundRequestReceivedEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  amount: number;
}) {
  return email(input.purchaser, `Refund request received — ${input.courseTitle}`, [
    `We have received your refund request for "${input.courseTitle}".`,
    `The refund request is for ${formatPrice(input.amount)}, the amount you paid.`,
    "",
    "While we review it, the course is available in read-only mode: you can revisit the lessons you have completed, but you cannot continue with new ones.",
    "",
    "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again once we have made a decision.",
  ]);
}

export function buildRefundIssuedEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  amount: number;
}) {
  return email(input.purchaser, `Your refund has been sent — ${input.courseTitle}`, [
    `We have sent your refund of ${formatPrice(input.amount)} for "${input.courseTitle}". It can take a few days to appear in your account.`,
    "",
    "Access to the course covered by this refund has now ended. If you buy the course again later, your progress will come back.",
  ]);
}

export function buildRefundFailedEmail(input: {
  purchaser: Recipient;
  courseTitle: string;
  amount: number;
}) {
  return email(input.purchaser, `We are working on your refund — ${input.courseTitle}`, [
    `We tried to send your refund of ${formatPrice(input.amount)} for "${input.courseTitle}", but the payment did not go through.`,
    "",
    "Your refund is still approved and we are working on it. You do not need to do anything — we will email you again once it has been sent.",
    `If you have questions, please email us at ${SUPPORT_EMAIL}.`,
  ]);
}

export function buildSeatRefundApprovedEmail(input: {
  holder: Recipient;
  courseTitle: string;
}) {
  return email(input.holder, `Your seat for "${input.courseTitle}" is being refunded`, [
    `The person who bought your seat for "${input.courseTitle}" has been approved for a refund that includes your seat.`,
    "",
    "From now on the course is read-only for you: you can revisit the lessons you have completed, but you cannot continue with new ones. Your access ends once the refund has been issued, and we will email you then.",
  ]);
}

export function buildSeatRefundIssuedEmail(input: {
  holder: Recipient;
  courseTitle: string;
}) {
  return email(input.holder, `Your access to "${input.courseTitle}" has ended`, [
    `The refund for your seat on "${input.courseTitle}" has been issued, so your access to the course has now ended.`,
    "",
    "If you buy the course or redeem a new seat code later, your progress will come back.",
  ]);
}
