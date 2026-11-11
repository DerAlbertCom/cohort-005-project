import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "~/db";
import {
  coupons,
  lessonProgress,
  lessons,
  LessonProgressStatus,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  videoWatchEvents,
} from "~/db/schema";
import { getDiscountForCountry } from "~/lib/ppp";

// ─── Refund Request Eligibility ───
// One place that answers "may this Purchaser raise a Refund Request for their
// Purchase of this course, and for how much?". The course page uses it to
// decide whether to offer the form; the action uses it to enforce the rules.
//
// Uses positional parameters (project convention).

export const REFUND_REQUEST_WINDOW_DAYS = 14;
const MAX_SECONDS_WATCHED = 2 * 60 * 60;
const MAX_COURSE_PROGRESS = 0.5;

export type RefundRequestIneligibility =
  | "no_purchase"
  | "open_refund_request"
  | "redeemed_seat_code"
  | "outside_window"
  | "too_much_completed"
  | "too_much_watched";

type Purchase = typeof purchases.$inferSelect;

export type RefundRequestEligibility =
  | {
      eligible: true;
      purchase: Purchase;
      amount: number;
      lastDayInWindow: string;
    }
  | { eligible: false; reason: RefundRequestIneligibility };

function getLatestPurchase(userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .orderBy(sql`${purchases.createdAt} desc`)
    .get();
}

export function getOpenRefundRequest(purchaseId: number) {
  return db
    .select()
    .from(refundRequests)
    .where(
      and(
        eq(refundRequests.purchaseId, purchaseId),
        eq(refundRequests.status, RefundRequestStatus.Open)
      )
    )
    .get();
}

function hasRedeemedSeatCode(purchaseId: number) {
  return !!db
    .select({ id: coupons.id })
    .from(coupons)
    .where(and(eq(coupons.purchaseId, purchaseId), isNotNull(coupons.redeemedAt)))
    .get();
}

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

// The window is counted in whole days, not hours — someone who purchases at
// 23:00 should still get the whole of their fourteenth day.
function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
}

export function checkRefundRequestEligibility(
  userId: number,
  course: { id: number; price: number }
): RefundRequestEligibility {
  const purchase = getLatestPurchase(userId, course.id);

  if (!purchase) return { eligible: false, reason: "no_purchase" };

  if (getOpenRefundRequest(purchase.id)) {
    return { eligible: false, reason: "open_refund_request" };
  }

  // Once a Seat Code from a Team Purchase has been Redeemed, that Seat belongs
  // to its recipient — the Purchaser cannot hand it back on their own.
  if (hasRedeemedSeatCode(purchase.id)) {
    return { eligible: false, reason: "redeemed_seat_code" };
  }

  const purchasedDay = calendarDay(new Date(purchase.createdAt));
  const windowEnd = new Date(purchase.createdAt);
  windowEnd.setDate(windowEnd.getDate() + REFUND_REQUEST_WINDOW_DAYS);
  const lastDayInWindow = calendarDay(windowEnd);
  const today = calendarDay(new Date());

  if (today < purchasedDay || today > lastDayInWindow) {
    return { eligible: false, reason: "outside_window" };
  }

  const lessonIds = getLessonIdsForCourse(course.id);

  if (
    lessonIds.length > 0 &&
    getCompletedLessonCount(userId, lessonIds) / lessonIds.length >=
      MAX_COURSE_PROGRESS
  ) {
    return { eligible: false, reason: "too_much_completed" };
  }

  if (getSecondsWatched(userId, lessonIds) >= MAX_SECONDS_WATCHED) {
    return { eligible: false, reason: "too_much_watched" };
  }

  // A Purchase made at a PPP price is refunded at that price, not at the
  // Course Price.
  const pppDiscount = getDiscountForCountry(purchase.country);
  const amount = pppDiscount > 0 ? purchase.amountPaid : course.price;

  return { eligible: true, purchase, amount, lastDayInWindow };
}
