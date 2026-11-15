import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leaderboardResponseSchema,
  matchHistoryResponseSchema,
  profileResponseSchema,
  type AuthResponse,
  type LeaderboardResponse,
  type MatchHistoryResponse,
  type ProfileResponse,
  type PublicRoomState
} from "@imposter/shared";
import {
  api,
  closeAll,
  createRoomWith,
  pause,
  playGame,
  playRound,
  readyAndStart,
  startTestServer,
  until,
  waitForPhase,
  type TestServer,
  type TrackedPlayer
} from "./helpers/harness.js";

vi.setConfig({ testTimeout: 40_000 });

afterEach(closeAll);

const PASSWORD = "correct horse 42";

async function register(server: TestServer, username: string, avatar = "rocket") {
  const response = await api<AuthResponse>(server.url, "/api/auth/register", { body: { username, password: PASSWORD, avatar } });
  expect(response.status, response.text).toBe(201);
  return response.body.token;
}

const savedMatches = (server: TestServer) => server.store.listCountedMatches();

/** Saving happens asynchronously after GAME_END; poll the store until the expected number of records exists. */
async function waitForSavedMatches(server: TestServer, count: number, timeoutMs = 5_000) {
  const started = Date.now();
  while ((await savedMatches(server)).length !== count) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${count} saved match(es)`);
    await pause(10);
  }
}

/** Expected outcome per player name from the final room state, using the game's "highest score wins" rule. */
function expectedOutcomes(state: PublicRoomState) {
  const top = Math.max(...state.players.map((player) => player.score));
  const allLevel = state.players.every((player) => player.score === top);
  return Object.fromEntries(state.players.map((player) => [player.name, allLevel ? "draw" : player.score === top ? "win" : "loss"]));
}

const profileOf = async (server: TestServer, username: string) => (await api<ProfileResponse>(server.url, `/api/players/${username}`)).body;
const historyOf = async (server: TestServer, token: string, query = "") => api<MatchHistoryResponse>(server.url, `/api/me/matches${query}`, { token });

describe("recording completed matches", () => {
  it("saves one record per completed game with outcomes that match the final scores", async () => {
    const server = await startTestServer();
    const tokens = [await register(server, "Rec_Alpha", "moon"), await register(server, "Rec_Bravo", "fish"), undefined];
    const players = await createRoomWith(server.url, ["xx", "yy", "Zed Guest"], tokens);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await playGame(players, 2, [{ catchImposter: true }, { catchImposter: false }]);
    await waitForSavedMatches(server, 1);

    const finalState = players[0].lastState!;
    const expected = expectedOutcomes(finalState);
    const [record] = await savedMatches(server);
    expect(record.status).toBe("completed");
    expect(record.roundsPlayed).toBe(2);
    expect(record.participants.map((participant) => participant.displayName)).toEqual(["Rec_Alpha", "Rec_Bravo", "Zed Guest"]);
    for (const participant of record.participants) {
      const seatState = finalState.players.find((player) => player.name === participant.displayName)!;
      expect(participant.finalScore).toBe(seatState.score);
      expect(participant.outcome).toBe(expected[participant.displayName]);
    }
    // The guest seat is never linked to an account.
    expect(record.participants[2].userId).toBeNull();
    expect(record.participants[0].userId).not.toBeNull();

    const alpha = profileResponseSchema.parse(await profileOf(server, "Rec_Alpha"));
    const alphaSeat = finalState.players.find((player) => player.name === "Rec_Alpha")!;
    expect(alpha.stats.gamesPlayed).toBe(1);
    expect(alpha.stats.totalPoints).toBe(alphaSeat.score);
    expect(alpha.stats.wins + alpha.stats.draws + alpha.stats.losses).toBe(1);
    expect(alpha.stats.winRatePercent).toBe(expected.Rec_Alpha === "win" ? 100 : 0);
  });

  it("does not record a game twice, and records a rematch as a separate game", async () => {
    const server = await startTestServer();
    const tokens = [await register(server, "Twice_Host"), undefined, undefined];
    const players = await createRoomWith(server.url, ["xx", "Ben", "Cy"], tokens);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);
    await waitForSavedMatches(server, 1);

    // Repeated "finish" requests after the end are refused and change nothing.
    expect((await players[0].client.emitWithAck("game:next-round", {})).ok).toBe(false);
    await pause(50);
    expect(await savedMatches(server)).toHaveLength(1);

    expect(await players[0].client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await waitForPhase(players, "LOBBY");
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playRound(players, 1);
    expect(await players[0].client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
    await waitForPhase(players, "GAME_END");
    await waitForSavedMatches(server, 2);

    const ids = (await savedMatches(server)).map((match) => match.id);
    expect(new Set(ids).size).toBe(2);
    expect(profileResponseSchema.parse(await profileOf(server, "Twice_Host")).stats.gamesPlayed).toBe(2);
  });

  it("keeps the record when everyone leaves the results screen straight away", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["xx", "Ben", "Cy"], [await register(server, "Quick_Exit")]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);
    for (const player of players) player.client.disconnect();
    await waitForSavedMatches(server, 1);
    expect((await savedMatches(server))[0].participants).toHaveLength(3);
  });

  it("never records a cancelled game", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["xx", "Ben", "Cy"], [await register(server, "Cancel_Me")]);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await playRound(players, 0);
    players[2].client.disconnect();
    await until(() => players[0].lastState?.phase === "CANCELLED", "the cancellation");
    await pause(100);
    expect(await savedMatches(server)).toHaveLength(0);
    expect(profileResponseSchema.parse(await profileOf(server, "Cancel_Me")).stats.gamesPlayed).toBe(0);

    // A rematch after a cancellation starts a new game; the cancelled one still never appears.
    expect(await players[0].client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await pause(50);
    expect(await savedMatches(server)).toHaveLength(0);
  });

  it("does not store games played only by guests", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);
    await pause(100);
    expect(await savedMatches(server)).toHaveLength(0);
  });

  it("leaves out a player removed by the host during the game", async () => {
    const server = await startTestServer();
    const tokens = [await register(server, "Kick_Host"), await register(server, "Kick_B"), await register(server, "Kick_C"), undefined];
    const players = await createRoomWith(server.url, ["xx", "yy", "zz", "Dee"], tokens);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await until(() => players.every((player) => player.secrets.length === 1), "roles");
    const removed = players.slice(1, 3).find((player) => player.secrets[0].role !== "Imposter")!;
    expect(await players[0].client.emitWithAck("player:kick", { playerId: removed.playerId })).toEqual({ ok: true });
    const remaining = players.filter((player) => player !== removed);
    await playRound(remaining, 0);
    expect(await players[0].client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
    await waitForPhase(remaining, "GAME_END");
    await waitForSavedMatches(server, 1);

    const removedUsername = players.indexOf(removed) === 1 ? "Kick_B" : "Kick_C";
    const keptUsername = removedUsername === "Kick_B" ? "Kick_C" : "Kick_B";
    const [record] = await savedMatches(server);
    // Seats stay in join order without the removed player.
    expect(record.participants.map((participant) => participant.displayName)).toEqual(["Kick_Host", keptUsername, "Dee"]);
    expect(profileResponseSchema.parse(await profileOf(server, removedUsername)).stats.gamesPlayed).toBe(0);
    expect(profileResponseSchema.parse(await profileOf(server, keptUsername)).stats.gamesPlayed).toBe(1);
  });

  it("never credits a guest's result to an account with the same name", async () => {
    const server = await startTestServer();
    await register(server, "Ghosty");
    const witness = await register(server, "Witness");
    const players = await createRoomWith(server.url, ["xx", "Ghosty", "Cy"], [witness]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);
    await waitForSavedMatches(server, 1);

    expect(profileResponseSchema.parse(await profileOf(server, "Ghosty")).stats.gamesPlayed).toBe(0);
    const history = matchHistoryResponseSchema.parse((await historyOf(server, witness)).body);
    expect(history.matches[0].participants.find((participant) => participant.name === "Ghosty")).toMatchObject({ username: null, avatar: null });
    const leaderboard = leaderboardResponseSchema.parse((await api(server.url, "/api/leaderboard")).body);
    expect(leaderboard.entries.map((entry) => entry.username)).toEqual(["Witness"]);
  });
});

describe("match history access", () => {
  it("shows each signed-in player only their own matches, with paging", async () => {
    const server = await startTestServer();
    const mine = await register(server, "Hist_Mine");
    const stranger = await register(server, "Hist_Stranger");
    const players = await createRoomWith(server.url, ["xx", "Ben", "Cy"], [mine]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);
    await waitForSavedMatches(server, 1);

    const own = await historyOf(server, mine);
    expect(own.status).toBe(200);
    const body = matchHistoryResponseSchema.parse(own.body);
    expect(body).toMatchObject({ page: 1, pageSize: 10, totalMatches: 1, totalPages: 1 });
    expect(body.matches[0].participants.filter((participant) => participant.you)).toHaveLength(1);
    expect(body.matches[0].participants.find((participant) => participant.you)?.name).toBe("Hist_Mine");

    // Another account sees nothing, and cannot ask for someone else's history.
    const other = matchHistoryResponseSchema.parse((await historyOf(server, stranger, "?username=Hist_Mine&userId=x")).body);
    expect(other.matches).toEqual([]);
    expect(other.totalMatches).toBe(0);

    expect((await api(server.url, "/api/me/matches")).status).toBe(401);
    expect((await historyOf(server, "A".repeat(43))).status).toBe(401);
    expect(matchHistoryResponseSchema.parse((await historyOf(server, mine, "?page=2")).body).matches).toEqual([]);
    for (const bad of ["?page=0", "?page=-1", "?page=abc", "?page=1.5", "?page=99999", "?page=1&page=2"]) {
      expect((await historyOf(server, mine, bad)).status, bad).toBe(400);
    }
  });

  it("refuses any attempt to write statistics or match results", async () => {
    const server = await startTestServer();
    const token = await register(server, "Tamper");
    const attempts: Array<[string, string, unknown]> = [
      ["POST", "/api/leaderboard", { username: "Tamper", wins: 999 }],
      ["POST", "/api/me/matches", { outcome: "win" }],
      ["PATCH", "/api/me/matches", { outcome: "win" }],
      ["PUT", "/api/players/Tamper", { stats: { wins: 999 } }],
      ["PATCH", "/api/me", { avatar: "cat", wins: 999 }]
    ];
    for (const [method, path, body] of attempts) {
      const response = await api(server.url, path, { method, body, token });
      expect([400, 404], `${method} ${path}`).toContain(response.status);
    }
    expect(profileResponseSchema.parse(await profileOf(server, "Tamper")).stats.wins).toBe(0);
    expect(await savedMatches(server)).toHaveLength(0);
  });
});

describe("privacy of profile, history and leaderboard responses", () => {
  it("never reveals words, clues, roles, votes, room details, ids or credentials", async () => {
    const server = await startTestServer();
    const tokens = [await register(server, "Priv_Host", "zap"), await register(server, "Priv_B", "bot"), undefined, undefined];
    const players: TrackedPlayer[] = await createRoomWith(server.url, ["xx", "yy", "Cyra", "Dax"], tokens);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await playGame(players, 2, [{ catchImposter: true }, { catchImposter: false }]);
    await waitForSavedMatches(server, 1);

    const users = await Promise.all(["priv_host", "priv_b"].map((key) => server.store.findUserByUsernameKey(key)));
    const secrets = new Set<string>([
      ...players.flatMap((player) => player.secrets.map((secret) => secret.word)),
      ...players.flatMap((player) => (player.lastState?.roundHistory ?? []).flatMap((round) => [round.mainWord ?? "", round.imposterWord])),
      ...players.flatMap((player) => (player.lastState?.roundHistory ?? []).flatMap((round) => round.clues.map((clue) => clue.clue ?? ""))),
      players[0].roomCode,
      ...players.flatMap((player) => [player.playerId, player.reconnectToken]),
      ...users.flatMap((user) => [user!.id, user!.passwordHash]),
      ...tokens.flatMap((token) => (token ? [token] : [])),
      (await savedMatches(server))[0].id
    ]);
    secrets.delete("");

    const responses = [
      await api(server.url, "/api/players/Priv_Host"),
      await api(server.url, "/api/players/Priv_B"),
      await api(server.url, "/api/leaderboard"),
      await historyOf(server, tokens[0]!),
      await historyOf(server, tokens[1]!)
    ];
    profileResponseSchema.parse(responses[0].body);
    leaderboardResponseSchema.parse(responses[2].body as LeaderboardResponse);
    matchHistoryResponseSchema.parse(responses[3].body);

    for (const response of responses) {
      expect(response.status).toBe(200);
      for (const secret of secrets) expect(response.text.includes(secret), `leaked "${secret}"`).toBe(false);
      expect(response.text).not.toMatch(/imposter|impostor|role|vote|clue|word|roomCode|userId|seat|token|password/i);
    }
  });
});
