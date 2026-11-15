import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountSchema,
  apiErrorSchema,
  authResponseSchema,
  leaderboardResponseSchema,
  profileResponseSchema,
  type AuthResponse
} from "@imposter/shared";
import { api, closeAll, startTestServer } from "./helpers/harness.js";

// Real scrypt hashing (tens of milliseconds per password) runs in these tests.
vi.setConfig({ testTimeout: 30_000 });

afterEach(closeAll);

const PASSWORD = "correct horse 42";

async function register(url: string, username: string, password = PASSWORD, avatar = "rocket") {
  const response = await api<AuthResponse>(url, "/api/auth/register", { body: { username, password, avatar } });
  expect(response.status, response.text).toBe(201);
  return response.body;
}

describe("registration", () => {
  it("creates an account and returns only the token, its expiry and the public account", async () => {
    const server = await startTestServer();
    const response = await api<AuthResponse>(server.url, "/api/auth/register", { body: { username: "Nova_7", password: PASSWORD, avatar: "ghost" } });
    expect(response.status).toBe(201);
    const body = authResponseSchema.parse(response.body);
    expect(body.account).toEqual({ username: "Nova_7", avatar: "ghost", joinedAt: expect.any(String) });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ttl = Date.parse(body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(11.9 * 3600_000);
    expect(ttl).toBeLessThanOrEqual(12 * 3600_000);

    const stored = (await server.store.findUserByUsernameKey("nova_7"))!;
    for (const secret of [stored.id, stored.passwordHash, PASSWORD, "usernameKey", "passwordHash"]) {
      expect(response.text.includes(secret), `response leaked ${secret}`).toBe(false);
    }
  });

  it("stores a salted scrypt hash, never the password, and only a hash of the session token", async () => {
    const server = await startTestServer();
    const first = await register(server.url, "Alpha");
    const second = await register(server.url, "Bravo");
    const alpha = (await server.store.findUserByUsernameKey("alpha"))!;
    const bravo = (await server.store.findUserByUsernameKey("bravo"))!;
    expect(alpha.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(alpha.passwordHash.includes(PASSWORD)).toBe(false);
    expect(alpha.passwordHash).not.toBe(bravo.passwordHash);

    expect(await server.store.findSession(first.token)).toBeNull();
    const tokenHash = createHash("sha256").update(first.token).digest("hex");
    expect((await server.store.findSession(tokenHash))?.userId).toBe(alpha.id);
    expect(second.token).not.toBe(first.token);
  });

  it("rejects taken usernames regardless of case", async () => {
    const server = await startTestServer();
    await register(server.url, "Echo");
    const again = await api(server.url, "/api/auth/register", { body: { username: "ECHO", password: PASSWORD, avatar: "cat" } });
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(again.body).error).toBe("That username is taken.");
  });

  it.each([
    [{ username: "ab", password: PASSWORD, avatar: "rocket" }, "Usernames need at least 3 characters."],
    [{ username: "has space", password: PASSWORD, avatar: "rocket" }, "Use only letters, numbers and underscores."],
    [{ username: "x".repeat(21), password: PASSWORD, avatar: "rocket" }, "Usernames can be at most 20 characters."],
    [{ username: "Valid_1", password: "short", avatar: "rocket" }, "Passwords need at least 8 characters."],
    [{ username: "Valid_1", password: "p".repeat(129), avatar: "rocket" }, "Passwords can be at most 128 characters."],
    [{ username: "Valid_1", password: PASSWORD, avatar: "dragon" }, null],
    [{ username: "Valid_1", password: PASSWORD, avatar: "rocket", isAdmin: true }, null],
    [{ username: "Valid_1", password: PASSWORD }, null]
  ])("rejects invalid registration %#", async (body, message) => {
    const server = await startTestServer();
    const response = await api<{ error: string }>(server.url, "/api/auth/register", { body });
    expect(response.status).toBe(400);
    if (message) expect(response.body.error).toBe(message);
    expect(await server.store.findUserByUsernameKey("valid_1")).toBeNull();
  });

  it.each(["Admin", "moderator", "System_1", "Imposter"])("refuses the reserved username %s", async (username) => {
    const server = await startTestServer();
    const response = await api<{ error: string }>(server.url, "/api/auth/register", { body: { username, password: PASSWORD, avatar: "rocket" } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("That username is reserved. Please choose another.");
  });

  it.each(["fuck_you", "bitch99", "madarchod", "shit"])("refuses the abusive username %s", async (username) => {
    const server = await startTestServer();
    const response = await api<{ error: string }>(server.url, "/api/auth/register", { body: { username, password: PASSWORD, avatar: "rocket" } });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("That username is not allowed. Please choose another.");
  });

  it("refuses a password that equals the username", async () => {
    const server = await startTestServer();
    const response = await api<{ error: string }>(server.url, "/api/auth/register", { body: { username: "Password1", password: "password1", avatar: "rocket" } });
    expect(response.status).toBe(400);
  });

  it("caps new accounts per window across the whole server", async () => {
    const server = await startTestServer({ accountOptions: { registrationLimit: 2 } });
    await register(server.url, "Limit_a");
    await register(server.url, "Limit_b");
    const third = await api(server.url, "/api/auth/register", { body: { username: "Limit_c", password: PASSWORD, avatar: "rocket" } });
    expect(third.status).toBe(429);
    expect(await server.store.findUserByUsernameKey("limit_c")).toBeNull();
  });
});

describe("sign-in and sessions", () => {
  it("signs in with the correct password (any username casing) and issues a fresh token", async () => {
    const server = await startTestServer();
    const registered = await register(server.url, "Foxtrot");
    const login = await api<AuthResponse>(server.url, "/api/auth/login", { body: { username: "foxtrot", password: PASSWORD } });
    expect(login.status).toBe(200);
    const body = authResponseSchema.parse(login.body);
    expect(body.account.username).toBe("Foxtrot");
    expect(body.token).not.toBe(registered.token);
  });

  it("gives the same answer for a wrong password and an unknown username", async () => {
    const server = await startTestServer();
    await register(server.url, "Golf");
    const wrongPassword = await api(server.url, "/api/auth/login", { body: { username: "Golf", password: "not the password" } });
    const unknownUser = await api(server.url, "/api/auth/login", { body: { username: "Nobody_here", password: PASSWORD } });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.text).toBe(unknownUser.text);
    expect(wrongPassword.body).toEqual({ error: "Incorrect username or password." });
  });

  it("locks a username after repeated failures without affecting other accounts", async () => {
    const server = await startTestServer({ accountOptions: { loginFailureLimit: 3 } });
    await register(server.url, "Hotel");
    await register(server.url, "India");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await api(server.url, "/api/auth/login", { body: { username: "Hotel", password: "wrong password" } })).status).toBe(401);
    }
    // Even the right password is refused while locked, so guessing cannot continue.
    expect((await api(server.url, "/api/auth/login", { body: { username: "hotel", password: PASSWORD } })).status).toBe(429);
    expect((await api(server.url, "/api/auth/login", { body: { username: "India", password: PASSWORD } })).status).toBe(200);
  });

  it("serves the signed-in account and rejects missing, malformed and revoked tokens", async () => {
    const server = await startTestServer();
    const { token } = await register(server.url, "Juliet", PASSWORD, "moon");
    const me = await api(server.url, "/api/auth/me", { token });
    expect(me.status).toBe(200);
    expect(accountSchema.parse(me.body)).toEqual({ username: "Juliet", avatar: "moon", joinedAt: expect.any(String) });

    expect((await api(server.url, "/api/auth/me")).status).toBe(401);
    expect((await api(server.url, "/api/auth/me", { token: "not-a-token" })).status).toBe(401);
    expect((await api(server.url, "/api/auth/me", { headers: { Authorization: token } })).status).toBe(401);
    expect((await api(server.url, "/api/auth/me", { token: "A".repeat(43) })).status).toBe(401);

    expect((await api(server.url, "/api/auth/logout", { method: "POST", token })).status).toBe(204);
    expect((await api(server.url, "/api/auth/me", { token })).status).toBe(401);
    // Logging out twice (or without a token) is harmless.
    expect((await api(server.url, "/api/auth/logout", { method: "POST", token })).status).toBe(204);
    expect((await api(server.url, "/api/auth/logout", { method: "POST" })).status).toBe(204);
  });

  it("expires sessions after 12 hours", async () => {
    let now = Date.now();
    const server = await startTestServer({ accountOptions: { now: () => now } });
    const { token } = await register(server.url, "Kilo");
    now += 12 * 3600_000 - 1_000;
    expect((await api(server.url, "/api/auth/me", { token })).status).toBe(200);
    now += 2_000;
    expect((await api(server.url, "/api/auth/me", { token })).status).toBe(401);
  });

  it("marks every API response as not cacheable", async () => {
    const server = await startTestServer();
    const response = await fetch(`${server.url}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Lima", password: PASSWORD, avatar: "rocket" })
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-powered-by")).toBeNull();
  });
});

describe("profile", () => {
  it("lets a signed-in player change only their own avatar", async () => {
    const server = await startTestServer();
    const mike = await register(server.url, "Mike");
    await register(server.url, "November", PASSWORD, "star");

    const updated = await api(server.url, "/api/me", { method: "PATCH", token: mike.token, body: { avatar: "crown" } });
    expect(updated.status).toBe(200);
    expect(accountSchema.parse(updated.body).avatar).toBe("crown");
    expect((await api(server.url, "/api/me", { method: "PATCH", body: { avatar: "crown" } })).status).toBe(401);
    expect((await api(server.url, "/api/me", { method: "PATCH", token: mike.token, body: { avatar: "dragon" } })).status).toBe(400);
    // The body cannot name another account or set other fields.
    expect((await api(server.url, "/api/me", { method: "PATCH", token: mike.token, body: { avatar: "cat", username: "November" } })).status).toBe(400);
    expect((await server.store.findUserByUsernameKey("november"))!.avatar).toBe("star");
  });

  it("shows a public profile with no private fields, and 404 for unknown players", async () => {
    const server = await startTestServer();
    await register(server.url, "Oscar", PASSWORD, "bot");
    const response = await api(server.url, "/api/players/oscar");
    expect(response.status).toBe(200);
    const profile = profileResponseSchema.parse(response.body);
    expect(profile.profile).toEqual({ username: "Oscar", avatar: "bot", joinedAt: expect.any(String) });
    expect(profile.stats).toEqual({ gamesPlayed: 0, wins: 0, draws: 0, losses: 0, winRatePercent: null, totalPoints: 0 });
    expect(profile.recentMatches).toEqual([]);
    const user = (await server.store.findUserByUsernameKey("oscar"))!;
    expect(response.text.includes(user.id)).toBe(false);
    expect(response.text.includes("scrypt")).toBe(false);

    expect((await api(server.url, "/api/players/Nobody_here")).status).toBe(404);
    expect((await api(server.url, "/api/players/bad%20name")).status).toBe(404);
  });

  it("serves an empty leaderboard before any counted game", async () => {
    const server = await startTestServer();
    const response = await api(server.url, "/api/leaderboard");
    expect(response.status).toBe(200);
    expect(leaderboardResponseSchema.parse(response.body).entries).toEqual([]);
  });
});

describe("API robustness", () => {
  it("answers malformed, oversized and unknown requests with a JSON error and no internals", async () => {
    const server = await startTestServer();
    const malformed = await api(server.url, "/api/auth/login", { method: "POST", rawBody: "{not json" });
    expect(malformed.status).toBe(400);
    expect(apiErrorSchema.parse(malformed.body).error).toBe("The request body must be valid JSON.");
    expect(malformed.text).not.toMatch(/at |node_modules|SyntaxError/);

    const oversized = await api(server.url, "/api/auth/login", { body: { username: "x", password: "y".repeat(20_000) } });
    expect(oversized.status).toBe(413);
    expect(apiErrorSchema.safeParse(oversized.body).success).toBe(true);

    const unknown = await api(server.url, "/api/nothing-here");
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "Not found." });

    const health = await api<{ storage: string }>(server.url, "/health");
    expect(health.body.storage).toBe("memory");
  });

  it("returns a generic 500 when the store fails, without leaking the error", async () => {
    const server = await startTestServer();
    vi.spyOn(server.store, "findUserByUsernameKey").mockRejectedValue(new Error("mongodb://user:secret@db.example/imposter refused"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await api(server.url, "/api/players/Oscar");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Something went wrong. Please try again." });
    expect(response.text.includes("secret")).toBe(false);
    expect(logged).toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
