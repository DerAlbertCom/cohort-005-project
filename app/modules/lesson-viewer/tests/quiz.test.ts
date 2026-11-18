import { describe, it, expect, beforeEach } from "vitest";
import {
  addLesson,
  addModule,
  addQuiz,
  addTrueFalseQuiz,
  pageRequest,
  quizForm,
  setup,
} from "./fixtures";

let world: ReturnType<typeof setup>;
let lessonId: number;
let otherLessonId: number;
let quiz: ReturnType<typeof addQuiz>;

beforeEach(() => {
  world = setup();
  const mod = addModule(world.db, world.base.course.id, 1);
  lessonId = addLesson(world.db, { moduleId: mod.id, position: 1 }).id;
  otherLessonId = addLesson(world.db, { moduleId: mod.id, position: 2 }).id;
  quiz = addQuiz(world.db, lessonId);
});

function submit(answers: Record<string, number>, onLesson = lessonId) {
  return world.viewer.submitQuiz(
    world.base.user.id,
    onLesson,
    quizForm({ quizId: quiz.id, ...answers })
  );
}

async function page() {
  const result = await world.viewer.lessonPage(
    pageRequest({
      courseId: world.base.course.id,
      instructorId: world.base.instructor.id,
      lessonId,
      currentUserId: world.base.user.id,
    })
  );
  if (result?.view !== "full") throw new Error("expected a full page");
  return result;
}

describe("the quiz on the lesson page", () => {
  it("scores a quiz with no questions as zero", () => {
    const empty = addTrueFalseQuiz(world.db, otherLessonId, 0);
    const result = world.viewer.submitQuiz(
      world.base.user.id,
      otherLessonId,
      quizForm({ quizId: empty.id })
    );
    expect(result).toMatchObject({
      score: 0,
      totalQuestions: 0,
      passed: false,
    });
  });

  it("lists questions by position without revealing the answers", async () => {
    const { quiz: shown } = await page();
    expect(shown?.questions.map((q) => q.questionText)).toEqual([
      "Question 1",
      "Question 2",
    ]);
    expect(shown?.questions[0].options).toEqual([
      { id: quiz.multipleChoice.wrong, optionText: "Wrong" },
      { id: quiz.multipleChoice.right, optionText: "Right" },
    ]);
  });

  it("shows the best attempt so far", async () => {
    submit({
      [`question-${quiz.multipleChoice.id}`]: quiz.multipleChoice.right,
    });
    submit({
      [`question-${quiz.multipleChoice.id}`]: quiz.multipleChoice.right,
      [`question-${quiz.trueFalse.id}`]: quiz.trueFalse.right,
    });
    submit({});
    expect((await page()).bestAttempt).toEqual({ score: 1, passed: true });
  });
});

describe("submitQuiz", () => {
  it("scores every question and grades the attempt", () => {
    const result = submit({
      [`question-${quiz.multipleChoice.id}`]: quiz.multipleChoice.right,
      [`question-${quiz.trueFalse.id}`]: quiz.trueFalse.right,
    });
    expect(result).toMatchObject({
      score: 1,
      passed: true,
      grade: "A",
      totalCorrect: 2,
      totalQuestions: 2,
    });
  });

  it("marks wrong and unanswered questions incorrect", () => {
    const result = submit({
      [`question-${quiz.trueFalse.id}`]: quiz.trueFalse.wrong,
    });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.grade).toBe("F");
    expect(result.questionResults).toEqual([
      {
        questionId: quiz.multipleChoice.id,
        correct: false,
        selectedOptionId: null,
        correctOptionId: null,
      },
      {
        questionId: quiz.trueFalse.id,
        correct: false,
        selectedOptionId: quiz.trueFalse.wrong,
        correctOptionId: quiz.trueFalse.right,
      },
    ]);
  });

  it("gives half marks an F that does not pass", () => {
    const result = submit({
      [`question-${quiz.multipleChoice.id}`]: quiz.multipleChoice.right,
      [`question-${quiz.trueFalse.id}`]: quiz.trueFalse.wrong,
    });
    expect(result).toMatchObject({ score: 0.5, passed: false, grade: "F" });
  });

  it("ignores form fields that are not answers", () => {
    const result = submit({
      intent: 1,
      "question-abc": quiz.trueFalse.right,
      [`question-${quiz.trueFalse.id}`]: quiz.trueFalse.right,
    });
    expect(result.totalCorrect).toBe(1);
  });

  it("refuses a quiz from another lesson with a 404", () => {
    expect(() => submit({}, otherLessonId)).toThrow(
      expect.objectContaining({
        data: "Quiz not found",
        init: expect.objectContaining({ status: 404 }),
      })
    );
  });

  it("refuses a malformed quiz id with a 400", () => {
    expect(() =>
      world.viewer.submitQuiz(
        world.base.user.id,
        lessonId,
        quizForm({ quizId: "abc" })
      )
    ).toThrow(
      expect.objectContaining({
        data: "Invalid quiz ID",
        init: expect.objectContaining({ status: 400 }),
      })
    );
  });
});
