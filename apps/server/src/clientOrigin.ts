/**
 * Reduces a configured CLIENT_ORIGIN to the origin a browser actually sends.
 *
 * A browser's Origin header is only scheme, host and port, and CORS compares it exactly.
 * A value with a path or a trailing slash (for example the GitHub Pages project URL
 * "https://user.github.io/repo") matches no browser, so every HTTP API request from the web
 * app is blocked, while WebSocket traffic, which CORS does not cover, keeps working.
 *
 * Anything that is not an http(s) URL is returned unchanged, so this never widens what is
 * allowed: it only turns a URL into the single origin it belongs to.
 */
export function toOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {
    // Not a URL: leave it for CORS to compare as configured.
  }
  return value;
}
