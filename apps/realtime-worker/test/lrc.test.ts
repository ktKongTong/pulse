import { describe, expect, it } from "vitest";

import {
  parseLrc,
  resolveActiveLyricIndex,
  resolveLyricCue,
} from "../app/components/features/status/media/lrc";

describe("lrc helpers", () => {
  it("parses standard lrc lines and ignores metadata", () => {
    const lines = parseLrc([
      "[ar:Artist]",
      "[ti:Song]",
      "[00:10.00]First line",
      "[00:20.50][00:30.00]Second line",
      "[00:40.00]   ",
    ].join("\n"));

    expect(lines).toEqual([
      { timeSeconds: 10, text: "First line" },
      { timeSeconds: 20.5, text: "Second line" },
      { timeSeconds: 30, text: "Second line" },
    ]);
  });

  it("locates the active line for the current playback progress", () => {
    const lines = parseLrc([
      "[00:05.00]Intro",
      "[00:10.00]Verse",
      "[00:15.00]Chorus",
    ].join("\n"));

    expect(resolveActiveLyricIndex(lines, 0)).toBe(-1);
    expect(resolveActiveLyricIndex(lines, 5)).toBe(0);
    expect(resolveActiveLyricIndex(lines, 12.4)).toBe(1);
    expect(resolveActiveLyricIndex(lines, 30)).toBe(2);
  });

  it("returns previous, current, and next lyric cues", () => {
    const lines = parseLrc([
      "[00:05.00]Intro",
      "[00:10.00]Verse",
      "[00:15.00]Chorus",
    ].join("\n"));

    expect(resolveLyricCue(lines, 1)).toEqual({
      previous: null,
      current: null,
      next: { timeSeconds: 5, text: "Intro" },
      state: "upcoming",
    });

    expect(resolveLyricCue(lines, 10)).toEqual({
      previous: { timeSeconds: 5, text: "Intro" },
      current: { timeSeconds: 10, text: "Verse" },
      next: { timeSeconds: 15, text: "Chorus" },
      state: "active",
    });
  });
});
