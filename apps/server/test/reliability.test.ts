import { afterEach, describe, expect, it } from "vitest";
import {
  api,
  closeAll,
  connectClient,
  createRoomWith,
  pause,
  playGame,
  readyAndStart,
  startTestServer,
  track,
  until,
  waitForPhase,
  type TrackedPlayer
} from "./helpers/harness.js";

/*
 * Phase 3 regression tests: each case failed before the matching fix.
 */

afterEach(async () => {
  await closeAll();
});

const PASSWORD = "correct horse 42";
const ALREADY_SEATED = "You are already in a room. Leave it before joining another.";

const credentialsOf = (player: TrackedPlayer) => ({ roomCode: player.roomCode, playerId: player.playerId, reconnectToken: player.reconnectToken });

async function reachVoting(players: TrackedPlayer[]) {
  await until(() => players.every((player) => player.secrets.length === 1), "roles");
  await waitForPhase(players, "ROLE_ASSIGNMENT");
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await waitForPhase(players, "CLUE_PHASE");
  for (const [index, player] of players.entries()) {
    expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxyz"[index]}k` })).toEqual({ ok: true });
  }
  await waitForPhase(players, "VOTING");
}

describe("sign-in and registration limits under parallel requests", () => {
  it("cannot be bypassed by sending many sign-in attempts at once", async () => {
    const server = await startTestServer({ accountOptions: { loginFailureLimit: 3 } });
    expect((await api(server.url, "/api/auth/register", { body: { username: "Burst", password: PASSWORD, avatar: "cat" } })).status).toBe(201);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => api(server.url, "/api/auth/login", { body: { username: "Burst", password: "wrong password" } }))
    );
    const statuses = attempts.map((attempt) => attempt.status).sort();
    expect(statuses.filter((status) => status === 401)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    // Still locked, even with the right password.
    expect((await api(server.url, "/api/auth/login", { body: { username: "Burst", password: PASSWORD } })).status).toBe(429);
  });

  it("still lets the owner sign in after a few mistakes, and a success clears the count", async () => {
    const server = await startTestServer({ accountOptions: { loginFailureLimit: 3 } });
    await api(server.url, "/api/auth/register", { body: { username: "Oops", password: PASSWORD, avatar: "cat" } });
    for (let round = 0; round < 3; round += 1) {
      expect((await api(server.url, "/api/auth/login", { body: { username: "Oops", password: "wrong password" } })).status).toBe(401);
      expect((await api(server.url, "/api/auth/login", { body: { username: "Oops", password: "wrong password" } })).status).toBe(401);
      expect((await api(server.url, "/api/auth/login", { body: { username: "Oops", password: PASSWORD } })).status).toBe(200);
    }
  });

  it("caps new accounts even when the registrations arrive at the same moment", async () => {
    const server = await startTestServer({ accountOptions: { registrationLimit: 2 } });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        api(server.url, "/api/auth/register", { body: { username: `Rush_${index}`, password: PASSWORD, avatar: "cat" } })
      )
    );
    expect(results.filter((result) => result.status === 201)).toHaveLength(2);
    expect(results.filter((result) => result.status === 429)).toHaveLength(4);
  });
});

