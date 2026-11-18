import { and, desc, eq, inArray } from "drizzle-orm";
import {
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
  QuestionType,
} from "~/db/schema";
import type { Db } from "./db";

export function getQuizByLessonId(database: Db, lessonId: number) {
  return database
    .select()
    .from(quizzes)
    .where(eq(quizzes.lessonId, lessonId))
    .get();
}

export function getQuizWithQuestions(database: Db, quizId: number) {
  const quiz = database
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .get();
  if (!quiz) return null;

  const questions = database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();

  const options =
    questions.length === 0
      ? []
      : database
          .select()
          .from(quizOptions)
          .where(
            inArray(
              quizOptions.questionId,
              questions.map((q) => q.id)
            )
          )
          .all();
  const questionsWithOptions = questions.map((question) => ({
    ...question,
    options: options.filter((o) => o.questionId === question.id),
  }));

  return { ...quiz, questions: questionsWithOptions };
}

export function getBestAttempt(database: Db, userId: number, quizId: number) {
  return database
    .select()
    .from(quizAttempts)
    .where(
      and(eq(quizAttempts.userId, userId), eq(quizAttempts.quizId, quizId))
    )
    .orderBy(desc(quizAttempts.score))
    .limit(1)
    .get();
}

function calculateGrade(score: number): string {
  if (score >= 0.9) return "A";
  if (score >= 0.8) return "B";
  if (score >= 0.7) return "C";
  if (score >= 0.6) return "D";
  return "F";
}

export type QuestionResult = {
  questionId: number;
  correct: boolean;
  selectedOptionId: number | null;
  correctOptionId: number | null;
};

export type QuizResult = NonNullable<ReturnType<typeof computeResult>>;

type QuizQuestion = typeof quizQuestions.$inferSelect;

const GRADED_TYPES: readonly string[] = [
  QuestionType.MultipleChoice,
  QuestionType.TrueFalse,
];

/** Question id to its correct option id, in one query for the whole quiz. */
function correctOptionIds(database: Db, questions: QuizQuestion[]) {
  const graded = questions
    .filter((q) => GRADED_TYPES.includes(q.questionType))
    .map((q) => q.id);
  const correct = new Map<number, number>();
  if (graded.length === 0) return correct;
  const rows = database
    .select({ id: quizOptions.id, questionId: quizOptions.questionId })
    .from(quizOptions)
    .where(
      and(
        inArray(quizOptions.questionId, graded),
        eq(quizOptions.isCorrect, true)
      )
    )
    .orderBy(quizOptions.id)
    .all();
  for (const row of rows) {
    if (!correct.has(row.questionId)) correct.set(row.questionId, row.id);
  }
  return correct;
}

function markQuestion(
  question: QuizQuestion,
  selected: number | undefined,
  correctOptionId: number | null
): QuestionResult {
  if (!selected) {
    return {
      questionId: question.id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    };
  }
  return {
    questionId: question.id,
    correct: selected === correctOptionId,
    selectedOptionId: selected,
    correctOptionId,
  };
}

/** The attempt and its answers land together or not at all. */
function recordAttempt(
  database: Db,
  attempt: { userId: number; quizId: number; score: number; passed: boolean },
  questionResults: QuestionResult[]
) {
  return database.transaction((tx) => {
    const saved = tx.insert(quizAttempts).values(attempt).returning().get();
    const answers = questionResults.flatMap((result) =>
      result.selectedOptionId === null
        ? []
        : [
            {
              attemptId: saved.id,
              questionId: result.questionId,
              selectedOptionId: result.selectedOptionId,
            },
          ]
    );
    if (answers.length > 0) tx.insert(quizAnswers).values(answers).run();
    return saved;
  });
}

function getQuizQuestions(database: Db, quizId: number) {
  return database
    .select()
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId))
    .orderBy(quizQuestions.position)
    .all();
}

export function computeResult(
  database: Db,
  submission: {
    userId: number;
    quizId: number;
    selectedAnswers: Record<number, number>;
  }
) {
  const { userId, quizId, selectedAnswers } = submission;
  try {
    const quiz = database
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, quizId))
      .get();
    if (!quiz) {
      console.error("quiz not found");
      return null;
    }

    const questions = getQuizQuestions(database, quizId);
    const correctOptions = correctOptionIds(database, questions);
    const questionResults = questions.map((q) =>
      markQuestion(q, selectedAnswers[q.id], correctOptions.get(q.id) ?? null)
    );
    const totalCorrect = questionResults.filter((r) => r.correct).length;
    const total = questions.length;
    const scoreValue = total > 0 ? totalCorrect / total : 0;
    const passed = scoreValue > 0.7;

    const attempt = recordAttempt(
      database,
      { userId, quizId, score: scoreValue, passed },
      questionResults
    );

    return {
      attemptId: attempt.id,
      score: scoreValue,
      passed,
      grade: calculateGrade(scoreValue),
      totalCorrect,
      totalQuestions: total,
      questionResults,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
