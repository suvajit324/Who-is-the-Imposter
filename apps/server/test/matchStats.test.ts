import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, leaderboardEntrySchema, matchHistoryEntrySchema } from "@imposter/shared";
import { buildMatchRecord, type FinishedGame, type FinishedSeat } from "../src/domain/matchRecord.js";
import { MatchRecorder } from "../src/stats/matchRecorder.js";
import { compareLeaderboardRows, computeLeaderboard, computeStats, toHistoryEntry, winRatePercent } from "../src/stats/stats.js";
import { MemoryStore, type MatchRecord } from "../src/store/index.js";

afterEach(() => vi.restoreAllMocks());

const seat = (playerId: string, score: number, userId: string | null = null, connected = true): FinishedSeat => ({
  playerId,
  name: playerId.toUpperCase(),
  userId,
  avatar: userId ? "cat" : null,
  score,
  connected
});

const game = (seats: FinishedSeat[], overrides: Partial<FinishedGame> = {}): FinishedGame => ({
  gameId: "game-1",
  startedAt: Date.parse("2026-03-01T10:00:00Z"),
  endedAt: Date.parse("2026-03-01T10:07:30Z"),
  settings: defaultSettings,
  roundsPlayed: 3,
  rosterIds: new Set(seats.map((entry) => entry.playerId)),
  seats,
  ...overrides
});

const outcomes = (record: MatchRecord | null) => record?.participants.map((participant) => [participant.displayName, participant.finalRank, participant.outcome]);

describe("building a completed-match record", () => {
  it("gives first place the win and everyone else a loss, with competition ranks", () => {
    const { record } = buildMatchRecord(game([seat("a", 4, "u-a"), seat("b", 7), seat("c", 2), seat("d", 4)]));
    expect(outcomes(record)).toEqual([
      ["A", 2, "loss"],
      ["B", 1, "win"],
      ["C", 4, "loss"],
      ["D", 2, "loss"]
    ]);
    expect(record?.durationSeconds).toBe(450);
    expect(record?.roundsPlayed).toBe(3);
    expect(record?.status).toBe("completed");
    expect(record?.counted).toBe(true);
  });

  it("counts a shared first place as a win for each tied leader", () => {
    const { record } = buildMatchRecord(game([seat("a", 6, "u-a"), seat("b", 6, "u-b"), seat("c", 1)]));
    expect(outcomes(record)).toEqual([
      ["A", 1, "win"],
      ["B", 1, "win"],
      ["C", 3, "loss"]
    ]);
  });

  it("records a draw when every player finishes level", () => {
    const { record } = buildMatchRecord(game([seat("a", 2, "u-a"), seat("b", 2), seat("c", 2)]));
    expect(record?.participants.every((participant) => participant.outcome === "draw" && participant.finalRank === 1)).toBe(true);
  });

  it("keeps players who disconnected (they cannot dodge a loss) but drops players removed before the end", () => {
    const seats = [seat("a", 5, "u-a"), seat("b", 1, "u-b", false), seat("c", 3), seat("d", 0)];
    const { record } = buildMatchRecord(game(seats, { rosterIds: new Set(["a", "b", "c", "d", "kicked"]) }));
    expect(record?.participants.find((participant) => participant.userId === "u-b")).toMatchObject({ outcome: "loss", connectedAtEnd: false });
    expect(record?.participants).toHaveLength(4);
  });

  it("ignores players who were not dealt in when the game started", () => {
    const seats = [seat("a", 5, "u-a"), seat("b", 1), seat("c", 3), seat("late", 9, "u-late", false)];
    const { record } = buildMatchRecord(game(seats, { rosterIds: new Set(["a", "b", "c"]) }));
    expect(record?.participants.map((participant) => participant.userId)).toEqual(["u-a", null, null]);
    expect(record?.participants.find((participant) => participant.displayName === "A")?.outcome).toBe("win");
  });

  it("never links a guest's result to an account, and keeps one result per account", () => {
    const { record } = buildMatchRecord(game([seat("a", 5, "u-a"), seat("b", 1), seat("c", 3, "u-a")]));
    expect(record?.participants.map((participant) => participant.userId)).toEqual(["u-a", null, null]);
    expect(record?.participants.map((participant) => participant.avatar)).toEqual(["cat", null, null]);
  });

  it("stores nothing for games without enough players, without accounts or without a played round", () => {
    expect(buildMatchRecord(game([seat("a", 5, "u-a"), seat("b", 1)]))).toEqual({ record: null, reason: "too-few-players" });
    expect(buildMatchRecord(game([seat("a", 5), seat("b", 1), seat("c", 0)]))).toEqual({ record: null, reason: "no-accounts" });
    expect(buildMatchRecord(game([seat("a", 5, "u-a"), seat("b", 1), seat("c", 0)], { roundsPlayed: 0 }))).toEqual({ record: null, reason: "no-rounds" });
  });

  it("stores only allow-listed fields: no in-room ids, words, clues, roles or votes", () => {
    const seats = [seat("player-id-a", 5, "u-a"), seat("player-id-b", 1), seat("player-id-c", 3)].map((entry, index) => ({ ...entry, name: `Name${index}` }));
    const { record } = buildMatchRecord(game(seats));
    expect(Object.keys(record!).sort()).toEqual(
      ["counted", "durationSeconds", "endedAt", "id", "participants", "roundsPlayed", "settings", "startedAt", "status", "wordSource"].sort()
    );
    expect(Object.keys(record!.settings).sort()).toEqual(["categories", "difficulty", "rounds"]);
    for (const participant of record!.participants) {
      expect(Object.keys(participant).sort()).toEqual(["avatar", "connectedAtEnd", "displayName", "finalRank", "finalScore", "outcome", "seat", "userId"]);
    }
    expect(JSON.stringify(record)).not.toContain("player-id-");
  });
});

