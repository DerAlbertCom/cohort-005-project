import type { Db } from "./db";
import {
  flattenCourseLessons,
  getCourseOutline,
  getLessonById,
  getModuleById,
} from "./course";

/**
 * The lesson inside its course: the lesson row, its module, the curriculum
 * for the sidebar, and its neighbours for prev/next. Null when the course,
 * lesson or module is missing.
 */
export function findLessonInCourse(
  database: Db,
  courseId: number,
  lessonId: number
) {
  const courseWithDetails = getCourseOutline(database, courseId);
  const lesson = getLessonById(database, lessonId);
  const mod = lesson ? getModuleById(database, lesson.moduleId) : undefined;
  if (!courseWithDetails || !lesson || !mod) return null;

  const curriculum = courseWithDetails.modules.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: m.lessons.map((l) => ({ id: l.id, title: l.title })),
  }));

  const allLessons = flattenCourseLessons(courseWithDetails);
  const currentIndex = allLessons.findIndex((l) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null;
  const nextLesson =
    currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null;

  return {
    course: {
      id: courseWithDetails.id,
      title: courseWithDetails.title,
      slug: courseWithDetails.slug,
    },
    curriculum,
    module: { id: mod.id, title: mod.title },
    lesson,
    prevLesson,
    nextLesson,
  };
}
