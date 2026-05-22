import type { z } from "zod";

export function parseJson(raw: string | ArrayBuffer) {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function parseFrame<T extends z.ZodType>(
  schema: T,
  raw: string | ArrayBuffer,
): z.infer<T> | null {
  const json = parseJson(raw);
  if (json === null) return null;
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : null;
}