const recordWith = (id: string, endedAt: string, results: Array<[string | null, number, number, "win" | "draw" | "loss"]>, counted = true): MatchRecord => ({
  id,
  status: "completed",
  startedAt: new Date(Date.parse(endedAt) - 60_000),
  endedAt: new Date(endedAt),
  durationSeconds: 60,
  counted,
  wordSource: counted ? "curated" : "custom",
  settings: { categories: ["Food"], difficulty: "Any", rounds: 2 },
  roundsPlayed: 2,
  participants: results.map(([userId, finalScore, finalRank, outcome], index) => ({
    seat: index + 1,
    userId,
    displayName: userId ? userId.toUpperCase() : `Guest ${index + 1}`,
    avatar: userId ? "star" : null,
    finalScore,
    finalRank,
    outcome,
    connectedAtEnd: true
  }))
});

describe("player statistics", () => {
  it("handles a player with no completed games", () => {
    expect(computeStats("u1", [])).toEqual({ gamesPlayed: 0, wins: 0, draws: 0, losses: 0, winRatePercent: null, totalPoints: 0, bestScore: null });
  });

  it("counts wins, draws and losses once per match, and ignores uncounted matches and other players", () => {
    const matches = [
      recordWith("g1", "2026-01-01T10:00:00Z", [["u1", 6, 1, "win"], [null, 2, 2, "loss"], ["u2", 1, 3, "loss"]]),
      recordWith("g2", "2026-01-02T10:00:00Z", [["u1", 2, 2, "loss"], ["u2", 5, 1, "win"], [null, 0, 3, "loss"]]),
      recordWith("g3", "2026-01-03T10:00:00Z", [["u1", 3, 1, "draw"], [null, 3, 1, "draw"], [null, 3, 1, "draw"]]),
      recordWith("g4", "2026-01-04T10:00:00Z", [["u1", 9, 1, "win"], [null, 0, 2, "loss"], [null, 0, 2, "loss"]], false)
    ];
    expect(computeStats("u1", matches)).toEqual({ gamesPlayed: 3, wins: 1, draws: 1, losses: 1, winRatePercent: 33.3, totalPoints: 11, bestScore: 6 });
    expect(computeStats("u2", matches)).toEqual({ gamesPlayed: 2, wins: 1, draws: 0, losses: 1, winRatePercent: 50, totalPoints: 6, bestScore: 5 });
  });

  it("rounds the win rate to one decimal place", () => {
    expect(winRatePercent(0, 0)).toBeNull();
    expect(winRatePercent(0, 4)).toBe(0);
    expect(winRatePercent(2, 3)).toBe(66.7);
    expect(winRatePercent(1, 8)).toBe(12.5);
    expect(winRatePercent(5, 5)).toBe(100);
  });
});

