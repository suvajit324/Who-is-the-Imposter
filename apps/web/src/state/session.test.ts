import { afterEach, describe, expect, it } from "vitest";
import { clearSession, getSession, getToken, setSession, updateSessionAccount } from "./session.js";

const session = (expiresInMs: number) => ({
  token: "t".repeat(43),
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  account: { username: "Nova", avatar: "rocket" as const, joinedAt: "2026-01-01T00:00:00.000Z" }
});

afterEach(() => {
  clearSession();
  sessionStorage.clear();
  localStorage.clear();
});

describe("session storage", () => {
  it("keeps the token in sessionStorage and never in localStorage", () => {
    setSession(session(60_000));
    expect(getToken()).toBe("t".repeat(43));
    expect(sessionStorage.getItem("imposter.session")).toContain("t".repeat(43));
    for (let index = 0; index < localStorage.length; index += 1) {
      expect(localStorage.getItem(localStorage.key(index)!)).not.toContain("t".repeat(43));
    }
  });

  it("forgets an expired session", () => {
    setSession(session(-1));
    expect(getSession()).toBeNull();
    expect(sessionStorage.getItem("imposter.session")).toBeNull();
  });

  it("updates the account without changing the token, and clears fully on sign-out", () => {
    setSession(session(60_000));
    updateSessionAccount({ username: "Nova", avatar: "cat", joinedAt: "2026-01-01T00:00:00.000Z" });
    expect(getSession()?.account.avatar).toBe("cat");
    expect(getToken()).toBe("t".repeat(43));
    clearSession();
    expect(getSession()).toBeNull();
    expect(sessionStorage.getItem("imposter.session")).toBeNull();
  });
});
