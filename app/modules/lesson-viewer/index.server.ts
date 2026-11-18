import { db } from "~/db";
import type { Db } from "./lib/db";
import { buildLessonPage, type LessonPageRequest } from "./lib/page";
import { markLessonComplete } from "./lib/progress";
import { submitQuiz } from "./lib/quiz-learner";
import type { QuizSubmission } from "./lib/quiz-submission";
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
     * Scores a parsed quiz submission and records the attempt. Throws 404 for
     * a quiz that is not on this lesson.
     */
    submitQuiz: (
      userId: number,
      lessonId: number,
      submission: QuizSubmission
    ) => submitQuiz(database, { userId, lessonId, ...submission }),
  };
}

export const lessonViewer = createLessonViewer(db);
