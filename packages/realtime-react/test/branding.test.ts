import { describe, expect, it } from "vitest";

import { resolveDefaultAppBranding, resolveDefaultProviderBranding } from "../src/branding";

describe("resolveDefaultAppBranding", () => {
  it("returns packaged brand asset URLs from the SDK for real assets", () => {
    const url = resolveDefaultAppBranding("com.apple.Music", "Music").assetUrl;
    expect(url).toContain("/packages/realtime-react/assets/apple-music.svg");
  });

  it("returns null for apps without real packaged assets", () => {
    const url = resolveDefaultAppBranding("com.example.unknown", "Reader").assetUrl;
    expect(url).toBeNull();
  });
});

describe("resolveDefaultProviderBranding", () => {
  it("returns packaged provider asset URLs from the SDK", () => {
    const url = resolveDefaultProviderBranding("spotify")?.assetUrl ?? "";
    expect(url).toContain("/packages/realtime-react/assets/spotify.svg");
  });

  it("returns null for providers without real packaged assets", () => {
    const url = resolveDefaultProviderBranding("rss")?.assetUrl ?? "";
    expect(url).toBe("");
  });
});
