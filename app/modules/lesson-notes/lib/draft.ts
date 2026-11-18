export type NoteDraft = {
  length: number;
  maxLength: number;
  tooLong: boolean;
  empty: boolean;
  unchanged: boolean;
  canSave: boolean;
};

// The server trims a note before it checks the limit and stores it, so the
// draft is measured and compared trimmed too. Otherwise a note saved with a
// trailing newline reads "Unsaved changes" forever.
export function describeDraft(
  draft: string,
  savedBody: string | null,
  maxLength: number
): NoteDraft {
  const trimmed = draft.trim();
  const length = trimmed.length;
  const tooLong = length > maxLength;
  const empty = length === 0;
  const unchanged = trimmed === (savedBody ?? "");
  return {
    length,
    maxLength,
    tooLong,
    empty,
    unchanged,
    canSave: !tooLong && !empty && !unchanged,
  };
}
