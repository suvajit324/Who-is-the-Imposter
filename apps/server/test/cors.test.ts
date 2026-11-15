import { afterEach, describe, expect, it, vi } from "vitest";
import { toOrigin } from "../src/clientOrigin.js";
import { api, closeAll, startTestServer } from "./helpers/harness.js";

// Real scrypt hashing runs in the sign-in test.
vi.setConfig({ testTimeout: 30_000 });

afterEach(closeAll);

/** What a browser on the GitHub Pages site sends as its Origin header. */
const PAGES_ORIGIN = "https://suvajit324.github.io";
/** The address of the site itself: easy to paste into CLIENT_ORIGIN by mistake. */
const PAGES_SITE_URL = "https://suvajit324.github.io/Who-is-the-Imposter";

describe("toOrigin", () => {
  it.each([
    [PAGES_ORIGIN, PAGES_ORIGIN],
    [`${PAGES_ORIGIN}/`, PAGES_ORIGIN],
    [PAGES_SITE_URL, PAGES_ORIGIN],
    [`${PAGES_SITE_URL}/`, PAGES_ORIGIN],
    ["http://localhost:5173", "http://localhost:5173"],
    ["https://example.com:443/app", "https://example.com"]
  ])("reduces %s to %s", (configured, expected) => {
    expect(toOrigin(configured)).toBe(expected);
  });

  it("leaves values that are not http(s) URLs unchanged", () => {
    expect(toOrigin("*")).toBe("*");
    expect(toOrigin("not a url")).toBe("not a url");
    expect(toOrigin("file:///tmp/index.html")).toBe("file:///tmp/index.html");
  });
});

describe("CORS for the web app's HTTP requests", () => {
  it("allows the Pages origin when CLIENT_ORIGIN is the site URL with a path", async () => {
    // Production failure: CORS answered with the configured site URL, which never equals a
    // browser's Origin, so the browser blocked /health and sign-in while the socket stayed up.
    const server = await startTestServer({ clientOrigin: PAGES_SITE_URL });
    const health = await fetch(`${server.url}/health`, { headers: { Origin: PAGES_ORIGIN } });
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("answers the sign-in preflight with the method and headers the web app sends, without credentials", async () => {
    const server = await startTestServer({ clientOrigin: `${PAGES_SITE_URL}/` });
    const preflight = await fetch(`${server.url}/api/auth/login`, {
      method: "OPTIONS",
      headers: {
        Origin: PAGES_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,authorization"
      }
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("content-type");
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
    // Sessions are bearer tokens, never cookies: credentialed requests stay disallowed.
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("lets the Pages origin register and sign in", async () => {
    const server = await startTestServer({ clientOrigin: PAGES_SITE_URL });
    const headers = { Origin: PAGES_ORIGIN };
    const body = { username: "Pages_user", password: "correct horse 42" };
    const registered = await api(server.url, "/api/auth/register", { body: { ...body, avatar: "rocket" }, headers });
    expect(registered.status, registered.text).toBe(201);
    const response = await fetch(`${server.url}/api/auth/login`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("uses the same origin for Socket.IO's HTTP transport", async () => {
    const server = await startTestServer({ clientOrigin: PAGES_SITE_URL });
    const handshake = await fetch(`${server.url}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: PAGES_ORIGIN } });
    expect(handshake.status).toBe(200);
    expect(handshake.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });

  it("names only the configured origin, whoever asks", async () => {
    const server = await startTestServer({ clientOrigin: PAGES_SITE_URL });
    const response = await fetch(`${server.url}/health`, { headers: { Origin: "https://attacker.example" } });
    expect(response.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
  });
});
