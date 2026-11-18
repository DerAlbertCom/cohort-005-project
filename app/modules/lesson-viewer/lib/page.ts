import { isBookmarked } from "~/lib/bookmarks.server";
import { renderMarkdown } from "~/lib/markdown.server";
import type { Markdown } from "~/lib/text";
import { getNote } from "~/lib/notes.server";
import type { DenialReason } from "~/modules/permissions/course-permissions.server";
import { getUserById } from "./course";
import type { Db } from "./db";
import { NO_PROGRESS, recordLessonVisit } from "./learner";
import { findLessonInCourse } from "./outline";
import { getQuizForLearner } from "./quiz-learner";
import { getLessonThread, renderThread } from "./thread";

export type LessonPageRequest = {
  courseId: number;
  instructorId: number;
  lessonId: number;
  currentUserId: number | null;
  enrolled: boolean;
  view: { allowed: true } | { allowed: false; reason: DenialReason };
  canTake: boolean;
  canModerate: boolean;
};

/**
 * Everything the lesson page shows. Null when the lesson is missing.
 *
 * Someone who can't view the content gets the lesson's title, its module and
 * the course outline — never the body, video or quiz — plus the reason, so
 * the page can show the right call to action.
 */
export async function buildLessonPage(
  database: Db,
  request: LessonPageRequest
) {
  const found = findLessonInCourse(
    database,
    request.courseId,
    request.lessonId
  );
  if (!found) return null;
  const { course, curriculum, module, lesson, prevLesson, nextLesson } = found;
  const { currentUserId, enrolled } = request;

  if (!request.view.allowed) {
    return {
      view: "locked" as const,
      course,
      curriculum,
      module,
      lesson: { id: lesson.id, title: lesson.title },
      enrolled,
      lockedReason: request.view.reason,
    };
  }

  // Progress is recorded only for people who can take the course, so a
  // Student under a Country Lock gets none.
  const progress =
    currentUserId && request.canTake
      ? recordLessonVisit(database, {
          userId: currentUserId,
          courseId: course.id,
          lesson,
        })
      : NO_PROGRESS;

  const personal = await personalData(database, request, lesson);

  return {
    view: "full" as const,
    course,
    curriculum,
    module,
    lesson,
    ...progress,
    enrolled,
    currentUserId,
    prevLesson,
    nextLesson,
    ...personal,
    canModerate: request.canModerate,
  };
}

/**
 * Everything behind the can-view-content bar: the lesson body, its quiz,
 * comments, Bookmarks and Notes are confidential to the course.
 */
async function personalData(
  database: Db,
  request: LessonPageRequest,
  lesson: { content: Markdown | null }
) {
  const { currentUserId, lessonId } = request;
  const instructor = getUserById(database, request.instructorId);
  const note = currentUserId
    ? getNote(database, currentUserId, lessonId)
    : undefined;
  return {
    contentHtml: lesson.content ? await renderMarkdown(lesson.content) : null,
    ...getQuizForLearner(database, lessonId, currentUserId),
    comments: await renderThread(getLessonThread(database, lessonId)),
    instructorName: instructor?.name ?? "your instructor",
    bookmarked: currentUserId
      ? isBookmarked(database, currentUserId, lessonId)
      : false,
    note: note ? { body: note.body, updatedAt: note.updatedAt } : null,
  };
}

export type LessonPage = NonNullable<
  Awaited<ReturnType<typeof buildLessonPage>>
>;
export type FullLessonPage = Extract<LessonPage, { view: "full" }>;
export type LockedLessonPage = Extract<LessonPage, { view: "locked" }>;