describe("response headers", () => {
  it("marks responses as nosniff", async () => {
    const server = await startTestServer();
    for (const path of ["/health", "/api/leaderboard", "/api/does-not-exist"]) {
      const response = await fetch(`${server.url}${path}`);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });
});

describe("one seat per connection", () => {
  it("refuses to create, join or resume a second seat from a connection that already has one", async () => {
    const server = await startTestServer();
    const first = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    const other = await createRoomWith(server.url, ["Dee", "Eve", "Fay"]);
    const ben = first[1];

    expect(await ben.client.emitWithAck("room:create", { playerName: "Ben Two" })).toEqual({ ok: false, message: ALREADY_SEATED });
    expect(await ben.client.emitWithAck("room:join", { roomCode: other[0].roomCode, playerName: "Ben Two" })).toEqual({ ok: false, message: ALREADY_SEATED });
    expect(await ben.client.emitWithAck("room:reconnect-player", credentialsOf(other[1]))).toEqual({ ok: false, message: ALREADY_SEATED });

    // Ben's seat is untouched and still works.
    expect(first[0].lastState?.players.find((player) => player.name === "Ben")?.connected).toBe(true);
    expect(other[0].lastState?.players).toHaveLength(3);
    expect(await ben.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
    // Resuming your own seat on the same connection is still allowed.
    expect((await ben.client.emitWithAck("room:reconnect-player", credentialsOf(ben))).ok).toBe(true);
  });

  it("lets a removed player start or join another room from the same connection", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    expect(await players[0].client.emitWithAck("player:kick", { playerId: players[2].playerId })).toEqual({ ok: true });
    expect((await players[2].client.emitWithAck("room:create", { playerName: "Cy" })).ok).toBe(true);
  });
});

describe("reconnecting while the server still holds the old connection", () => {
  it("does not mark the player offline when the old connection finally closes", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    const [host, ben] = players;

    // Ben's network changed: a new connection resumes the seat before the old one is closed.
    const fresh = track("Ben", await connectClient(server.url), credentialsOf(ben));
    expect((await fresh.client.emitWithAck("room:reconnect-player", credentialsOf(ben))).ok).toBe(true);
    ben.client.disconnect();
    await pause(100);

    expect(host.lastState?.players.find((player) => player.name === "Ben")?.connected).toBe(true);
    expect(host.events.some((event) => event.event === "chat:message" && JSON.stringify(event.payload).includes("Ben disconnected"))).toBe(false);
    expect(await fresh.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  });

  it("keeps a game running and deals the next round to the new connection", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await until(() => players.every((player) => player.secrets.length === 1), "roles");

    const fresh = track("Cy", await connectClient(server.url), credentialsOf(players[2]));
    expect((await fresh.client.emitWithAck("room:reconnect-player", credentialsOf(players[2]))).ok).toBe(true);
    players[2].client.disconnect();
    await pause(100);
    // Before the fix, the old connection closing dropped the room below three players and cancelled the game.
    expect(players[0].lastState?.phase).toBe("ROLE_ASSIGNMENT");
    expect(players[0].lastState?.players.every((player) => player.connected)).toBe(true);
  });
});

describe("rooms that everyone has left are freed", () => {
  it("removes a finished room once the reconnect grace period passes with nobody back", async () => {
    const server = await startTestServer({ roomOptions: { reconnectGraceMs: 200 } });
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);

    for (const player of players) player.client.disconnect();
    await pause(500);
    const fresh = await connectClient(server.url);
    expect((await fresh.emitWithAck("room:reconnect-player", credentialsOf(players[0]))).ok).toBe(false);
  });

  it("keeps the room while someone is connected, and restarts the wait when a player comes back briefly", async () => {
    const server = await startTestServer({ roomOptions: { reconnectGraceMs: 400 } });
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);

    // Ana stays: the room must survive well past the grace period.
    players[1].client.disconnect();
    players[2].client.disconnect();
    await pause(600);
    expect((await players[0].client.emitWithAck("chat:history", {})).ok).toBe(true);
    expect(players[0].lastState?.phase).toBe("GAME_END");

    players[0].client.disconnect();
    await pause(250);
    const back = await connectClient(server.url);
    expect((await back.emitWithAck("room:reconnect-player", credentialsOf(players[0]))).ok).toBe(true);
    back.disconnect();
    // Past the first empty period's deadline, but inside the restarted one.
    await pause(250);
    const again = await connectClient(server.url);
    expect((await again.emitWithAck("room:reconnect-player", credentialsOf(players[0]))).ok).toBe(true);
    again.disconnect();
    await pause(700);
    const late = await connectClient(server.url);
    expect((await late.emitWithAck("room:reconnect-player", credentialsOf(players[0]))).ok).toBe(false);
  });
});