describe("match history entries", () => {
  it("shows the player's own result and the final standings, and nothing private", () => {
    const match = recordWith("secret-game-id", "2026-01-01T10:00:00Z", [[null, 2, 2, "loss"], ["u1", 6, 1, "win"], ["u2", 1, 3, "loss"]]);
    const entry = matchHistoryEntrySchema.parse(toHistoryEntry("u1", match));
    expect(entry).toMatchObject({ outcome: "win", finalScore: 6, finalRank: 1, roundsPlayed: 2, durationSeconds: 60, counted: true });
    expect(entry.participants).toEqual([
      { name: "U1", username: "U1", avatar: "star", finalScore: 6, finalRank: 1, you: true },
      { name: "Guest 1", username: null, avatar: null, finalScore: 2, finalRank: 2, you: false },
      { name: "U2", username: "U2", avatar: "star", finalScore: 1, finalRank: 3, you: false }
    ]);
    const wire = JSON.stringify(entry);
    for (const hidden of ["secret-game-id", "\"u1\"", "\"u2\"", "seat", "userId"]) expect(wire).not.toContain(hidden);
  });

  it("returns nothing for a match the player was not in", () => {
    expect(toHistoryEntry("u9", recordWith("g", "2026-01-01T10:00:00Z", [["u1", 1, 1, "win"], [null, 0, 2, "loss"], [null, 0, 2, "loss"]]))).toBeNull();
  });
});

describe("leaderboard ranking", () => {
  const users = new Map(
    ["alpha", "bravo", "charlie", "delta", "echo", "fox"].map((name) => [name, { username: name[0].toUpperCase() + name.slice(1), avatar: "rocket" as const }])
  );
  const win = (userId: string, points: number, id: string) => recordWith(id, "2026-01-01T10:00:00Z", [[userId, points, 1, "win"], [null, 0, 2, "loss"], [null, 0, 2, "loss"]]);
  const loss = (userId: string, points: number, id: string) => recordWith(id, "2026-01-01T10:00:00Z", [[null, 9, 1, "win"], [userId, points, 2, "loss"], [null, 0, 3, "loss"]]);

  it("orders by wins, then win rate, then total points; full ties share a rank", () => {
    const matches = [
      // Alpha: 3 wins in 4 games (75%), 12 points.
      win("alpha", 4, "a1"), win("alpha", 4, "a2"), win("alpha", 4, "a3"), loss("alpha", 0, "a4"),
      // Bravo: 3 wins in 3 games (100%) -> above Alpha on win rate.
      win("bravo", 2, "b1"), win("bravo", 2, "b2"), win("bravo", 2, "b3"),
      // Charlie and Delta: 2 wins in 2 games, 6 points each -> tied.
      win("charlie", 3, "c1"), win("charlie", 3, "c2"),
      win("delta", 3, "d1"), win("delta", 3, "d2"),
      // Echo: 2 wins in 2 games but fewer points -> below the tie.
      win("echo", 1, "e1"), win("echo", 1, "e2"),
      // Fox: no wins.
      loss("fox", 5, "f1")
    ];
    const entries = computeLeaderboard(matches, users);
    for (const entry of entries) leaderboardEntrySchema.parse(entry);
    expect(entries.map((entry) => [entry.rank, entry.username, entry.wins, entry.gamesPlayed, entry.winRatePercent, entry.totalPoints])).toEqual([
      [1, "Bravo", 3, 3, 100, 6],
      [2, "Alpha", 3, 4, 75, 12],
      [3, "Charlie", 2, 2, 100, 6],
      [3, "Delta", 2, 2, 100, 6],
      [5, "Echo", 2, 2, 100, 2],
      [6, "Fox", 0, 1, 0, 5]
    ]);
  });

  it("leaves out guests, uncounted matches and deleted accounts, and caps the size", () => {
    const matches = [
      recordWith("g1", "2026-01-01T10:00:00Z", [["alpha", 5, 1, "win"], [null, 9, 1, "win"], ["ghost-account", 1, 3, "loss"]]),
      recordWith("g2", "2026-01-02T10:00:00Z", [["bravo", 5, 1, "win"], [null, 0, 2, "loss"], [null, 0, 2, "loss"]], false)
    ];
    expect(computeLeaderboard(matches, users).map((entry) => entry.username)).toEqual(["Alpha"]);
    const many = Array.from({ length: 5 }, (_, index) => win(["alpha", "bravo", "charlie", "delta", "echo"][index], index, `m${index}`));
    expect(computeLeaderboard(many, users, 3)).toHaveLength(3);
  });

  it("compares win rates exactly rather than by rounded percentages", () => {
    const base = { draws: 0, losses: 0, bestScore: null, username: "x", avatar: "rocket" as const, totalPoints: 0 };
    // 2/3 = 66.67% beats 1999/3000 = 66.63% although both would round to 66.7.
    expect(compareLeaderboardRows({ ...base, wins: 2000, gamesPlayed: 3000 }, { ...base, wins: 2000, gamesPlayed: 3001 })).toBeLessThan(0);
  });
});

