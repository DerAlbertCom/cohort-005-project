import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { createComment, deleteComment } from "~/lib/comments.server";
import { fakeNotifications } from "~/lib/notifications.fake.server";
import { NOW, addLesson, addModule, pageRequest, setup } from "./fixtures";

let world: ReturnType<typeof setup>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  world = setup();
  const mod = addModule(world.db, world.base.course.id, 1);
  lessonId = addLesson(world.db, { moduleId: mod.id, position: 1 }).id;
  otherLessonId = addLesson(world.db, { moduleId: mod.id, position: 2 }).id;
});

async function post(
  authorId: number,
  body: string,
  parentId: number | null = null
) {
  const result = await createComment(
    world.db,
    authorId,
    lessonId,
    parentId,
    body,
    NOW,
    fakeNotifications()
  );
  if (!result.ok) throw new Error(result.error);
  return result.comment.id;
}

async function remove(commentId: number, userId: number) {
  await deleteComment(
    world.db,
    commentId,
    userId,
    false,
    NOW,
    fakeNotifications()
  );
}

async function thread() {
  const page = await world.viewer.lessonPage(
    pageRequest({
      courseId: world.base.course.id,
      instructorId: world.base.instructor.id,
      lessonId,
    })
  );
  if (page?.view !== "full") throw new Error("expected a full page");
  return page.comments;
}

describe("the Discussion on the lesson page", () => {
  it("nests replies under their question and renders bodies to HTML", async () => {
    const question = await post(world.base.user.id, "Why **this**?");
    await post(world.base.instructor.id, "Because.", question);

    const shownThread = await thread();
    expect(shownThread).toHaveLength(1);
    const [shown] = shownThread;
    expect(shown.bodyHtml).toContain("<strong>this</strong>");
    expect(shown.author).toMatchObject({
      name: "Test User",
      isInstructor: false,
      isPlatformAdmin: false,
    });
    expect(shown.replies).toHaveLength(1);
    expect(shown.replies[0].author.isInstructor).toBe(true);
  });

  it("flags a platform admin's comment", async () => {
    const admin = world.db
      .insert(schema.users)
      .values({
        name: "Ada Admin",
        email: "ada@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();
    await post(admin.id, "Admin here");
    const [shown] = await thread();
    expect(shown.author).toMatchObject({
      name: "Ada Admin",
      isPlatformAdmin: true,
      isInstructor: false,
    });
  });

  it("escapes raw HTML in a comment", async () => {
    await post(world.base.user.id, "<script>alert(1)</script> hi");
    const [shown] = await thread();
    expect(shown.bodyHtml).not.toContain("<script>");
  });

  it("hides a deleted question that has no replies", async () => {
    const question = await post(world.base.user.id, "Never mind");
    await remove(question, world.base.user.id);
    expect(await thread()).toEqual([]);
  });

  it("keeps a deleted question with replies, without its body", async () => {
    const question = await post(world.base.user.id, "Secret question");
    await post(world.base.instructor.id, "An answer", question);
    await remove(question, world.base.user.id);

    const [shown] = await thread();
    expect(shown.deleted).toBe(true);
    expect(shown.body).toBe("");
    expect(shown.bodyHtml).toBe("");
    expect(shown.replies).toHaveLength(1);
  });

  it("drops a deleted reply", async () => {
    const question = await post(world.base.user.id, "A question");
    const reply = await post(world.base.user.id, "Oops", question);
    await remove(reply, world.base.user.id);
    const [shown] = await thread();
    expect(shown.replies).toEqual([]);
  });
});

describe("isCommentInLesson", () => {
  it("is true only for a comment on this lesson", async () => {
    const id = await post(world.base.user.id, "Hello");
    expect(world.viewer.isCommentInLesson(id, lessonId)).toBe(true);
    expect(world.viewer.isCommentInLesson(id, otherLessonId)).toBe(false);
    expect(world.viewer.isCommentInLesson(9999, lessonId)).toBe(false);
  });
});
