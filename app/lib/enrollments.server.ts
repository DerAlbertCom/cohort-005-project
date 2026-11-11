import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "~/db";
import { enrollments } from "~/db/schema";

// ─── Enrollments ───
// An Issued Refund soft-revokes an Enrollment by setting `revokedAt` instead
// of deleting it (ADR 0001). Every query that asks "is this Student enrolled?"
// must ignore revoked rows, so they all go through these helpers.
//
// Uses positional parameters (project convention).

/** Where-clause fragment that keeps only Enrollments with Content Access. */
export const isActiveEnrollment = isNull(enrollments.revokedAt);

export function activeEnrollmentOf(userId: number, courseId: number) {
  return and(
    eq(enrollments.userId, userId),
    eq(enrollments.courseId, courseId),
    isActiveEnrollment
  );
}

export function findActiveEnrollment(userId: number, courseId: number) {
  return db
    .select()
    .from(enrollments)
    .where(activeEnrollmentOf(userId, courseId))
    .get();
}

export function isEnrolled(userId: number, courseId: number) {
  return !!findActiveEnrollment(userId, courseId);
}

/**
 * Enrolls the Student, or gives back Content Access through their earlier
 * Enrollment if a Refund revoked it, so their old Lesson Progress returns.
 */
export function enroll(userId: number, courseId: number) {
  const existing = db
    .select()
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .orderBy(enrollments.id)
    .get();

  if (!existing) {
    return db
      .insert(enrollments)
      .values({ userId, courseId })
      .returning()
      .get();
  }

  if (existing.revokedAt === null) return existing;

  return db
    .update(enrollments)
    .set({ revokedAt: null })
    .where(eq(enrollments.id, existing.id))
    .returning()
    .get();
}

export function revokeEnrollment(userId: number, courseId: number) {
  db.update(enrollments)
    .set({ revokedAt: new Date().toISOString() })
    .where(activeEnrollmentOf(userId, courseId))
    .run();
}

/** Gives back a revoked Enrollment. Returns false if there was none. */
export function restoreEnrollment(userId: number, courseId: number) {
  const restored = db
    .update(enrollments)
    .set({ revokedAt: null })
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.courseId, courseId),
        isNotNull(enrollments.revokedAt)
      )
    )
    .returning()
    .all();

  return restored.length > 0;
}
