import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateScores } from "../src/domain/scoring.js";
import { api, closeAll, connectClient, createRoomWith, pause, playGame, readyAndStart, startTestServer, until } from "./helpers/harness.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeAll();
});

describe("W1: a failing database save never takes the server down", () => {
  it("finishes the game, logs the failure and keeps serving new rooms", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const saveCompletedGame = vi.fn(async () => {
      throw new Error("database unreachable");
    });
    try {
      const server = await startTestServer({ persistence: { enabled: true, saveCompletedGame } });
      const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
      await readyAndStart(players, { rounds: 1, discussionEnabled: false });
      await playGame(players, 1);

      await until(() => saveCompletedGame.mock.calls.length === 1, "the save attempt");
      await pause(30);
      expect(unhandled).toEqual([]);
      expect(logged).toHaveBeenCalledWith("[persistence] Failed to save the completed game:", expect.any(Error));
      expect(players.every((player) => player.lastState?.phase === "GAME_END")).toBe(true);

      const fresh = await connectClient(server.url);
      expect((await fresh.emitWithAck("room:create", { playerName: "Dee" })).ok).toBe(true);
      expect((await api(server.url, "/health")).status).toBe(200);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("W11: a finished game stays finished when players leave", () => {
  it("keeps GAME_END (not CANCELLED) when players disconnect from the results screen", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);

    players[2].client.disconnect();
    await until(() => players[0].lastState?.players.find((player) => player.name === "Cy")?.connected === false, "Cy's disconnect");
    expect(players[0].lastState?.phase).toBe("GAME_END");
    expect(players[0].lastState?.cancelledReason).toBeNull();

    // The host can still start a rematch from the finished game.
    expect(await players[0].client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await until(() => players[0].lastState?.phase === "LOBBY", "the rematch lobby");
  });

  it("still cancels a game in progress when too few players remain", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await until(() => players[0].lastState?.phase === "ROLE_ASSIGNMENT", "the first round");

    players[2].client.disconnect();
    await until(() => players[0].lastState?.phase === "CANCELLED", "the cancellation");
  });
});

describe("W12: scoring when the Imposter has left the room", () => {
  it("never produces NaN or points for an absent Imposter", () => {
    const escaped = calculateScores({
      playerIds: ["a", "b", "c"],
      imposterId: "gone",
      votes: new Map([["a", "b"], ["b", "a"], ["c", "b"]]),
      selectedPlayerId: "b",
      imposterGuessCorrect: false
    });
    expect(Object.keys(escaped).sort()).toEqual(["a", "b", "c"]);
    for (const points of Object.values(escaped)) expect(Number.isFinite(points)).toBe(true);

    const guessed = calculateScores({
      playerIds: ["a", "b", "c"],
      imposterId: "gone",
      votes: new Map([["a", "gone"], ["b", "gone"], ["c", "gone"]]),
      selectedPlayerId: "gone",
      imposterGuessCorrect: true
    });
    expect(Object.keys(guessed).sort()).toEqual(["a", "b", "c"]);
    for (const points of Object.values(guessed)) expect(Number.isFinite(points)).toBe(true);
  });

  it("still scores an Imposter who is present", () => {
    const points = calculateScores({
      playerIds: ["a", "b", "imp"],
      imposterId: "imp",
      votes: new Map([["a", "b"], ["b", "a"], ["imp", "a"]]),
      selectedPlayerId: "a",
      imposterGuessCorrect: false
    });
    expect(points.imp).toBeGreaterThan(0);
  });
});