describe("saving completed matches exactly once", () => {
  const match = () => recordWith("game-x", "2026-01-01T10:00:00Z", [["u1", 3, 1, "win"], [null, 1, 2, "loss"], [null, 0, 3, "loss"]]);

  it("saves once even when the same game is reported again, or concurrently", async () => {
    const store = new MemoryStore();
    const saveMatch = vi.spyOn(store, "saveMatch");
    const recorder = new MatchRecorder(store);
    const [first, concurrent] = await Promise.all([recorder.record(match()), recorder.record(match())]);
    expect([first, concurrent]).toEqual(["saved", "duplicate"]);
    expect(await recorder.record(match())).toBe("duplicate");
    expect(saveMatch).toHaveBeenCalledTimes(1);
    expect(await store.countMatchesForUser("u1")).toBe(1);
  });

  it("relies on the store's unique id across separate recorders (e.g. after a restart)", async () => {
    const store = new MemoryStore();
    expect(await new MatchRecorder(store).record(match())).toBe("saved");
    expect(await new MatchRecorder(store).record(match())).toBe("duplicate");
    expect(await store.countMatchesForUser("u1")).toBe(1);
  });

  it("retries a failed save, and treats an already-stored match as saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new MemoryStore();
    const realSave = store.saveMatch.bind(store);
    let calls = 0;
    vi.spyOn(store, "saveMatch").mockImplementation(async (record) => {
      calls += 1;
      if (calls === 1) throw new Error("network blip");
      if (calls === 2) {
        // The write reached the database but the reply was lost.
        await realSave(record);
        throw new Error("reply lost");
      }
      return realSave(record);
    });
    const recorder = new MatchRecorder(store, { retryDelaysMs: [1, 1, 1] });
    expect(await recorder.record(match())).toBe("duplicate");
    expect(calls).toBe(3);
    expect(await store.countMatchesForUser("u1")).toBe(1);
  });

  it("gives up after the last retry without throwing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new MemoryStore();
    vi.spyOn(store, "saveMatch").mockRejectedValue(new Error("database down"));
    const recorder = new MatchRecorder(store, { retryDelaysMs: [1, 1] });
    expect(await recorder.record(match())).toBe("failed");
    expect(store.saveMatch).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalled();
  });
});
