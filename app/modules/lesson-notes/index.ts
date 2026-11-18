import { describeDraft, type NoteDraft } from "./lib/draft";

export type { NoteDraft };

/**
 * What the lesson note editor shows for the text a Student has typed:
 * the character count against the limit, and whether Save does anything.
 * Save is off for a blank note, an over-long note, and a note that matches
 * what is already saved.
 */
export function describeNoteDraft({
  draft,
  savedBody,
  maxLength,
}: {
  draft: string;
  savedBody: string | null;
  maxLength: number;
}): NoteDraft {
  return describeDraft(draft, savedBody, maxLength);
}
