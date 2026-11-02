import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const workerSource = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
const API_TTL_MS = 5 * 60_000;

function bootWorker(fetchImpl: typeof fetch, now = Date.now(), existingCacheNames: string[] = []) {
  const listeners = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (request: Request) => entries.get(request.url)?.clone()),
    put: vi.fn(async (request: Request, response: Response) => {
      entries.set(request.url, response.clone());
    }),
    delete: vi.fn(async (request: Request) => entries.delete(request.url)),
    keys: vi.fn(async () => []),
  };
  const deletedCacheNames: string[] = [];
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => existingCacheNames),
    delete: vi.fn(async (name: string) => {
      deletedCacheNames.push(name);
      return true;
    }),
  };
  const self = {
    addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
    location: { origin: "https://vault.test" },
  };
  class TestDate extends Date {
    static now() {
      return now;
    }
  }

  runInNewContext(workerSource, {
    self,
    caches,
    fetch: fetchImpl,
    URL,
    Request,
    Response,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    Date: TestDate,
    console,
  });

  return { fetchHandler: listeners.get("fetch")!, listeners, caches, cache, entries, deletedCacheNames };
}

function dispatchFetch(fetchHandler: (event: any) => void, request: Request) {
  let responsePromise: Promise<Response> | undefined;
  fetchHandler({
    request,
    respondWith: (response: Promise<Response>) => {
      responsePromise = response;
    },
  });
  return responsePromise;
}

describe("service-worker API cache privacy and freshness", () => {
  it("bypasses the shared cache for bearer-authenticated JSON requests", () => {
    const fetchImpl = vi.fn(async () => new Response("private"));
    const { fetchHandler, caches } = bootWorker(fetchImpl);
    const request = new Request("https://vault.test/api/recordings/recommendations", {
      headers: { accept: "application/json", authorization: "Bearer test-session-token" },
    });

    expect(dispatchFetch(fetchHandler, request)).toBeUndefined();
    expect(caches.open).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bypasses user and admin API paths even without an Authorization header", () => {
    const fetchImpl = vi.fn(async () => new Response("private"));
    const { fetchHandler, caches } = bootWorker(fetchImpl);

    for (const path of ["/api/user/collections", "/api/admin/settings"]) {
      const request = new Request(`https://vault.test${path}`, {
        headers: { accept: "application/json" },
      });
      expect(dispatchFetch(fetchHandler, request)).toBeUndefined();
    }

    expect(caches.open).not.toHaveBeenCalled();
  });

  it("keeps public JSON GET requests eligible for network-first caching", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("public", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const { fetchHandler, cache } = bootWorker(fetchImpl);
    const request = new Request("https://vault.test/api/recordings", {
      headers: { accept: "application/json" },
    });

    const responsePromise = dispatchFetch(fetchHandler, request);
    expect(responsePromise).toBeDefined();
    const response = await responsePromise!;
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("does not cache responses marked private or no-store", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("private", {
        status: 200,
        headers: { "cache-control": "private, no-store" },
      }),
    );
    const { fetchHandler, cache } = bootWorker(fetchImpl);
    const request = new Request("https://vault.test/api/recordings", {
      headers: { accept: "application/json" },
    });

    const responsePromise = dispatchFetch(fetchHandler, request);
    await responsePromise!;
    await Promise.resolve();

    expect(cache.put).not.toHaveBeenCalled();
  });

  it("purges an old public snapshot when the server later marks the response private", async () => {
    const now = Date.now();
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("public", { headers: { "cache-control": "public" } });
      }
      if (call === 2) {
        return new Response("private", { headers: { "cache-control": "private, no-store" } });
      }
      throw new TypeError("offline");
    });
    const { fetchHandler, cache, entries } = bootWorker(fetchImpl, now);
    const request = new Request("https://vault.test/api/recordings", {
      headers: { accept: "application/json" },
    });

    await dispatchFetch(fetchHandler, request)!;
    await Promise.resolve();
    expect(entries.has(request.url)).toBe(true);

    const privateResponse = await dispatchFetch(fetchHandler, request)!;
    expect(await privateResponse.text()).toBe("private");
    expect(cache.delete).toHaveBeenCalledWith(request);
    expect(entries.has(request.url)).toBe(false);

    const offlineResponse = await dispatchFetch(fetchHandler, request)!;
    expect(offlineResponse.status).toBe(503);
  });

  it("does not cache responses that require revalidation", async () => {
    for (const cacheControl of ["no-cache", "must-revalidate", "public, max-age=0"]) {
      const fetchImpl = vi.fn(async () =>
        new Response("must-revalidate", { headers: { "cache-control": cacheControl } }),
      );
      const { fetchHandler, cache } = bootWorker(fetchImpl);
      const request = new Request("https://vault.test/api/recordings", {
        headers: { accept: "application/json" },
      });
      await dispatchFetch(fetchHandler, request)!;
      await Promise.resolve();
      expect(cache.put).not.toHaveBeenCalled();
    }
  });

  it("serves a fresh cached public response while offline", async () => {
    const now = Date.now();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const { fetchHandler, entries } = bootWorker(fetchImpl, now);
    const request = new Request("https://vault.test/api/recordings", {
      headers: { accept: "application/json" },
    });
    entries.set(
      request.url,
      new Response("fresh", { headers: { "sw-cached-at": String(now - 1_000) } }),
    );

    const responsePromise = dispatchFetch(fetchHandler, request);
    const response = await responsePromise!;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("fresh");
  });

  it("purges old API cache generations on activation but keeps the current caches", async () => {
    const fetchImpl = vi.fn(async () => new Response("unused"));
    const { listeners, deletedCacheNames } = bootWorker(fetchImpl, Date.now(), [
      "vault-api-v1",
      "vault-api-v2",
      "vault-images-v6",
      "vault-images-v7",
    ]);
    let activationPromise: Promise<void> | undefined;
    listeners.get("activate")!({
      waitUntil: (promise: Promise<void>) => {
        activationPromise = promise;
      },
    });
    await activationPromise!;

    expect(deletedCacheNames).toContain("vault-api-v1");
    expect(deletedCacheNames).toContain("vault-images-v6");
    expect(deletedCacheNames).not.toContain("vault-api-v2");
    expect(deletedCacheNames).not.toContain("vault-images-v7");
  });

  it("rejects and deletes stale cached responses older than five minutes", async () => {
    const now = Date.now();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const { fetchHandler, cache, entries } = bootWorker(fetchImpl, now);
    const request = new Request("https://vault.test/api/recordings", {
      headers: { accept: "application/json" },
    });
    entries.set(
      request.url,
      new Response("stale", { headers: { "sw-cached-at": String(now - API_TTL_MS - 1) } }),
    );

    const responsePromise = dispatchFetch(fetchHandler, request);
    const response = await responsePromise!;

    expect(response.status).toBe(503);
    expect(cache.delete).toHaveBeenCalledTimes(1);
    expect(entries.has(request.url)).toBe(false);
  });
});
