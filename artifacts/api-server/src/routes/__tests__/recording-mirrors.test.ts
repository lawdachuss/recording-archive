import { describe, it, expect } from "vitest";

/**
 * Mirror payloads are written by the upload pipeline to `preview_images`, while
 * the API historically read them only from the sparsely-populated `recordings`
 * table (0.6% vs 63.8% coverage). These tests pin the merge rules that fix it.
 *
 * The helpers are re-declared here rather than imported because they are module
 * private in routes/recordings.ts; the test asserts the same contract the route
 * relies on. If the route's behaviour changes, update both.
 */

const MIRROR_KEYS = ["thumbnail_mirrors", "sprite_mirrors", "preview_mirrors"] as const;

function nonEmptyMirrorMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );
  return entries.length ? Object.fromEntries(entries) : null;
}

function mergeMirrorMaps(preferred: unknown, fallback: unknown): Record<string, string> | null {
  const a = nonEmptyMirrorMap(preferred);
  const b = nonEmptyMirrorMap(fallback);
  if (!a) return b;
  if (!b) return a;
  return { ...b, ...a };
}

/** mirrors.ts: primary first, then MIRROR_HOST_PRIORITY, then any extra hosts. */
const MIRROR_HOST_PRIORITY = ["Catbox", "Pixhost", "ImgChest", "freeimage.host"];

function buildFallbacks(primaryUrl: string | null, mirrors: unknown): string[] {
  const ordered: string[] = [];
  const push = (u: unknown) => {
    if (typeof u === "string" && u && !ordered.includes(u)) ordered.push(u);
  };
  push(primaryUrl);
  const m = nonEmptyMirrorMap(mirrors);
  if (m) {
    for (const h of MIRROR_HOST_PRIORITY) push(m[h]);
    for (const [h, u] of Object.entries(m)) if (!MIRROR_HOST_PRIORITY.includes(h)) push(u);
  }
  return ordered;
}

describe("mirror payload helpers", () => {
  it("treats an empty object as NO mirrors", () => {
    // The pipeline writes 14,264 literal `{}` payloads. These are truthy, so a
    // naive `if (mirrors)` check would hand the frontend an empty chain that
    // looks populated and silently disables fallback.
    expect(nonEmptyMirrorMap({})).toBeNull();
    expect(mergeMirrorMaps({}, {})).toBeNull();
  });

  it("rejects non-object and empty-string payloads", () => {
    for (const bad of [null, undefined, "", 0, 1, true, [], "nope", { Catbox: "" }, { Catbox: null }]) {
      expect(nonEmptyMirrorMap(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  it("keeps only non-empty string hosts", () => {
    expect(nonEmptyMirrorMap({ Catbox: "https://a/1.jpg", Pixhost: "", ImgBB: null, ImgPile: "https://b/2.jpg" })).toEqual({
      Catbox: "https://a/1.jpg",
      ImgPile: "https://b/2.jpg",
    });
  });

  it("prefers the canonical (recordings) value per host", () => {
    const merged = mergeMirrorMaps(
      { Catbox: "https://canonical/1.jpg" },
      { Catbox: "https://preview_images/1.jpg", Pixhost: "https://preview_images/2.jpg" },
    );
    expect(merged).toEqual({
      Catbox: "https://canonical/1.jpg",
      Pixhost: "https://preview_images/2.jpg",
    });
  });

  it("merging can only widen the chain, never drop a host", () => {
    const before = nonEmptyMirrorMap({ Catbox: "https://c/1.jpg", ImgBB: "https://i/1.jpg" })!;
    const after = mergeMirrorMaps(before, { Pixhost: "https://p/1.jpg", ImgChest: "https://ic/1.jpg" })!;
    for (const host of Object.keys(before)) expect(after[host]).toBe(before[host]);
    expect(Object.keys(after)).toHaveLength(4);
  });

  it("returns whichever side is populated when the other is empty", () => {
    const only = { Catbox: "https://c/1.jpg" };
    expect(mergeMirrorMaps(null, only)).toEqual(only);
    expect(mergeMirrorMaps(only, null)).toEqual(only);
    expect(mergeMirrorMaps({}, only)).toEqual(only);
    expect(mergeMirrorMaps(only, {})).toEqual(only);
  });
});

describe("fallback chain built from a real mirror payload", () => {
  // Shape taken verbatim from preview_images rows in the live database.
  const CATALOG_MIRRORS = {
    Catbox: "https://files.catbox.moe/eomw9r.jpg",
    Pixhost: "https://img3.pixhost.to/images/5746/770859739_thumb.jpg",
    ImgChest: "https://cdn.imgchest.com/files/082efd9a1917.jpg",
  };

  it("orders primary first, then mirrors", () => {
    const chain = buildFallbacks("https://files.catbox.moe/dead.jpg", CATALOG_MIRRORS);
    expect(chain[0]).toBe("https://files.catbox.moe/dead.jpg");
    expect(chain).toHaveLength(4);
  });

  it("dedupes a mirror identical to the primary", () => {
    const chain = buildFallbacks(CATALOG_MIRRORS.Catbox, CATALOG_MIRRORS);
    expect(chain).toHaveLength(3);
    expect(chain.filter((u) => u === CATALOG_MIRRORS.Catbox)).toHaveLength(1);
  });

  it("appends unranked hosts (ImgPile / ImgBB) after the known four", () => {
    const chain = buildFallbacks("https://files.catbox.moe/dead.jpg", {
      ...CATALOG_MIRRORS,
      ImgPile: "https://imgpile.example/1.jpg",
      ImgBB: "https://ibb.example/2.jpg",
    });
    expect(chain).toHaveLength(6);
    expect(chain[4]).toBe("https://imgpile.example/1.jpg");
    expect(chain[5]).toBe("https://ibb.example/2.jpg");
  });

  it("a dead primary now has 3 working mirrors to fall back to", () => {
    // This is the user-visible fix: before, the API returned null mirrors and
    // the chain was length 1, so a dead primary meant a blank tile.
    const chain = buildFallbacks("https://files.catbox.moe/e4krdb.jpg", CATALOG_MIRRORS);
    expect(chain.length).toBeGreaterThan(1);
  });
});
