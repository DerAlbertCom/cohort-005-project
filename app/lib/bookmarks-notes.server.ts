import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { noteBodySchema } from "./bookmarks-notes";

type Db = BetterSQLite3Database<typeof schema>;

// These reads always belong to the signed-in owner, never to a staff view.
// Routes enforce course content access before reading or writing a Lesson.
export function getBookmark(db: Db, userId: number, lessonId: number) {
  return db
    .select()
    .from(bookmarks)
    .where(and(eq(bookmarks.userId, userId), eq(bookmarks.lessonId, lessonId)))
    .get();
}

export function toggleBookmark(
  db: Db,
  userId: number,
  lessonId: number,
  now: Date
) {
  return db.transaction((tx) => {
    const existing = getBookmark(tx, userId, lessonId);
    if (existing) {
      tx.delete(bookmarks).where(eq(bookmarks.id, existing.id)).run();
      return false;
    }

    tx.insert(bookmarks)
      .values({ userId, lessonId, createdAt: now.toISOString() })
      .run();
    return true;
  });
}

export function getNote(db: Db, userId: number, lessonId: number) {
  return db
    .select({ body: notes.body, updatedAt: notes.updatedAt })
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
    .get();
}

export function saveNote(
  db: Db,
  userId: number,
  lessonId: number,
  body: string,
  now: Date
) {
  const parsed = noteBodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid note.",
    } as const;
  }

  if (parsed.data.length === 0) {
    db.delete(notes)
      .where(and(eq(notes.userId, userId), eq(notes.lessonId, lessonId)))
      .run();
    return { ok: true } as const;
  }

  const timestamp = now.toISOString();
  db.insert(notes)
    .values({
      userId,
      lessonId,
      body: parsed.data,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: { body: parsed.data, updatedAt: timestamp },
    })
    .run();
  return { ok: true } as const;
}

const savedLessonFields = {
  lessonId: lessons.id,
  lessonTitle: lessons.title,
  moduleTitle: modules.title,
  courseTitle: courses.title,
  courseSlug: courses.slug,
};

export function getSavedForUser(db: Db, userId: number) {
  const savedBookmarks = db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      ...savedLessonFields,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(lessons.id, bookmarks.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(bookmarks.userId, userId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();

  const savedNotes = db
    .select({
      id: notes.id,
      body: notes.body,
      updatedAt: notes.updatedAt,
      ...savedLessonFields,
    })
    .from(notes)
    .innerJoin(lessons, eq(lessons.id, notes.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(courses, eq(courses.id, modules.courseId))
    .where(eq(notes.userId, userId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();

  return { savedBookmarks, savedNotes };
}
