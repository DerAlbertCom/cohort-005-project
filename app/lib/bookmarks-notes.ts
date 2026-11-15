import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

export const noteBodySchema = z
  .string()
  .trim()
  .max(MAX_NOTE_LENGTH, `Note must be ${MAX_NOTE_LENGTH} characters or fewer.`);
