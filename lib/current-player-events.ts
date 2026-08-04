export const CURRENT_PLAYER_CHANGED_EVENT = "clouva:current-player-changed";

export function notifyCurrentPlayerChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CURRENT_PLAYER_CHANGED_EVENT));
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init: RequestInit) {
  if (init.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

export function isCurrentPlayerMutation(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = requestMethod(input, init);
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;

  try {
    const url = new URL(requestUrl(input), "https://clouva.local");
    return url.pathname === "/api/players/me";
  } catch {
    return false;
  }
}
