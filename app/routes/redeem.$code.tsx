import { Link, useFetcher, redirect } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/redeem.$code";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { parseParams, parseFormData } from "~/lib/validation";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Ticket, AlertCircle, CheckCircle2, Globe, Ban, Clock } from "lucide-react";
import { data } from "react-router";
import { db } from "~/db";
import { purchases, coupons, courses, enrollments } from "~/db/schema";
import { eq } from "drizzle-orm";
import { enroll, isEnrolled } from "~/lib/enrollments.server";
import { checkSeatCodeRedeemable } from "~/lib/refund-requests.server";

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function getCouponByCode(code: string) {
  return db.select().from(coupons).where(eq(coupons.code, code)).get();
}

type RedeemResult =
  | { ok: true; enrollment: typeof enrollments.$inferSelect }
  | { ok: false; error: string };

function redeemCoupon(
  code: string,
  userId: number,
  userCountry: string
): RedeemResult {
  const coupon = getCouponByCode(code);
  if (!coupon) {
    return { ok: false, error: "Seat code not found" };
  }

  const redeemability = checkSeatCodeRedeemable(coupon.id);
  if (!redeemability.redeemable) {
    return {
      ok: false,
      error:
        redeemability.reason === "invalidated"
          ? "This seat code is no longer valid"
          : "This seat code cannot be redeemed while a refund for this purchase is being handled",
    };
  }

  if (coupon.redeemedByUserId !== null) {
    return { ok: false, error: "This seat code has already been redeemed" };
  }

  if (isEnrolled(userId, coupon.courseId)) {
    return { ok: false, error: "You are already enrolled in this course" };
  }

  const purchase = db
    .select()
    .from(purchases)
    .where(eq(purchases.id, coupon.purchaseId))
    .get();

  if (purchase?.country && purchase.country !== userCountry) {
    return {
      ok: false,
      error:
        "This seat code can only be redeemed from the same country as the purchaser",
    };
  }

  db.update(coupons)
    .set({
      redeemedByUserId: userId,
      redeemedAt: new Date().toISOString(),
    })
    .where(eq(coupons.id, coupon.id))
    .run();

  const enrollment = enroll(userId, coupon.courseId);

  return { ok: true, enrollment };
}

const redeemParamsSchema = z.object({
  code: z.string().min(1),
});

const redeemActionSchema = z.object({
  intent: z.literal("confirm-redeem"),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Redeem Seat Code";
  return [
    { title: `Redeem: ${title} — Cadence` },
    { name: "description", content: `Redeem your seat code for ${title}` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, redeemParamsSchema);

  const coupon = getCouponByCode(code);
  if (!coupon) {
    throw data("Seat code not found.", { status: 404 });
  }

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(
      `/login?redirectTo=${encodeURIComponent(`/redeem/${code}`)}`
    );
  }

  const course = getCourseById(coupon.courseId);
  if (!course) {
    throw data("Course not found.", { status: 404 });
  }

  const redeemability = checkSeatCodeRedeemable(coupon.id);
  const unavailableReason = redeemability.redeemable
    ? null
    : redeemability.reason;
  const alreadyRedeemed = coupon.redeemedByUserId !== null;
  const alreadyEnrolled = isEnrolled(currentUserId, coupon.courseId);

  // Check country mismatch upfront so we can show a clear message
  let countryMismatch = false;
  if (!unavailableReason && !alreadyRedeemed && !alreadyEnrolled) {
    const userCountry = await resolveCountry(request);
    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, coupon.purchaseId))
      .get();
    if (purchase?.country && purchase.country !== (userCountry ?? "")) {
      countryMismatch = true;
    }
  }

  return {
    course: { id: course.id, title: course.title, slug: course.slug },
    code,
    unavailableReason,
    alreadyRedeemed,
    alreadyEnrolled,
    countryMismatch,
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { code } = parseParams(params, redeemParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, redeemActionSchema);

  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const userCountry = await resolveCountry(request);
  const result = redeemCoupon(code, currentUserId, userCountry ?? "");

  if (!result.ok) {
    return data({ error: result.error }, { status: 400 });
  }

  const course = getCourseById(result.enrollment.courseId);
  if (!course) {
    throw redirect("/courses");
  }

  throw redirect(`/courses/${course.slug}/welcome`);
}

export default function Redeem({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const {
    course,
    code,
    unavailableReason,
    alreadyRedeemed,
    alreadyEnrolled,
    countryMismatch,
  } = loaderData;
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const error =
      fetcher.data?.error ?? (actionData as { error?: string })?.error;
    if (error) {
      toast.error(error);
    }
  }, [fetcher.data, actionData]);

  // Determine which state to show
  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">Redeem Seat Code</h1>
      <p className="mb-8 text-muted-foreground">
        You&apos;ve been invited to enroll in a course.
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="size-8 text-primary" />
          </div>

          <h2 className="mb-2 text-xl font-semibold">{course.title}</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Seat code:{" "}
            <code className="rounded bg-muted px-2 py-0.5">{code}</code>
          </p>

          {unavailableReason === "invalidated" ? (
            <div className="rounded-lg bg-muted p-4">
              <div className="flex items-center justify-center gap-2">
                <Ban className="size-5" />
                <span className="font-medium">
                  This code is no longer valid
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                The seat this code was for has been refunded, so it can no
                longer be redeemed. Please ask the person who shared this link
                for a new seat code.
              </p>
            </div>
          ) : unavailableReason === "refund_in_progress" ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <Clock className="size-5" />
                <span className="font-medium">
                  This code cannot be redeemed right now
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                A refund for the purchase this seat code belongs to is being
                handled, and its seat codes cannot be redeemed until that is
                settled. Please check with the person who shared this link.
              </p>
            </div>
          ) : alreadyRedeemed ? (
            <div className="rounded-lg bg-destructive/10 p-4">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertCircle className="size-5" />
                <span className="font-medium">
                  This seat code has already been redeemed
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Someone has already redeemed this seat. Please ask the person
                who shared this link for a new seat code.
              </p>
            </div>
          ) : alreadyEnrolled ? (
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="size-5" />
                <span className="font-medium">
                  You&apos;re already enrolled
                </span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                You already have access to this course. The seat code has not
                been redeemed, so it can still be shared with someone else.
              </p>
              <Link to={`/courses/${course.slug}`}>
                <Button className="mt-4" size="lg">
                  Go to Course
                </Button>
              </Link>
            </div>
          ) : countryMismatch ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <Globe className="size-5" />
                <span className="font-medium">Region restriction</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                This seat code can only be redeemed from the same country as the
                person who purchased it. Your location doesn&apos;t match the
                purchaser&apos;s country.
              </p>
            </div>
          ) : (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="confirm-redeem" />
              <Button
                size="lg"
                className="w-full max-w-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Enrolling..." : "Enroll Now"}
              </Button>
            </fetcher.Form>
          )}

          <div className="mt-6">
            <Link
              to={`/courses/${course.slug}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              View course details
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
