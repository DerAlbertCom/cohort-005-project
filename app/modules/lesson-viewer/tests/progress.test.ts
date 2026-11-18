import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "~/db/schema";
import { markdown } from "~/lib/text";
import { getNote, saveNote } from "~/lib/notes.server";
import { toggleBookmark } from "~/lib/bookmarks.server";
import {
  NOW,
  addLesson,
  addModule,
  addWatchEvent,
  pageRequest,
  setup,
} from "./fixtures";

let world: ReturnType<typeof setup>;
let video: ReturnType<typeof addLesson>;
let other: ReturnType<typeof addLesson>;

beforeEach(() => {
  world = setup();
  const mod = addModule(world.db, world.base.course.id, 1);
  video = addLesson(world.db, {
    moduleId: mod.id,
    position: 1,
    videoUrl: "https://youtu.be/x",
    durationMinutes: 10,
  });
  other = addLesson(world.db, { moduleId: mod.id, position: 2 });
});

function visit(lessonId: number, canTake = true) {
  return world.viewer.lessonPage(
    pageRequest({
      courseId: world.base.course.id,
      instructorId: world.base.instructor.id,
      lessonId,
      currentUserId: world.base.user.id,
      enrolled: true,
      canTake,
    })
  );
}

async function fullVisit(lessonId: number, canTake = true) {
  const page = await visit(lessonId, canTake);
  if (page?.view !== "full") throw new Error("expected a full page");
  return page;
}

describe("visiting a lesson", () => {
  it("marks the lesson in progress for someone who can take it", async () => {
    const page = await fullVisit(other.id);
    expect(page.lessonStatus).toBe("in_progress");
    expect(page.lessonProgressMap).toEqual({ [other.id]: "in_progress" });
  });

  it("records nothing for someone who cannot take the course", async () => {
    await fullVisit(other.id, false);
    const page = await fullVisit(video.id, false);
    expect(page.lessonStatus).toBeNull();
    expect(page.lessonProgressMap).toEqual({});
    expect(page.watchProgress).toBe(0);
  });

  it("records nothing for someone signed out", async () => {
    const page = await world.viewer.lessonPage(
      pageRequest({
        courseId: world.base.course.id,
        instructorId: world.base.instructor.id,
        lessonId: other.id,
        canTake: true,
      })
    );
    if (page?.view !== "full") throw new Error("expected a full page");
    expect(page.lessonStatus).toBeNull();
    expect(page.bookmarked).toBe(false);
    expect(page.note).toBeNull();
  });

  it("keeps a completed lesson completed when it is visited again", async () => {
    world.viewer.markComplete(world.base.user.id, other.id, NOW);
    const page = await fullVisit(other.id);
    expect(page.lessonStatus).toBe("completed");
  });

  it("moves a lesson back from not started to in progress", async () => {
    await fullVisit(other.id);
    await fullVisit(video.id);
    const page = await fullVisit(other.id);
    expect(page.lessonProgressMap).toEqual({
      [other.id]: "in_progress",
      [video.id]: "in_progress",
    });
  });

  it("resumes the video at the latest position and reports the furthest point", async () => {
    const userId = world.base.user.id;
    addWatchEvent(world.db, {
      userId,
      lessonId: video.id,
      positionSeconds: 300,
      createdAt: "2026-10-06T10:00:00.000Z",
    });
    addWatchEvent(world.db, {
      userId,
      lessonId: video.id,
      positionSeconds: 120,
      createdAt: "2026-10-06T11:00:00.000Z",
    });
    const page = await fullVisit(video.id);
    expect(page.lastWatchPosition).toBe(120);
    expect(page.watchProgress).toBe(50);
  });

  it("caps watch progress at 100", async () => {
    addWatchEvent(world.db, {
      userId: world.base.user.id,
      lessonId: video.id,
      positionSeconds: 900,
      createdAt: NOW.toISOString(),
    });
    const page = await fullVisit(video.id);
    expect(page.watchProgress).toBe(100);
  });

  it("shows the person's own Bookmark and Note", async () => {
    toggleBookmark(world.db, world.base.user.id, other.id, NOW);
    saveNote(world.db, world.base.user.id, other.id, "Remember this", NOW);
    const page = await fullVisit(other.id);
    expect(page.bookmarked).toBe(true);
    expect(page.note).toEqual({
      body: "Remember this",
      updatedAt: getNote(world.db, world.base.user.id, other.id)?.updatedAt,
    });
  });
});

describe("progress and video edge cases", () => {
  it("leaves out progress and lessons from another course", async () => {
    const elsewhere = world.db
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "Other course",
        salesCopy: markdown("Other"),
        status: schema.CourseStatus.Published,
        instructorId: world.base.instructor.id,
        categoryId: world.base.category.id,
      })
      .returning()
      .get();
    const otherModule = addModule(world.db, elsewhere.id, 1);
    const foreign = addLesson(world.db, {
      moduleId: otherModule.id,
      position: 1,
    });
    world.viewer.markComplete(world.base.user.id, foreign.id, NOW);

    const page = await fullVisit(other.id);
    expect(page.lessonProgressMap).toEqual({ [other.id]: "in_progress" });
    expect(page.curriculum.flatMap((m) => m.lessons.map((l) => l.id))).toEqual([
      video.id,
      other.id,
    ]);
  });

  it("ignores watch events on a lesson without a video", async () => {
    addWatchEvent(world.db, {
      userId: world.base.user.id,
      lessonId: other.id,
      positionSeconds: 30,
      createdAt: NOW.toISOString(),
    });
    const page = await fullVisit(other.id);
    expect(page.lastWatchPosition).toBe(0);
    expect(page.watchProgress).toBe(0);
  });

  it("resumes but reports no progress for a video with no duration", async () => {
    const mod = addModule(world.db, world.base.course.id, 2);
    const untimed = addLesson(world.db, {
      moduleId: mod.id,
      position: 1,
      videoUrl: "https://youtu.be/y",
    });
    addWatchEvent(world.db, {
      userId: world.base.user.id,
      lessonId: untimed.id,
      positionSeconds: 30,
      createdAt: NOW.toISOString(),
    });
    const page = await fullVisit(untimed.id);
    expect(page.lastWatchPosition).toBe(30);
    expect(page.watchProgress).toBe(0);
  });

  it("reports no progress before the video is played", async () => {
    const page = await fullVisit(video.id);
    expect(page.lastWatchPosition).toBe(0);
    expect(page.watchProgress).toBe(0);
  });
});

describe("markComplete", () => {
  it("completes a lesson that was never visited", async () => {
    world.viewer.markComplete(world.base.user.id, video.id, NOW);
    const page = await fullVisit(other.id);
    expect(page.lessonProgressMap[video.id]).toBe("completed");
  });

  it("completes a lesson that was in progress", async () => {
    await fullVisit(video.id);
    world.viewer.markComplete(world.base.user.id, video.id, NOW);
    const page = await fullVisit(video.id);
    expect(page.lessonStatus).toBe("completed");
  });
});
