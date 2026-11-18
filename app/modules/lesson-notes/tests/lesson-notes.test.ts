import { describe, it, expect } from "vitest";
import { describeNoteDraft } from "../index";

const maxLength = 10;

describe("describeNoteDraft", () => {
  it("lets a new note with text be saved", () => {
    expect(
      describeNoteDraft({ draft: "hello", savedBody: null, maxLength })
    ).toEqual({
      length: 5,
      maxLength,
      tooLong: false,
      empty: false,
      unchanged: false,
      canSave: true,
    });
  });

  it("does not save a blank note", () => {
    const draft = describeNoteDraft({
      draft: "   ",
      savedBody: null,
      maxLength,
    });
    expect(draft.empty).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("treats an empty draft with no saved note as unchanged", () => {
    const draft = describeNoteDraft({ draft: "", savedBody: null, maxLength });
    expect(draft.unchanged).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("does not save a note that matches the saved one", () => {
    const draft = describeNoteDraft({
      draft: "same",
      savedBody: "same",
      maxLength,
    });
    expect(draft.unchanged).toBe(true);
    expect(draft.canSave).toBe(false);
  });

  it("saves an edit to an existing note", () => {
    const draft = describeNoteDraft({
      draft: "same!",
      savedBody: "same",
      maxLength,
    });
    expect(draft.unchanged).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("allows a note exactly at the limit", () => {
    const draft = describeNoteDraft({
      draft: "a".repeat(maxLength),
      savedBody: null,
      maxLength,
    });
    expect(draft.tooLong).toBe(false);
    expect(draft.canSave).toBe(true);
  });

  it("refuses a note one character over the limit", () => {
    const draft = describeNoteDraft({
      draft: "a".repeat(maxLength + 1),
      savedBody: null,
      maxLength,
    });
    expect(draft.length).toBe(maxLength + 1);
    expect(draft.tooLong).toBe(true);
    expect(draft.canSave).toBe(false);
  });
});
