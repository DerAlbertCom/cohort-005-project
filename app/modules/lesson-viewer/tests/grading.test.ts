import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  addLesson,
  addModule,
  addTrueFalseQuiz,
  quizForm,
  setup,
} from "./fixtures";

let world: ReturnType<typeof setup>;
let lessonId: number;
let quiz: ReturnType<typeof addTrueFalseQuiz>;

beforeEach(() => {
  world = setup();
  const mod = addModule(world.db, world.base.course.id, 1);
  lessonId = addLesson(world.db, { moduleId: mod.id, position: 1 }).id;
  quiz = addTrueFalseQuiz(world.db, lessonId, 10);
});

function answerRight(count: number) {
  const fields: Record<string, number> = { quizId: quiz.id };
  quiz.questions.forEach((q, index) => {
    fields[`question-${q.id}`] = index < count ? q.right : q.wrong;
  });
  return world.viewer.submitQuiz(
    world.base.user.id,
    lessonId,
    quizForm(fields)
  );
}

describe("grading a quiz", () => {
  it.each([
    [10, "A", true],
    [9, "A", true],
    [8, "B", true],
    [7, "C", false],
    [6, "D", false],
    [5, "F", false],
  ])("%i of 10 right is a %s, passed %s", (right, grade, passed) => {
    const result = answerRight(right);
    expect(result.score).toBeCloseTo(right / 10);
    expect(result.grade).toBe(grade);
    expect(result.passed).toBe(passed);
  });

  it("records the attempt and every answer given", () => {
    const result = world.viewer.submitQuiz(
      world.base.user.id,
      lessonId,
      quizForm({
        quizId: quiz.id,
        [`question-${quiz.questions[0].id}`]: quiz.questions[0].right,
        [`question-${quiz.questions[1].id}`]: quiz.questions[1].wrong,
      })
    );
    const attempt = world.db
      .select()
      .from(schema.quizAttempts)
      .where(eq(schema.quizAttempts.id, result.attemptId))
      .get();
    expect(attempt).toMatchObject({
      userId: world.base.user.id,
      quizId: quiz.id,
      score: 0.1,
      passed: false,
    });
    const answers = world.db
      .select()
      .from(schema.quizAnswers)
      .where(eq(schema.quizAnswers.attemptId, result.attemptId))
      .all();
    expect(answers.map((a) => [a.questionId, a.selectedOptionId])).toEqual([
      [quiz.questions[0].id, quiz.questions[0].right],
      [quiz.questions[1].id, quiz.questions[1].wrong],
    ]);
  });
});
