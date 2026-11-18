import { and, desc, eq } from "drizzle-orm";
import {
  quizAnswers,
  quizAttempts,
  quizOptions,
  quizQuestions,
  quizzes,
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

  const questionsWithOptions = questions.map((question) => {
    const options = database
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all();
    return { ...question, options };
  });

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

function findCorrectOptionId(database: Db, question: QuizQuestion) {
  if (question.questionType === "multiple_choice") {
    const opts = database
      .select()
      .from(quizOptions)
      .where(eq(quizOptions.questionId, question.id))
      .all();
    const correctOpt = opts.find((o) => o.isCorrect === true);
    return correctOpt ? correctOpt.id : null;
  }
  if (question.questionType === "true_false") {
    const correctOpt = database
      .select()
      .from(quizOptions)
      .where(
        and(
          eq(quizOptions.questionId, question.id),
          eq(quizOptions.isCorrect, true)
        )
      )
      .get();
    return correctOpt ? correctOpt.id : null;
  }
  return null;
}

function markQuestion(
  database: Db,
  question: QuizQuestion,
  selected: number | undefined
): QuestionResult {
  if (!selected) {
    return {
      questionId: question.id,
      correct: false,
      selectedOptionId: null,
      correctOptionId: null,
    };
  }
  const correctOptionId = findCorrectOptionId(database, question);
  return {
    questionId: question.id,
    correct: selected === correctOptionId,
    selectedOptionId: selected,
    correctOptionId,
  };
}

function recordAttempt(
  database: Db,
  attempt: { userId: number; quizId: number; score: number; passed: boolean },
  questionResults: QuestionResult[]
) {
  const saved = database.insert(quizAttempts).values(attempt).returning().get();
  for (const result of questionResults) {
    if (result.selectedOptionId !== null) {
      database
        .insert(quizAnswers)
        .values({
          attemptId: saved.id,
          questionId: result.questionId,
          selectedOptionId: result.selectedOptionId,
        })
        .run();
    }
  }
  return saved;
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
    const questionResults = questions.map((q) =>
      markQuestion(database, q, selectedAnswers[q.id])
    );
    const correct = questionResults.filter((r) => r.correct).length;
    const total = questions.length;
    const scoreValue = total > 0 ? correct / total : 0;
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
      totalCorrect: correct,
      totalQuestions: total,
      questionResults,
    };
  } catch (error) {
    console.error(error);
    return null;
  }
}
