const SESSION_KEY = "vault-session-id";

export function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // crypto.randomUUID() may fail in older/insecure contexts, localStorage may be full/disabled
    return "session-" + Math.random().toString(36).slice(2, 10);
  }
}
