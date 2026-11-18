import { eq, or } from "drizzle-orm";
import { courses, lessons, modules, users } from "~/db/schema";
import type { Db } from "./db";

export function getCourseOutline(database: Db, id: number) {
  const course = database
    .select({ id: courses.id, title: courses.title, slug: courses.slug })
    .from(courses)
    .where(eq(courses.id, id))
    .get();

  if (!course) return null;

  const courseModules = database
    .select()
    .from(modules)
    .where(eq(modules.courseId, id))
    .orderBy(modules.position)
    .all();

  const moduleIds = courseModules.map((m) => m.id);

  const courseLessons =
    moduleIds.length > 0
      ? database
          .select()
          .from(lessons)
          .where(or(...moduleIds.map((mid) => eq(lessons.moduleId, mid))))
          .orderBy(lessons.position)
          .all()
      : [];

  return {
    ...course,
    modules: courseModules.map((mod) => ({
      ...mod,
      lessons: courseLessons.filter((l) => l.moduleId === mod.id),
    })),
  };
}

export function getLessonById(database: Db, id: number) {
  return database.select().from(lessons).where(eq(lessons.id, id)).get();
}

export function getModuleById(database: Db, id: number) {
  return database.select().from(modules).where(eq(modules.id, id)).get();
}

export function getUserById(database: Db, id: number) {
  return database.select().from(users).where(eq(users.id, id)).get();
}

export type FlatLesson = {
  id: number;
  title: string;
  moduleId: number;
  moduleTitle: string;
};

export function flattenCourseLessons(course: {
  modules: Array<{
    id: number;
    title: string;
    lessons: Array<{ id: number; title: string; moduleId: number }>;
  }>;
}): FlatLesson[] {
  const flat: FlatLesson[] = [];
  for (const mod of course.modules) {
    for (const lesson of mod.lessons) {
      flat.push({
        id: lesson.id,
        title: lesson.title,
        moduleId: mod.id,
        moduleTitle: mod.title,
      });
    }
  }
  return flat;
}
