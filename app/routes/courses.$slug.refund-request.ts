import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { db } from "~/db";
import { courses } from "~/db/schema";
import { eq } from "drizzle-orm";
import { requireUserId } from "~/lib/access.server";
import { parseFormData, parseParams } from "~/lib/validation";
import { SUPPORT_EMAIL } from "~/lib/emails";
import {
  findIndividualPurchase,
  REFUND_REQUEST_WINDOW_DAYS,
  submitRefundRequest,
  type RefundRequestIneligibility,
} from "~/lib/refund-requests.server";

const refundRequestParamsSchema = z.object({
  slug: z.string().min(1),
});

const refundRequestActionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, "Tell us a little more about why you want a refund.")
    .max(1000, "Please keep your reason under 1000 characters."),
  // Sent by /team for a Team Purchase. Without it, the request is for the
  // Purchaser's own purchase of the course.
  purchaseId: z.coerce.number().int().positive().optional(),
});

const INELIGIBLE_RESPONSES: Record<
  RefundRequestIneligibility,
  { message: string; status: number }
> = {
  no_purchase: { message: "You have not purchased this course.", status: 403 },
  open_refund_request: {
    message: "You already have an open refund request for this purchase.",
    status: 409,
  },
  approved_refund_request: {
    message: "A refund for this purchase has already been approved.",
    status: 409,
  },
  declined_refund_request: {
    message: `Your refund request for this purchase was declined. Please email ${SUPPORT_EMAIL} if you would like to talk about it.`,
    status: 409,
  },
  redeemed_seat_code: {
    message:
      "A refund cannot be requested once a seat code from this purchase has been redeemed.",
    status: 403,
  },
  previously_refunded: {
    message: `You have been refunded for this course before, so this purchase is not eligible for a self-service refund. Please email ${SUPPORT_EMAIL}.`,
    status: 403,
  },
  outside_window: {
    message: `The ${REFUND_REQUEST_WINDOW_DAYS}-day window for refund requests has closed.`,
    status: 403,
  },
  too_much_completed: {
    message:
      "You have completed too much of this course to request a refund.",
    status: 403,
  },
  too_much_watched: {
    message: "You have watched too much of this course to request a refund.",
    status: 403,
  },
};

function getCourseBySlug(slug: string) {
  return db.select().from(courses).where(eq(courses.slug, slug)).get();
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await requireUserId(request);

  const { slug } = parseParams(params, refundRequestParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const isTeamRequest = parsed.data.purchaseId !== undefined;
  const purchaseId =
    parsed.data.purchaseId ??
    findIndividualPurchase(currentUserId, course.id)?.id;

  if (purchaseId === undefined) {
    throw data(INELIGIBLE_RESPONSES.no_purchase.message, { status: 403 });
  }

  const result = submitRefundRequest(
    currentUserId,
    purchaseId,
    parsed.data.reason
  );

  if (!result.ok) {
    const { message, status } = INELIGIBLE_RESPONSES[result.reason];
    throw data(message, { status });
  }

  return redirect(isTeamRequest ? "/team" : `/courses/${slug}`);
}
