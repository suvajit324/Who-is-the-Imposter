import { describe, expect, it } from "vitest";
import { MemoryStore, type MatchRecord, type UserRecord } from "../src/store/index.js";

const user = (id: string, username: string): UserRecord => ({
  id,
  username,
  usernameKey: username.toLowerCase(),
  passwordHash: "scrypt$hash",
  avatar: "rocket",
  createdAt: new Date("2026-01-01T00:00:00Z")
});

const match = (id: string, endedAt: string, userIds: Array<string | null>, counted = true): MatchRecord => ({
  id,
  startedAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: new Date(endedAt),
  counted,
  wordSource: counted ? "curated" : "custom",
  settings: { categories: ["Food"], difficulty: "Any", rounds: 1 },
  participants: userIds.map((userId, index) => ({
    seat: index + 1,
    userId,
    displayName: `P${index + 1}`,
    avatar: null,
    finalScore: 0,
    finalRank: 1,
    outcome: "draw"
  })),
  rounds: []
});

describe("MemoryStore (demo storage) contract", () => {
  it("reports itself as memory storage, never as persistent", async () => {
    const store = new MemoryStore();
    await store.ready();
    expect(store.storageMode()).toBe("memory");
  });

  it("enforces unique usernames case-insensitively through usernameKey", async () => {
    const store = new MemoryStore();
    expect(await store.createUser(user("u1", "Alice"))).toBe("created");
    expect(await store.createUser(user("u2", "ALICE"))).toBe("username-taken");
    expect((await store.findUserByUsernameKey("alice"))?.id).toBe("u1");
    expect(await store.findUserByUsernameKey("bob")).toBeNull();
    expect((await store.findUsersByIds(["u1", "missing"])).map((found) => found.id)).toEqual(["u1"]);
  });

  it("updates avatars and never lets callers mutate stored records", async () => {
    const store = new MemoryStore();
    const original = user("u1", "Alice");
    await store.createUser(original);
    original.avatar = "ghost";
    const read = (await store.findUserById("u1"))!;
    expect(read.avatar).toBe("rocket");
    read.passwordHash = "tampered";
    expect((await store.findUserById("u1"))!.passwordHash).toBe("scrypt$hash");

    await store.updateUserAvatar("u1", "cat");
    expect((await store.findUserById("u1"))!.avatar).toBe("cat");
  });

  it("stores, finds and deletes sessions, and prunes expired ones", async () => {
    let now = Date.parse("2026-01-01T00:00:00Z");
    const store = new MemoryStore(() => now);
    await store.createSession({ tokenHash: "old", userId: "u1", createdAt: new Date(now), expiresAt: new Date(now + 1_000) });
    expect((await store.findSession("old"))?.userId).toBe("u1");

    now += 2_000;
    await store.createSession({ tokenHash: "new", userId: "u1", createdAt: new Date(now), expiresAt: new Date(now + 1_000) });
    expect(await store.findSession("old")).toBeNull();
    expect(await store.findSession("new")).not.toBeNull();

    await store.deleteSession("new");
    expect(await store.findSession("new")).toBeNull();
  });

  it("saves a match exactly once", async () => {
    const store = new MemoryStore();
    expect(await store.saveMatch(match("g1", "2026-01-02T00:00:00Z", ["u1", null, null]))).toBe("saved");
    expect(await store.saveMatch(match("g1", "2026-01-03T00:00:00Z", ["u1", "u2", null]))).toBe("duplicate");
    const rows = await store.listMatchesForUser("u1");
    expect(rows).toHaveLength(1);
    expect(rows[0].endedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(await store.listMatchesForUser("u2")).toEqual([]);
  });

  it("lists a player's matches newest first, with countedOnly and limit", async () => {
    const store = new MemoryStore();
    await store.saveMatch(match("g1", "2026-01-01T10:00:00Z", ["u1", null, null]));
    await store.saveMatch(match("g2", "2026-01-03T10:00:00Z", ["u1", null, null], false));
    await store.saveMatch(match("g3", "2026-01-02T10:00:00Z", [null, "u1", null]));
    await store.saveMatch(match("g4", "2026-01-04T10:00:00Z", ["u2", null, null]));

    expect((await store.listMatchesForUser("u1")).map((row) => row.id)).toEqual(["g2", "g3", "g1"]);
    expect((await store.listMatchesForUser("u1", { countedOnly: true })).map((row) => row.id)).toEqual(["g3", "g1"]);
    expect((await store.listMatchesForUser("u1", { limit: 1 })).map((row) => row.id)).toEqual(["g2"]);
    expect((await store.listCountedMatches()).map((row) => row.id).sort()).toEqual(["g1", "g3", "g4"]);
  });

  it("returns copies of matches", async () => {
    const store = new MemoryStore();
    await store.saveMatch(match("g1", "2026-01-01T10:00:00Z", ["u1", null, null]));
    const [first] = await store.listMatchesForUser("u1");
    first.participants[0].finalScore = 999;
    const [again] = await store.listCountedMatches();
    expect(again.participants[0].finalScore).toBe(0);
  });
});
