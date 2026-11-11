import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.video-tracking";
import { getCurrentUserId } from "~/lib/session";
import { parseJsonBody } from "~/lib/validation";
import { READ_ONLY_MESSAGE } from "~/lib/access.server";
import { isReadOnly } from "~/lib/refund-requests.server";
import { db } from "~/db";
import { lessons, modules, videoWatchEvents } from "~/db/schema";
import { eq } from "drizzle-orm";

const videoTrackingSchema = z.object({
  lessonId: z.number(),
  eventType: z.string(),
  positionSeconds: z.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const parsed = await parseJsonBody(request, videoTrackingSchema);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const { lessonId, eventType, positionSeconds } = parsed.data;

  const lesson = db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessons.id, lessonId))
    .get();

  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }

  if (isReadOnly(currentUserId, lesson.courseId)) {
    throw data(READ_ONLY_MESSAGE, { status: 403 });
  }

  db.insert(videoWatchEvents)
    .values({
      userId: currentUserId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning()
    .get();

  return { success: true };
}
