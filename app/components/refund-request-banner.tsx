import { Info } from "lucide-react";
import type { SeatBreakdownEntry } from "~/db/schema";
import { SUPPORT_EMAIL } from "~/lib/emails";
import type { RefundState } from "~/lib/refund-status";
import { describeSeat } from "~/lib/team-refund";
import { formatPrice } from "~/lib/utils";

export type RefundRequestBannerProps = {
  state: RefundState;
  amount: number;
  requestedAt: string;
  declineReason: string | null;
  seatBreakdown: SeatBreakdownEntry[] | null;
  /** "student" on the course page, "team" next to a Team Purchase on /team. */
  audience: "student" | "team";
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Replaces the "Request a refund" section once a Refund Request exists, and
 * tells the Purchaser in full sentences where it stands.
 */
export function RefundRequestBanner({
  state,
  amount,
  requestedAt,
  declineReason,
  seatBreakdown,
  audience,
}: RefundRequestBannerProps) {
  const covered =
    audience === "student" ? "you" : "the people using these seats";

  let title: string;
  let sentences: string[];

  switch (state) {
    case "open":
      title = "Your refund request is being reviewed";
      sentences = [
        `You asked for a refund of ${formatPrice(amount)} on ${formatDate(requestedAt)}.`,
        audience === "student"
          ? "While we review it, the course is read-only: you can revisit the lessons you have completed, but you cannot start new ones, take quizzes, comment or rate the course."
          : "While we review it, the seat codes for this purchase cannot be redeemed.",
        "We will email you as soon as we have made a decision.",
      ];
      break;
    case "approved_pending":
    case "approved_failed":
      title = "Your refund has been approved";
      sentences = [
        `We are returning ${formatPrice(amount)} to the card you paid with.`,
        state === "approved_failed"
          ? "Our first attempt to send the money did not go through. We are working on it and will email you once it has been sent."
          : "We will email you once the money has been sent.",
        `Until then the course stays read-only for ${covered}, and access ends once the refund has been issued.`,
      ];
      break;
    case "refunded":
      title = "Your refund has been sent";
      sentences = [
        `We have sent ${formatPrice(amount)} back to the card you paid with, and access covered by this refund has ended.`,
      ];
      break;
    case "declined":
      title = "Your refund request was declined";
      sentences = [
        declineReason ? `Our reason: ${declineReason}` : "",
        `If you would like to talk about this decision, please email us at ${SUPPORT_EMAIL}.`,
      ].filter(Boolean);
      break;
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
      <p className="flex items-center gap-2 font-medium">
        <Info className="size-4 shrink-0" />
        {title}
      </p>
      {sentences.map((sentence) => (
        <p key={sentence} className="mt-1.5 text-muted-foreground">
          {sentence}
        </p>
      ))}
      {seatBreakdown && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {seatBreakdown.map((seat) => (
            <li key={seat.couponId}>{describeSeat(seat)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