describe("lobby seats after leaving", () => {
  it("frees the seats of players who left the results screen once a rematch lobby opens", async () => {
    const server = await startTestServer({ roomOptions: { reconnectGraceMs: 200 } });
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy", "Dee"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await playGame(players, 1);

    players[3].client.disconnect();
    await until(() => players[0].lastState?.players.find((player) => player.name === "Dee")?.connected === false, "Dee leaving");
    expect(await players[0].client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    expect(players[0].lastState?.players).toHaveLength(4);
    await until(() => players[0].lastState?.players.length === 3, "Dee's seat being freed", 2_000);
    expect(players[0].lastState?.players.map((player) => player.name)).toEqual(["Ana", "Ben", "Cy"]);
  });

  it("gives a player who briefly came back a full grace period from their latest disconnect", async () => {
    const server = await startTestServer({ roomOptions: { reconnectGraceMs: 400 } });
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy", "Dee"]);
    const dee = players[3];
    const names = () => players[0].lastState?.players.map((player) => player.name);

    dee.client.disconnect();
    await pause(250);
    const back = await connectClient(server.url);
    expect((await back.emitWithAck("room:reconnect-player", credentialsOf(dee))).ok).toBe(true);
    back.disconnect();
    await pause(250);
    // The first disconnect's deadline has passed, but Dee left again only 250 ms ago.
    expect(names()).toContain("Dee");
    await until(() => !names()?.includes("Dee"), "Dee's seat being freed", 2_000);
  });
});

describe("removing a player during a game", () => {
  it("cancels the game when too few players remain, as a disconnect would", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await waitForPhase(players, "ROLE_ASSIGNMENT");

    expect(await players[0].client.emitWithAck("player:kick", { playerId: players[2].playerId })).toEqual({ ok: true });
    await until(() => players[0].lastState?.phase === "CANCELLED", "the cancellation");
    expect(players[0].lastState?.cancelledReason).toBe("Too few players remain to continue.");
  });

  it("moves on at once when everyone left has already given a clue", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy", "Dee"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false, clueSeconds: 120 });
    await until(() => players.every((player) => player.secrets.length === 1), "roles");
    for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
    await waitForPhase(players, "CLUE_PHASE");
    const staying = players.slice(0, 3);
    for (const [index, player] of staying.entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwx"[index]}k` })).toEqual({ ok: true });
    }

    expect(await players[0].client.emitWithAck("player:kick", { playerId: players[3].playerId })).toEqual({ ok: true });
    await waitForPhase(staying, "VOTING");
  });

  it("withdraws votes cast for the removed player so those voters can choose again", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy", "Dee"]);
    await readyAndStart(players, { rounds: 1, discussionEnabled: false });
    await reachVoting(players);
    const [ana, ben, cy, dee] = players;

    expect(await ben.client.emitWithAck("vote:submit", { targetPlayerId: dee.playerId })).toEqual({ ok: true });
    expect(await cy.client.emitWithAck("vote:submit", { targetPlayerId: ana.playerId })).toEqual({ ok: true });
    expect(await ana.client.emitWithAck("player:kick", { playerId: dee.playerId })).toEqual({ ok: true });
    await until(() => ana.lastState?.voteSubmittedCount === 1 && ana.lastState.voteEligibleCount === 3, "the withdrawn vote");
    expect(ana.lastState?.players.find((player) => player.name === "Ben")?.submittedVote).toBe(false);

    // Ben's vote was for Dee; it no longer counts, so Ben may vote again. Cy's vote stands.
    expect(await ben.client.emitWithAck("vote:submit", { targetPlayerId: cy.playerId })).toEqual({ ok: true });
    expect(await cy.client.emitWithAck("vote:submit", { targetPlayerId: ben.playerId })).toEqual({ ok: false, message: "Your vote is already locked." });
    expect(await ana.client.emitWithAck("vote:submit", { targetPlayerId: cy.playerId })).toEqual({ ok: true });
    await waitForPhase(players.slice(0, 3), "VOTE_RESULT");
  });
});
