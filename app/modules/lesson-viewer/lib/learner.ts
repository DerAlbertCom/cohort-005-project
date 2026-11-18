import type { Db } from "./db";
import {
  calculateWatchProgress,
  getLastWatchPosition,
  getLessonProgress,
  getLessonProgressForCourse,
  markLessonInProgress,
} from "./progress";

export type LearnerProgress = {
  lessonStatus: string | null;
  lastWatchPosition: number;
  watchProgress: number;
  lessonProgressMap: Record<number, string>;
};

export const NO_PROGRESS: LearnerProgress = {
  lessonStatus: null,
  lastWatchPosition: 0,
  watchProgress: 0,
  lessonProgressMap: {},
};

/**
 * Marks the lesson in progress for this learner, then reads back where they
 * are: the lesson's status, every lesson's status in the course, and how far
 * into the video they got.
 */
export function recordLessonVisit(
  database: Db,
  visit: {
    userId: number;
    courseId: number;
    lesson: {
      id: number;
      videoUrl: string | null;
      durationMinutes: number | null;
    };
  }
): LearnerProgress {
  const { userId, courseId, lesson } = visit;
  markLessonInProgress(database, userId, lesson.id);
  const progress = getLessonProgress(database, userId, lesson.id);

  const lessonProgressMap: Record<number, string> = {};
  for (const record of getLessonProgressForCourse(database, userId, courseId)) {
    lessonProgressMap[record.lessonId] = record.status;
  }

  let lastWatchPosition = 0;
  let watchProgress = 0;
  if (lesson.videoUrl) {
    lastWatchPosition = getLastWatchPosition(database, userId, lesson.id);
    const videoDurationSeconds = (lesson.durationMinutes ?? 0) * 60;
    if (videoDurationSeconds > 0) {
      watchProgress = calculateWatchProgress(database, {
        userId,
        lessonId: lesson.id,
        videoDurationSeconds,
      });
    }
  }

  return {
    lessonStatus: progress?.status ?? null,
    lastWatchPosition,
    watchProgress,
    lessonProgressMap,
  };
}
