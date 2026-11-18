import { eq } from "drizzle-orm";
import { data } from "react-router";
import { quizzes } from "~/db/schema";
import type { Db } from "./db";
import {
  computeResult,
  getBestAttempt,
  getQuizByLessonId,
  getQuizWithQuestions,
} from "./quiz";
import type { QuizSubmission } from "./quiz-submission";

export type LearnerQuiz = {
  id: number;
  title: string;
  passingScore: number;
  questions: Array<{
    id: number;
    questionText: string;
    questionType: string;
    position: number;
    options: Array<{ id: number; optionText: string }>;
  }>;
};

/** The lesson's quiz with the answers stripped, and the learner's best try. */
export function getQuizForLearner(
  database: Db,
  lessonId: number,
  userId: number | null
) {
  const quizRecord = getQuizByLessonId(database, lessonId);
  let quiz: LearnerQuiz | null = null;
  let bestAttempt: { score: number; passed: boolean } | null = null;
  if (!quizRecord) return { quiz, bestAttempt };

  const quizData = getQuizWithQuestions(database, quizRecord.id);
  if (quizData) {
    // Strip isCorrect from options so answers aren't leaked to the client
    quiz = {
      id: quizData.id,
      title: quizData.title,
      passingScore: quizData.passingScore,
      questions: quizData.questions.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        position: q.position,
        options: q.options.map((o) => ({ id: o.id, optionText: o.optionText })),
      })),
    };
  }

  if (userId) {
    const best = getBestAttempt(database, userId, quizRecord.id);
    if (best) bestAttempt = { score: best.score, passed: best.passed };
  }

  return { quiz, bestAttempt };
}

/** Scores a parsed quiz submission. Throws a 404 for a quiz outside this lesson. */
export function submitQuiz(
  database: Db,
  submission: { userId: number; lessonId: number } & QuizSubmission
) {
  const { userId, lessonId, quizId, selectedAnswers } = submission;
  // Scope the quiz to this lesson so a quiz elsewhere can't be reached by
  // posting its id to this route.
  const quiz = database
    .select()
    .from(quizzes)
    .where(eq(quizzes.id, quizId))
    .get();
  if (!quiz || quiz.lessonId !== lessonId) {
    throw data("Quiz not found", { status: 404 });
  }

  const result = computeResult(database, {
    userId,
    quizId,
    selectedAnswers,
  });
  if (!result) {
    throw data("Failed to score quiz", { status: 500 });
  }
  return result;
}
