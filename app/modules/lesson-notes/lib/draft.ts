export type NoteDraft = {
  length: number;
  maxLength: number;
  tooLong: boolean;
  empty: boolean;
  unchanged: boolean;
  canSave: boolean;
};

export function describeDraft(
  draft: string,
  savedBody: string | null,
  maxLength: number
): NoteDraft {
  const length = draft.length;
  const tooLong = length > maxLength;
  const empty = draft.trim().length === 0;
  const unchanged = draft === (savedBody ?? "");
  return {
    length,
    maxLength,
    tooLong,
    empty,
    unchanged,
    canSave: !tooLong && !empty && !unchanged,
  };
}
