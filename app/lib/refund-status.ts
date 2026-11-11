import { RefundRequestStatus, RefundStatus } from "~/db/schema";

// ─── Refund Request status for display ───
// Client-safe, so banners and lists on any page describe a Refund Request in
// the same words.

export type RefundState =
  | "open"
  | "approved_pending"
  | "approved_failed"
  | "refunded"
  | "declined";

export function getRefundState(
  status: RefundRequestStatus,
  refundStatus: RefundStatus | null
): RefundState {
  if (status === RefundRequestStatus.Open) return "open";
  if (status === RefundRequestStatus.Declined) return "declined";
  if (refundStatus === RefundStatus.Issued) return "refunded";
  if (refundStatus === RefundStatus.Failed) return "approved_failed";
  return "approved_pending";
}

export const REFUND_STATE_LABELS: Record<RefundState, string> = {
  open: "Open",
  approved_pending: "Approved – refund pending",
  approved_failed: "Approved – refund failed",
  refunded: "Refunded",
  declined: "Declined",
};
