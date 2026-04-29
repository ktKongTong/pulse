import { describe, expect, it } from "vitest";

import { resolveAppIconAssetUrl } from "@/lib/app-icon";

describe("resolveAppIconAssetUrl", () => {
  it("reads macOS app mappings from app-icon.json", () => {
    expect(resolveAppIconAssetUrl("com.apple.Music")).toBe(
      "/brand-assets/apple-music.svg",
    );
    expect(resolveAppIconAssetUrl("com.openai.codex")).toBe(
      "/brand-assets/codex.svg",
    );
  });

  it("returns null when no mapping exists", () => {
    expect(resolveAppIconAssetUrl("com.example.unknown")).toBeNull();
  });
});
