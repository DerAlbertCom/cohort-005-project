import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  getBookmark,
  getNote,
  getSavedForUser,
  saveNote,
  toggleBookmark,
} from "./bookmarks-notes.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { fakeNotifications } from "./notifications.fake.server";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const LATER = new Date("2026-10-06T13:00:00.000Z");
const LATEST = new Date("2026-10-06T14:00:00.000Z");

let db: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;
let lesson: typeof schema.lessons.$inferSelect;
let otherLesson: typeof schema.lessons.$inferSelect;
let otherStudent: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();
  lesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "First lesson", position: 1 })
    .returning()
    .get();
  otherLesson = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Second lesson", position: 2 })
    .returning()
    .get();
  otherStudent = db
    .insert(schema.users)
    .values({
      name: "Other Student",
      email: "other@example.com",
      role: schema.UserRole.Student,
    })
    .returning()
    .get();
});

afterEach(() => {
  db.$client.close();
});

describe("Bookmarks", () => {
  it("toggles a Lesson on, off, and on again without duplicates", () => {
    expect(getBookmark(db, base.user.id, lesson.id)).toBeUndefined();
    expect(toggleBookmark(db, base.user.id, lesson.id, NOW)).toBe(true);
    expect(getSavedForUser(db, base.user.id).savedBookmarks).toHaveLength(1);
    expect(toggleBookmark(db, base.user.id, lesson.id, LATER)).toBe(false);
    expect(getSavedForUser(db, base.user.id).savedBookmarks).toEqual([]);
    expect(toggleBookmark(db, base.user.id, lesson.id, LATEST)).toBe(true);
    expect(getSavedForUser(db, base.user.id).savedBookmarks).toHaveLength(1);
  });

  it("does not toggle another Student's Bookmark", () => {
    toggleBookmark(db, otherStudent.id, lesson.id, NOW);
    toggleBookmark(db, base.user.id, lesson.id, NOW);
    toggleBookmark(db, base.user.id, lesson.id, LATER);
    expect(getSavedForUser(db, otherStudent.id).savedBookmarks).toHaveLength(1);
    expect(getSavedForUser(db, base.user.id).savedBookmarks).toEqual([]);
  });

  it("enforces one Bookmark per Student per Lesson in the database", () => {
    toggleBookmark(db, base.user.id, lesson.id, NOW);
    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
        })
        .run()
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("Notes", () => {
  it("starts empty and saves trimmed plain text, including line breaks", () => {
    expect(getNote(db, base.user.id, lesson.id)).toBeUndefined();
    expect(
      saveNote(
        db,
        base.user.id,
        lesson.id,
        "  # Heading\n*literal* <b>text</b>  ",
        NOW
      )
    ).toEqual({ ok: true });
    expect(getNote(db, base.user.id, lesson.id)).toEqual({
      body: "# Heading\n*literal* <b>text</b>",
      updatedAt: NOW.toISOString(),
    });
  });

  it("replaces a Note and advances last edited without creating duplicates", () => {
    saveNote(db, base.user.id, lesson.id, "Original", NOW);
    saveNote(db, base.user.id, lesson.id, "Revised", LATER);
    expect(getNote(db, base.user.id, lesson.id)).toEqual({
      body: "Revised",
      updatedAt: LATER.toISOString(),
    });
    expect(getSavedForUser(db, base.user.id).savedNotes).toHaveLength(1);
  });

  it("accepts exactly 2,000 characters after trimming", () => {
    expect(
      saveNote(db, base.user.id, lesson.id, `  ${"a".repeat(2000)}  `, NOW)
    ).toEqual({ ok: true });
    expect(getNote(db, base.user.id, lesson.id)?.body).toHaveLength(2000);
  });

  it("refuses 2,001 characters with a clear message without changing the saved Note", () => {
    saveNote(db, base.user.id, lesson.id, "Keep this", NOW);
    expect(
      saveNote(db, base.user.id, lesson.id, "a".repeat(2001), LATER)
    ).toEqual({ ok: false, error: "Note must be 2000 characters or fewer." });
    expect(getNote(db, base.user.id, lesson.id)).toEqual({
      body: "Keep this",
      updatedAt: NOW.toISOString(),
    });
    expect(
      saveNote(db, base.user.id, otherLesson.id, "a".repeat(2001), LATER).ok
    ).toBe(false);
    expect(getNote(db, base.user.id, otherLesson.id)).toBeUndefined();
  });

  it("keeps Notes private when reading, editing, and clearing", () => {
    saveNote(
      db,
      otherStudent.id,
      lesson.id,
      "Private to the other Student",
      NOW
    );
    expect(getNote(db, base.user.id, lesson.id)).toBeUndefined();
    expect(getNote(db, base.instructor.id, lesson.id)).toBeUndefined();
    saveNote(db, base.user.id, lesson.id, "My own", NOW);
    saveNote(db, base.user.id, lesson.id, " \n ", LATER);
    expect(getNote(db, base.user.id, lesson.id)).toBeUndefined();
    expect(getSavedForUser(db, base.user.id).savedNotes).toEqual([]);
    expect(getNote(db, otherStudent.id, lesson.id)?.body).toBe(
      "Private to the other Student"
    );
  });

  it("enforces one Note per Student per Lesson in the database", () => {
    saveNote(db, base.user.id, lesson.id, "Only one", NOW);
    expect(() =>
      db
        .insert(schema.notes)
        .values({
          userId: base.user.id,
          lessonId: lesson.id,
          body: "Duplicate",
        })
        .run()
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("Saved", () => {
  it("starts with empty lists", () => {
    expect(getSavedForUser(db, base.user.id)).toEqual({
      savedBookmarks: [],
      savedNotes: [],
    });
  });

  it("lists only the owner's rows, newest first, with Lesson and Course details", () => {
    const secondCourse = db
      .insert(schema.courses)
      .values({
        title: "Another course",
        slug: "another-course",
        description: "Another course",
        salesCopy: "Another course",
        status: schema.CourseStatus.Published,
        instructorId: base.instructor.id,
        categoryId: base.category.id,
      })
      .returning()
      .get();
    const secondModule = db
      .insert(schema.modules)
      .values({ courseId: secondCourse.id, title: "Advanced", position: 1 })
      .returning()
      .get();
    const secondCourseLesson = db
      .insert(schema.lessons)
      .values({
        moduleId: secondModule.id,
        title: "Advanced lesson",
        position: 1,
      })
      .returning()
      .get();
    toggleBookmark(db, base.user.id, lesson.id, NOW);
    toggleBookmark(db, base.user.id, secondCourseLesson.id, LATER);
    toggleBookmark(db, otherStudent.id, otherLesson.id, LATEST);
    saveNote(db, base.user.id, lesson.id, "First", NOW);
    saveNote(db, base.user.id, secondCourseLesson.id, "Second", LATER);
    saveNote(db, base.user.id, lesson.id, "Edited first", LATEST);
    saveNote(db, otherStudent.id, otherLesson.id, "Not yours", LATEST);

    const saved = getSavedForUser(db, base.user.id);
    expect(saved.savedBookmarks.map((row) => row.lessonTitle)).toEqual([
      "Advanced lesson",
      "First lesson",
    ]);
    expect(saved.savedNotes.map((row) => row.body)).toEqual([
      "Edited first",
      "Second",
    ]);
    expect(saved.savedBookmarks[0]).toMatchObject({
      lessonId: secondCourseLesson.id,
      moduleTitle: "Advanced",
      courseTitle: "Another course",
      courseSlug: "another-course",
    });
    expect(saved.savedNotes[0]).toMatchObject({
      lessonId: lesson.id,
      lessonTitle: "First lesson",
      courseTitle: base.course.title,
      courseSlug: base.course.slug,
    });
    expect(getSavedForUser(db, base.instructor.id)).toEqual({
      savedBookmarks: [],
      savedNotes: [],
    });
  });

  it("keeps Bookmarks and Notes after an approved Refund and re-enrollment", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: NOW.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    toggleBookmark(db, base.user.id, lesson.id, NOW);
    saveNote(db, base.user.id, lesson.id, "Keep for when I return", NOW);
    const before = getSavedForUser(db, base.user.id);
    const notifications = fakeNotifications();
    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Not for me",
      LATER,
      notifications
    );
    expect(raised.ok).toBe(true);
    if (!raised.ok) throw new Error(raised.error);
    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      admin.id,
      null,
      LATEST,
      notifications
    );
    expect(approved.ok).toBe(true);
    expect(getSavedForUser(db, base.user.id)).toEqual(before);
    expect(getSavedForUser(db, admin.id).savedNotes).toEqual([]);
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();
    expect(getBookmark(db, base.user.id, lesson.id)).toBeDefined();
    expect(getNote(db, base.user.id, lesson.id)?.body).toBe(
      "Keep for when I return"
    );
  });
});
