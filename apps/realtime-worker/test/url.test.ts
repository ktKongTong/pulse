import { describe, expect, it } from "vitest";

import { canonicalizeUrl, pageRoomId } from "@/api/lib/url";

describe("canonicalizeUrl", () => {
  it("removes hash and tracking query params", () => {
    const result = canonicalizeUrl("https://example.com/article?id=1&utm_source=x#section");
    expect(result).toBe("https://example.com/article?id=1");
  });

  it("prefers explicit canonical url", () => {
    const result = canonicalizeUrl("https://example.com/article?id=1", "https://blog.example.com/post");
    expect(result).toBe("https://blog.example.com/post");
  });

  it("creates a page room id", () => {
    expect(pageRoomId("https://example.com/post")).toBe("page:https://example.com/post");
  });
});
