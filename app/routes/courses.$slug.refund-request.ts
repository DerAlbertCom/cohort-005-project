import { data, redirect } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/courses.$slug.refund-request";
import { getCurrentUserId } from "~/lib/session";
import { db } from "~/db";
import {
  courses,
  refundRequests,
  users,
  RefundRequestStatus,
} from "~/db/schema";
import { eq } from "drizzle-orm";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import {
  checkRefundRequestEligibility,
  REFUND_REQUEST_WINDOW_DAYS,
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
  redeemed_seat_code: {
    message:
      "A refund cannot be requested once a seat code from this purchase has been redeemed.",
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

/**
 * The confirmation the Purchaser gets in their inbox. There is no mail
 * transport wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  purchaserName: string;
  purchaserEmail: string;
  courseTitle: string;
  amount: number;
}) {
  return {
    to: input.purchaserEmail,
    subject: `Refund request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.purchaserName},`,
      "",
      `We have received your refund request for "${input.courseTitle}".`,
      `The refund request is for ${formatPrice(input.amount)}, the amount you paid.`,
      "",
      "Our team reviews every refund request by hand. You do not need to do anything else — we will email you again once we have made a decision.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("You must be logged in to request a refund.", { status: 401 });
  }

  const { slug } = parseParams(params, refundRequestParamsSchema);
  const course = getCourseBySlug(slug);

  if (!course) {
    throw data("Course not found", { status: 404 });
  }

  const purchaser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!purchaser) {
    throw data("User not found", { status: 404 });
  }

  const eligibility = checkRefundRequestEligibility(currentUserId, course);

  if (!eligibility.eligible) {
    const { message, status } = INELIGIBLE_RESPONSES[eligibility.reason];
    throw data(message, { status });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, refundRequestActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  db
    .insert(refundRequests)
    .values({
      purchaseId: eligibility.purchase.id,
      status: RefundRequestStatus.Open,
      reason: parsed.data.reason,
    })
    .returning()
    .get();

  const email = buildRefundRequestEmail({
    purchaserName: purchaser.name,
    purchaserEmail: purchaser.email,
    courseTitle: course.title,
    amount: eligibility.amount,
  });

  console.log(
    `[email] to=${email.to} subject=${email.subject}\n${email.body}`
  );

  return redirect("/settings");
}
