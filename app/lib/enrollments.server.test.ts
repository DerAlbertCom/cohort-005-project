import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";

const testDb = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createTestDb> | undefined,
}));

vi.mock("~/db", () => ({
  get db() {
    if (!testDb.current) throw new Error("Test database not created");
    return testDb.current;
  },
}));

import {
  enroll,
  isEnrolled,
  restoreEnrollment,
  revokeEnrollment,
} from "./enrollments.server";

let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  testDb.current = createTestDb();
  base = seedBaseData(testDb.current);
});

describe("enrollments", () => {
  it("counts a Student as enrolled once they enroll", () => {
    expect(isEnrolled(base.user.id, base.course.id)).toBe(false);

    enroll(base.user.id, base.course.id);

    expect(isEnrolled(base.user.id, base.course.id)).toBe(true);
  });

  it("does not count a revoked Enrollment", () => {
    enroll(base.user.id, base.course.id);

    revokeEnrollment(base.user.id, base.course.id);

    expect(isEnrolled(base.user.id, base.course.id)).toBe(false);
  });

  it("restores the original Enrollment when a revoked Student enrolls again", () => {
    const original = enroll(base.user.id, base.course.id);
    revokeEnrollment(base.user.id, base.course.id);

    const restored = enroll(base.user.id, base.course.id);

    expect(restored.id).toBe(original.id);
    expect(restored.enrolledAt).toBe(original.enrolledAt);
    expect(restored.revokedAt).toBeNull();
    expect(isEnrolled(base.user.id, base.course.id)).toBe(true);
  });

  it("returns the existing Enrollment instead of creating a second one", () => {
    const first = enroll(base.user.id, base.course.id);

    expect(enroll(base.user.id, base.course.id).id).toBe(first.id);
  });

  it("restores a revoked Enrollment by hand", () => {
    enroll(base.user.id, base.course.id);
    revokeEnrollment(base.user.id, base.course.id);

    expect(restoreEnrollment(base.user.id, base.course.id)).toBe(true);
    expect(isEnrolled(base.user.id, base.course.id)).toBe(true);
  });

  it("does not create an Enrollment when there is nothing to restore", () => {
    expect(restoreEnrollment(base.user.id, base.course.id)).toBe(false);
    expect(isEnrolled(base.user.id, base.course.id)).toBe(false);
  });
});
