import { z } from "zod";

const optionIdSchema = z.coerce.number().int().positive();

export type QuizSubmission = {
  quizId: number;
  /** Question id to the option id the learner picked. */
  selectedAnswers: Record<number, number>;
};

/**
 * The quiz form: `quizId`, plus one `question-{id}` field per answered
 * question holding the chosen option id. Fields that are not answers, and
 * answers that are not ids, are dropped rather than failing the submission.
 */
export const quizSubmissionSchema = z
  .object({ quizId: z.coerce.number().int().positive() })
  .catchall(z.unknown())
  .transform(({ quizId, ...fields }): QuizSubmission => {
    const selectedAnswers: Record<number, number> = {};
    for (const [name, value] of Object.entries(fields)) {
      const questionId = /^question-(\d+)$/.exec(name)?.[1];
      const optionId = optionIdSchema.safeParse(value);
      if (questionId && optionId.success) {
        selectedAnswers[Number(questionId)] = optionId.data;
      }
    }
    return { quizId, selectedAnswers };
  });
