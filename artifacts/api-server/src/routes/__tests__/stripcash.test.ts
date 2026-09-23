import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { buildSmartlink, verifySmartlink } from "../stripcash.js";

const KEY = "8257f0b4872a4f254ffe30b2af9f389dbfacc889";

describe("buildSmartlink", () => {
  const OLD_KEY = process.env.STRIPCASH_API_KEY;
  const OLD_LINK = process.env.STRIPCASH_SMARTLINK;

  beforeEach(() => {
    delete process.env.STRIPCASH_API_KEY;
    delete process.env.STRIPCASH_SMARTLINK;
  });
  afterEach(() => {
    if (OLD_KEY === undefined) delete process.env.STRIPCASH_API_KEY;
    else process.env.STRIPCASH_API_KEY = OLD_KEY;
    if (OLD_LINK === undefined) delete process.env.STRIPCASH_SMARTLINK;
    else process.env.STRIPCASH_SMARTLINK = OLD_LINK;
  });

  it("returns null when nothing is configured", () => {
    expect(buildSmartlink()).toBeNull();
  });

  it("rejects malformed keys", () => {
    process.env.STRIPCASH_API_KEY = "not-a-key";
    expect(buildSmartlink()).toBeNull();
    process.env.STRIPCASH_API_KEY = "8257f0b4872a4f254ffe30b2af9f389d"; // 32-hex — too short
    expect(buildSmartlink()).toBeNull();
    process.env.STRIPCASH_API_KEY = "8257f0b4872a4f254ffe30b2af9f389dbfacc88zz"; // not hex
    expect(buildSmartlink()).toBeNull();
  });

  it("derives the tracked smartlink from a 40-hex key (trimmed)", () => {
    process.env.STRIPCASH_API_KEY = ` ${KEY} `;
    expect(buildSmartlink()).toBe(`https://go.stripchat.com/?userId=${KEY}&p1=vault`);
  });

  it("prefers a valid STRIPCASH_SMARTLINK override", () => {
    process.env.STRIPCASH_API_KEY = KEY;
    process.env.STRIPCASH_SMARTLINK = "https://go.stripchat.com/easylink/abc?p1=vault";
    expect(buildSmartlink()).toBe("https://go.stripchat.com/easylink/abc?p1=vault");
  });

  it("treats an invalid override as unconfigured", () => {
    process.env.STRIPCASH_API_KEY = KEY;
    process.env.STRIPCASH_SMARTLINK = "not a url";
    expect(buildSmartlink()).toBeNull();
  });
});

describe("verifySmartlink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, location: string | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "location" ? location : null,
        },
      })),
    );
  }

  it("accepts a redirect with a Location target", async () => {
    stubFetch(302, "https://superchatlive.com/?affiliateId=x");
    await expect(verifySmartlink("https://a.example/link-a")).resolves.toBe(true);
  });

  it("rejects a direct 200 (link no longer redirects)", async () => {
    stubFetch(200, null);
    await expect(verifySmartlink("https://a.example/link-b")).resolves.toBe(false);
  });

  it("rejects a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    await expect(verifySmartlink("https://a.example/link-c")).resolves.toBe(false);
  });

  it("caches the result per link for 10 minutes", async () => {
    stubFetch(302, "https://target.example/");
    await verifySmartlink("https://a.example/link-d"); // miss
    await verifySmartlink("https://a.example/link-d", Date.now() + 60_000); // hit
    await verifySmartlink("https://a.example/link-d", Date.now() + 9 * 60_000); // hit
    expect(fetch).toHaveBeenCalledTimes(1);
    await verifySmartlink("https://a.example/link-d", Date.now() + 11 * 60_000); // expired
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
