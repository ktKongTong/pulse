import { describe, expect, it } from "vitest";

import {
  buildDefaultMediaLyricsQuery,
  serializeMediaLyricsQuery,
  parseLrc,
  resolveActiveLyricIndex,
  resolveMediaProgressSnapshot,
  resolveLyricCue,
} from "../src/media";

describe("media helpers", () => {
  it("resolves media progress seconds, percent, and labels together", () => {
    expect(resolveMediaProgressSnapshot({
      title: "Song",
      progressSeconds: 30,
      durationSeconds: 120,
      playbackState: "playing",
      updatedAt: "2026-04-25T00:00:00.000Z",
    }, Date.parse("2026-04-25T00:00:30.000Z"))).toEqual({
      progressSeconds: 60,
      progressPercent: 50,
      progressLabel: "1:00",
      durationSeconds: 120,
      durationLabel: "2:00",
    });
  });

  it("builds optional default lyrics queries from normalized media fields", () => {
    const query = buildDefaultMediaLyricsQuery({
      title: "  Song Title  ",
      album: " Album ",
      artist: " Artist ",
    });

    expect(query?.toString()).toBe("title=Song+Title&album=Album&artist=Artist");
    expect(buildDefaultMediaLyricsQuery({ title: " " })?.toString()).toBeUndefined();
  });

  it("serializes caller-owned lyrics queries without enforcing a schema", () => {
    expect(serializeMediaLyricsQuery("?q=artist%3Atitle")).toBe("q=artist%3Atitle");
    expect(serializeMediaLyricsQuery({ q: " artist:title ", provider: "netease" })).toBe(
      "q=artist%3Atitle&provider=netease",
    );
    expect(serializeMediaLyricsQuery({ title: " ", empty: null })).toBeNull();
  });

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
