import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { QuestionType } from "~/db/schema";
import { markdown } from "~/lib/text";
import { createLessonViewer, type LessonPageRequest } from "../index.server";
import { quizSubmissionSchema } from "../index";

export const NOW = new Date("2026-10-06T12:00:00.000Z");

export function setup() {
  const db = createTestDb();
  const base = seedBaseData(db);
  const viewer = createLessonViewer(db);
  return { db, base, viewer };
}

export function addModule(db: TestDb, courseId: number, position: number) {
  return db
    .insert(schema.modules)
    .values({ courseId, title: `Module ${position}`, position })
    .returning()
    .get();
}

export function addLesson(
  db: TestDb,
  lesson: {
    moduleId: number;
    position: number;
    content?: string;
    videoUrl?: string;
    durationMinutes?: number;
  }
) {
  return db
    .insert(schema.lessons)
    .values({
      moduleId: lesson.moduleId,
      title: `Lesson ${lesson.moduleId}.${lesson.position}`,
      position: lesson.position,
      content: lesson.content === undefined ? null : markdown(lesson.content),
      videoUrl: lesson.videoUrl ?? null,
      durationMinutes: lesson.durationMinutes ?? null,
    })
    .returning()
    .get();
}

export function addWatchEvent(
  db: TestDb,
  event: {
    userId: number;
    lessonId: number;
    positionSeconds: number;
    createdAt: string;
  }
) {
  db.insert(schema.videoWatchEvents)
    .values({ ...event, eventType: "progress" })
    .run();
}

/**
 * A two-question quiz: one multiple choice, one true/false. Returns the
 * ids of the right and wrong option for each question.
 */
export function addQuiz(db: TestDb, lessonId: number) {
  const quiz = db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Check yourself", passingScore: 0.7 })
    .returning()
    .get();

  const question = (type: QuestionType, position: number) => {
    const row = db
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Question ${position}`,
        questionType: type,
        position,
      })
      .returning()
      .get();
    const option = (optionText: string, isCorrect: boolean) =>
      db
        .insert(schema.quizOptions)
        .values({ questionId: row.id, optionText, isCorrect })
        .returning()
        .get().id;
    return {
      id: row.id,
      wrong: option("Wrong", false),
      right: option("Right", true),
    };
  };

  // Inserted out of order so position, not id, decides the order.
  const trueFalse = question(QuestionType.TrueFalse, 2);
  const multipleChoice = question(QuestionType.MultipleChoice, 1);
  return { id: quiz.id, multipleChoice, trueFalse };
}

/** A quiz form as the browser posts it, parsed the way the route parses it. */
export function quizForm(fields: Record<string, string | number>) {
  return quizSubmissionSchema.parse(
    Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [name, String(value)])
    )
  );
}

export function pageRequest(
  overrides: Partial<LessonPageRequest> &
    Pick<LessonPageRequest, "courseId" | "instructorId" | "lessonId">
): LessonPageRequest {
  return {
    currentUserId: null,
    enrolled: false,
    view: { allowed: true },
    canTake: false,
    canModerate: false,
    ...overrides,
  };
}

/** A quiz of `size` true/false questions; returns each right option id. */
export function addTrueFalseQuiz(db: TestDb, lessonId: number, size: number) {
  const quiz = db
    .insert(schema.quizzes)
    .values({ lessonId, title: "Long quiz", passingScore: 0.7 })
    .returning()
    .get();
  const questions = Array.from({ length: size }, (_, index) => {
    const question = db
      .insert(schema.quizQuestions)
      .values({
        quizId: quiz.id,
        questionText: `Statement ${index}`,
        questionType: QuestionType.TrueFalse,
        position: index,
      })
      .returning()
      .get();
    const option = (isCorrect: boolean) =>
      db
        .insert(schema.quizOptions)
        .values({
          questionId: question.id,
          optionText: String(isCorrect),
          isCorrect,
        })
        .returning()
        .get().id;
    return { id: question.id, wrong: option(false), right: option(true) };
  });
  return { id: quiz.id, questions };
}
