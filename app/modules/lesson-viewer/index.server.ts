import { db } from "~/db";
import type { Db } from "./lib/db";
import { buildLessonPage, type LessonPageRequest } from "./lib/page";
import { markLessonComplete } from "./lib/progress";
import { submitQuiz } from "./lib/quiz-learner";
import { getCommentById } from "./lib/thread";

export type { Db, LessonPageRequest };

/**
 * Everything the lesson page reads and writes: the lesson in its course, a
 * learner's progress, the Discussion thread and the quiz. The app uses
 * `lessonViewer`; tests build their own against a test database.
 */
export function createLessonViewer(database: Db) {
  return {
    /**
     * The lesson page's data, locked or full, or null when the lesson is
     * missing. A full view by someone who can take the course marks the
     * lesson in progress for them.
     */
    lessonPage: (request: LessonPageRequest) =>
      buildLessonPage(database, request),

    markComplete: (userId: number, lessonId: number, now: Date) => {
      markLessonComplete(database, { userId, lessonId, now });
    },

    /** Whether a comment id belongs to this lesson's Discussion. */
    isCommentInLesson: (commentId: number, lessonId: number) =>
      getCommentById(database, commentId)?.lessonId === lessonId,

    /**
     * Scores a quiz form (`quizId`, `question-{id}` = option id) and records
     * the attempt. Throws 400 for a malformed quiz id, 404 for a quiz that is
     * not on this lesson.
     */
    submitQuiz: (userId: number, lessonId: number, formData: FormData) =>
      submitQuiz(database, { userId, lessonId, formData }),
  };
}

export const lessonViewer = createLessonViewer(db);
