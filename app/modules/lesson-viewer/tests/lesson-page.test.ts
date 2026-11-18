import { describe, it, expect, beforeEach } from "vitest";
import { addLesson, addModule, pageRequest, setup } from "./fixtures";

let world: ReturnType<typeof setup>;
let lessons: ReturnType<typeof addLesson>[];

beforeEach(() => {
  world = setup();
  const { db, base } = world;
  // Module 2 is inserted first so position, not id, decides the order.
  const second = addModule(db, base.course.id, 2);
  const first = addModule(db, base.course.id, 1);
  lessons = [
    addLesson(db, { moduleId: first.id, position: 2 }),
    addLesson(db, { moduleId: first.id, position: 1, content: "# Hello" }),
    addLesson(db, { moduleId: second.id, position: 1 }),
  ];
});

function request(lessonId: number) {
  return pageRequest({
    courseId: world.base.course.id,
    instructorId: world.base.instructor.id,
    lessonId,
  });
}

describe("lessonPage", () => {
  it("is null for a lesson that does not exist", async () => {
    expect(await world.viewer.lessonPage(request(9999))).toBeNull();
  });

  it("is null for a course that does not exist", async () => {
    const page = await world.viewer.lessonPage({
      ...request(lessons[0].id),
      courseId: 9999,
    });
    expect(page).toBeNull();
  });

  it("orders the curriculum by module and lesson position", async () => {
    const page = await world.viewer.lessonPage(request(lessons[0].id));
    expect(page?.curriculum.map((m) => m.title)).toEqual([
      "Module 1",
      "Module 2",
    ]);
    expect(page?.curriculum[0].lessons.map((l) => l.id)).toEqual([
      lessons[1].id,
      lessons[0].id,
    ]);
  });

  it("links the previous and next lesson across modules", async () => {
    const page = await world.viewer.lessonPage(request(lessons[0].id));
    expect(page?.view).toBe("full");
    if (page?.view !== "full") return;
    expect(page.prevLesson?.id).toBe(lessons[1].id);
    expect(page.nextLesson).toMatchObject({
      id: lessons[2].id,
      moduleTitle: "Module 2",
    });
  });

  it("has no previous lesson at the start and no next at the end", async () => {
    const start = await world.viewer.lessonPage(request(lessons[1].id));
    const end = await world.viewer.lessonPage(request(lessons[2].id));
    expect(start?.view === "full" && start.prevLesson).toBeNull();
    expect(end?.view === "full" && end.nextLesson).toBeNull();
  });

  it("renders the lesson content and names the instructor", async () => {
    const page = await world.viewer.lessonPage(request(lessons[1].id));
    if (page?.view !== "full") throw new Error("expected a full page");
    expect(page.contentHtml).toContain("<h1");
    expect(page.contentHtml).toContain("Hello");
    expect(page.instructorName).toBe("Test Instructor");
    expect(page.module.title).toBe("Module 1");
  });

  it("has no content HTML for a lesson without content", async () => {
    const page = await world.viewer.lessonPage(request(lessons[0].id));
    if (page?.view !== "full") throw new Error("expected a full page");
    expect(page.contentHtml).toBeNull();
    expect(page.quiz).toBeNull();
    expect(page.bestAttempt).toBeNull();
  });

  it("shows only the outline and the reason to someone who cannot view", async () => {
    const page = await world.viewer.lessonPage({
      ...request(lessons[1].id),
      view: { allowed: false, reason: { kind: "signed-out" } },
    });
    expect(page).toEqual({
      view: "locked",
      course: {
        id: world.base.course.id,
        title: "Test Course",
        slug: "test-course",
      },
      curriculum: expect.any(Array),
      module: { id: lessons[1].moduleId, title: "Module 1" },
      lesson: { id: lessons[1].id, title: lessons[1].title },
      enrolled: false,
      lockedReason: { kind: "signed-out" },
    });
  });

  it("passes moderation through to the page", async () => {
    const page = await world.viewer.lessonPage({
      ...request(lessons[0].id),
      canModerate: true,
    });
    expect(page?.view === "full" && page.canModerate).toBe(true);
  });
});
