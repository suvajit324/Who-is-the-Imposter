import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientToServerEvents, GamePhase, PrivateRole, PublicRoomState, RoundResult, ServerToClientEvents } from "@imposter/shared";
import { MAX_REJECTED_CLUE_ATTEMPTS, RoomManager } from "../src/domain/roomManager.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type Captured = { event: string; payload: unknown };
type Player = {
  name: string;
  client: TestClient;
  playerId: string;
  reconnectToken: string;
  secrets: PrivateRole[];
  /** Every server->client event except this player's own private role. */
  publicEvents: Captured[];
  lastState: PublicRoomState | null;
  results: RoundResult[];
};

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;
const openClients: TestClient[] = [];

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerHandlers(ioServer, new RoomManager(ioServer, { enabled: false, saveCompletedGame: async () => undefined }));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of openClients.splice(0)) client.disconnect();
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const compact = (word: string) => word.replace(/\s+/g, "");

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

function track(name: string, client: TestClient, playerId: string, reconnectToken: string): Player {
  const player: Player = { name, client, playerId, reconnectToken, secrets: [], publicEvents: [], lastState: null, results: [] };
  client.onAny((event: string, payload: unknown) => {
    if (event === "player:secret") player.secrets.push(payload as PrivateRole);
    else player.publicEvents.push({ event, payload });
    if (event === "room:state") player.lastState = payload as PublicRoomState;
    if (event === "round:result") player.results.push(payload as RoundResult);
  });
  return player;
}

function waitForPhase(player: Player, phase: GamePhase, timeoutMs = 4_000): Promise<void> {
  if (player.lastState?.phase === phase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${player.name} never reached ${phase}`)), timeoutMs);
    const onState = (state: PublicRoomState) => {
      if (state.phase !== phase) return;
      clearTimeout(timer);
      player.client.off("room:state", onState);
      resolve();
    };
    player.client.on("room:state", onState);
  });
}

async function createRoomWith(names: string[]) {
  const [hostName, ...guestNames] = names;
  const hostClient = await connectClient();
  const created = await hostClient.emitWithAck("room:create", { playerName: hostName });
  if (!created.ok) throw new Error(created.message);
  const players = [track(hostName, hostClient, created.playerId, created.reconnectToken)];
  for (const name of guestNames) {
    const client = await connectClient();
    const joined = await client.emitWithAck("room:join", { roomCode: created.roomCode, playerName: name });
    if (!joined.ok) throw new Error(joined.message);
    players.push(track(name, client, joined.playerId, joined.reconnectToken));
  }
  return { roomCode: created.roomCode, players };
}

async function startGame(players: Player[], settings: Record<string, unknown> = {}) {
  const [host, ...guests] = players;
  expect(await host.client.emitWithAck("settings:update", { discussionSeconds: 300, ...settings })).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
  await pause(40);
  const imposter = players.find((player) => player.secrets.at(-1)?.role === "Imposter")!;
  const normals = players.filter((player) => player !== imposter);
  return { imposter, normals, mainWord: normals[0].secrets.at(-1)!.word, imposterWord: imposter.secrets.at(-1)!.word };
}

async function ackRoles(players: Player[]) {
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await Promise.all(players.map((player) => waitForPhase(player, "CLUE_PHASE")));
}

/** Asserts that none of the captured public payloads mention any of the given secret words. */
function expectNoLeak(players: Player[], words: string[], label: string) {
  for (const player of players) {
    const wire = JSON.stringify(player.publicEvents).toLowerCase();
    for (const word of words) expect(wire.includes(`"${word.toLowerCase()}"`), `${label}: "${word}" leaked to ${player.name}`).toBe(false);
  }
}

describe("secret word and role confidentiality", () => {
  it("sends each player only their own role, and never puts secret words in broadcasts during play", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const { imposter, normals, mainWord, imposterWord } = await startGame(players);

    for (const player of players) {
      expect(player.secrets).toHaveLength(1);
      expect(player.secrets[0].playerId).toBe(player.playerId);
    }
    expect(players.filter((player) => player.secrets[0].role === "Imposter")).toHaveLength(1);
    for (const normal of normals) expect(normal.secrets[0].word).toBe(mainWord);
    expect(imposter.secrets[0].word).toBe(imposterWord);
    expect(mainWord).not.toBe(imposterWord);

    await ackRoles(players);
    for (const [index, player] of players.entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxy"[index]}k` })).toEqual({ ok: true });
    }
    await Promise.all(players.map((player) => waitForPhase(player, "DISCUSSION")));
    expect((await players[1].client.emitWithAck("chat:send", { text: "who is it?", clientMessageId: "sec-test-0001" })).ok).toBe(true);
    await pause(30);

    // Nothing public (room:state, chat, errors) carries either secret word or the Imposter's identity.
    expectNoLeak(players, [mainWord, imposterWord], "active round");
    for (const player of players) {
      const wire = JSON.stringify(player.publicEvents);
      expect(wire).not.toContain("imposterId");
      expect(wire).not.toContain('"role"');
      expect(player.lastState?.latestResult).toBeNull();
    }
  });

  it("does not let anyone predict the Imposter from public player ids", async () => {
    let imposterWasLowestId = 0;
    const seenSeats = new Set<number>();
    const games = 18;
    for (let game = 0; game < games; game += 1) {
      const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
      const { imposter } = await startGame(players);
      const publicIds = players[0].lastState!.players.map((player) => player.id);
      const lowestId = [...publicIds].sort((a, b) => a.localeCompare(b))[0];
      if (imposter.playerId === lowestId) imposterWasLowestId += 1;
      seenSeats.add(players.indexOf(imposter));
      for (const player of players) player.client.disconnect();
    }
    // Previously the Imposter was *always* the lexicographically smallest id (18/18).
    // With a fair random draw P(18/18) = (1/3)^18, effectively impossible.
    expect(imposterWasLowestId).toBeLessThan(games);
    expect(seenSeats.size).toBeGreaterThan(1);
  });

  it("hides other players' clue text until the clue phase ends", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b, c] = players;
    await startGame(players);
    await ackRoles(players);

    expect(await a.client.emitWithAck("clue:submit", { clue: "zorpq" })).toEqual({ ok: true });
    await pause(30);
    const midPhase = b.lastState!;
    expect(midPhase.phase).toBe("CLUE_PHASE");
    expect(midPhase.clues.every((clue) => clue.clue === null)).toBe(true);
    expect(midPhase.players.find((player) => player.id === a.playerId)?.submittedClue).toBe(true);
    expect(JSON.stringify(b.publicEvents)).not.toContain("zorpq");
    expect(JSON.stringify(c.publicEvents)).not.toContain("zorpq");

    expect(await b.client.emitWithAck("clue:submit", { clue: "blimx" })).toEqual({ ok: true });
    expect(await c.client.emitWithAck("clue:submit", { clue: "quvex" })).toEqual({ ok: true });
    await waitForPhase(b, "DISCUSSION");
    expect(b.lastState!.clues.map((clue) => clue.clue).sort()).toEqual(["blimx", "quvex", "zorpq"]);
  });
});

describe("guessing oracles", () => {
  it("clue validation reveals nothing about the other secret word", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const { imposter, normals, mainWord, imposterWord } = await startGame(players);
    await ackRoles(players);

    // Each player's own word is rejected with the same generic message, whatever their role.
    const ownWordImposter = await imposter.client.emitWithAck("clue:submit", { clue: compact(imposterWord) });
    const ownWordNormal = await normals[0].client.emitWithAck("clue:submit", { clue: compact(mainWord) });
    expect(ownWordImposter).toEqual({ ok: false, message: "Your clue cannot be the secret word." });
    expect(ownWordNormal).toEqual(ownWordImposter);

    // Previously, the Imposter typing the main word got "cannot be the secret word" (confirming it)
    // while any other word was accepted. Now the main word is just an ordinary clue for them,
    // exactly like any wrong guess, so rejection can no longer confirm a guess.
    expect(await imposter.client.emitWithAck("clue:submit", { clue: compact(mainWord) })).toEqual({ ok: true });
    expect(await normals[1].client.emitWithAck("clue:submit", { clue: compact(imposterWord) })).toEqual({ ok: true });
  });

  it("caps rejected clue attempts so validation errors cannot be used for unlimited probing", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const { normals, mainWord } = await startGame(players);
    await ackRoles(players);
    const prober = normals[0];
    for (let attempt = 0; attempt < MAX_REJECTED_CLUE_ATTEMPTS; attempt += 1) {
      expect((await prober.client.emitWithAck("clue:submit", { clue: compact(mainWord) })).ok).toBe(false);
    }
    expect(await prober.client.emitWithAck("clue:submit", { clue: "harmless" })).toEqual({ ok: false, message: "Too many invalid clue attempts this round." });
    // Other players are unaffected.
    expect(await normals[1].client.emitWithAck("clue:submit", { clue: "harmless" })).toEqual({ ok: true });
  });

  it("withholds the main word from the result while a caught Imposter can still guess it", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const { imposter, normals, mainWord, imposterWord } = await startGame(players, { discussionEnabled: false });
    await ackRoles(players);
    for (const [index, player] of players.entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwx"[index]}k` })).toEqual({ ok: true });
    }
    await Promise.all(players.map((player) => waitForPhase(player, "VOTING")));
    for (const normal of normals) expect(await normal.client.emitWithAck("vote:submit", { targetPlayerId: imposter.playerId })).toEqual({ ok: true });
    expect(await imposter.client.emitWithAck("vote:submit", { targetPlayerId: normals[0].playerId })).toEqual({ ok: true });
    await waitForPhase(imposter, "VOTE_RESULT");
    await pause(30);

    expect(imposter.lastState!.latestResult).toMatchObject({ correct: true, mainWord: null, imposterWord });
    expect(imposter.results.at(-1)).toMatchObject({ mainWord: null });
    expect(imposter.lastState!.roundHistory.at(-1)?.mainWord).toBeNull();
    expectNoLeak([imposter], [mainWord], "pending imposter guess");

    expect(await imposter.client.emitWithAck("imposter:guess", { guess: "definitely-wrong" })).toEqual({ ok: true });
    await pause(30);
    expect(imposter.lastState!.latestResult).toMatchObject({ mainWord, imposterGuess: "definitely-wrong", imposterGuessCorrect: false });
    expect(imposter.results.at(-1)?.mainWord).toBe(mainWord);
  });

  it("reveals the main word immediately when the Imposter escapes", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const { imposter, normals, mainWord } = await startGame(players, { discussionEnabled: false });
    await ackRoles(players);
    for (const [index, player] of players.entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwx"[index]}k` })).toEqual({ ok: true });
    }
    await Promise.all(players.map((player) => waitForPhase(player, "VOTING")));
    // Normals split onto each other, so no one is selected (or a normal is): the Imposter escapes.
    expect(await normals[0].client.emitWithAck("vote:submit", { targetPlayerId: normals[1].playerId })).toEqual({ ok: true });
    expect(await normals[1].client.emitWithAck("vote:submit", { targetPlayerId: normals[0].playerId })).toEqual({ ok: true });
    expect(await imposter.client.emitWithAck("vote:submit", { targetPlayerId: normals[0].playerId })).toEqual({ ok: true });
    await waitForPhase(imposter, "VOTE_RESULT");
    expect(imposter.lastState!.latestResult).toMatchObject({ correct: false, mainWord });
  });
});

describe("server robustness against tampered clients", () => {
  it("survives malformed payloads and events sent without an ack callback", async () => {
    const attacker = await connectClient();
    const raw = attacker as unknown as { emit: (event: string, ...args: unknown[]) => void };
    const events = [
      "room:create", "room:join", "room:reconnect-player", "player:ready", "settings:update", "player:kick", "game:start",
      "role:ack", "clue:submit", "vote:submit", "imposter:guess", "game:next-round", "game:rematch", "chat:send", "chat:history"
    ];
    const created = await attacker.emitWithAck("room:create", { playerName: "Mallory" });
    expect(created.ok).toBe(true);
    for (const event of events) {
      raw.emit(event); // no payload, no ack
      raw.emit(event, null); // null payload, no ack
      raw.emit(event, { ready: "yes", playerId: 42, text: { nested: true } }); // wrong types, no ack
      for (const payload of [null, undefined, 7, "x", [], { playerId: null }]) {
        const response = await (attacker.timeout(2_000).emitWithAck as (e: string, p: unknown) => Promise<{ ok: boolean }>)(event, payload);
        expect(response).toHaveProperty("ok");
      }
    }
    // The server is still up and serving everyone.
    const probe = await connectClient();
    expect((await probe.emitWithAck("room:create", { playerName: "Still alive" })).ok).toBe(true);
  });

  it("rejects category/difficulty combinations with no word pairs instead of crashing", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [host, ...guests] = players;
    for (const guest of guests) await guest.client.emitWithAck("player:ready", { ready: true });
    expect(await host.client.emitWithAck("settings:update", { categories: ["Food"], difficulty: "Hard" })).toEqual({ ok: true });
    expect(await host.client.emitWithAck("game:start", {})).toEqual({
      ok: false,
      message: "No word pairs match this category and difficulty. Choose a different combination."
    });
    await pause(20);
    expect(host.lastState).toMatchObject({ phase: "LOBBY", roundNumber: 0 });
    expect(await host.client.emitWithAck("settings:update", { difficulty: "Easy" })).toEqual({ ok: true });
    expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
  });

  it("does not let the host wipe a game in progress with a forged rematch", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    await startGame(players);
    expect(await players[0].client.emitWithAck("game:rematch", {})).toEqual({ ok: false, message: "A rematch can only start after the game ends." });
    await pause(20);
    expect(players[1].lastState?.phase).toBe("ROLE_ASSIGNMENT");
  });

  it("enforces turn rules on the server regardless of the UI", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [host, b] = players;
    const { imposter, normals } = await startGame(players);
    expect(await b.client.emitWithAck("game:next-round", {})).toMatchObject({ ok: false });
    expect(await b.client.emitWithAck("vote:submit", { targetPlayerId: host.playerId })).toEqual({ ok: false, message: "Voting is not open." });
    expect(await normals[0].client.emitWithAck("imposter:guess", { guess: "pizza" })).toMatchObject({ ok: false });
    expect(await imposter.client.emitWithAck("imposter:guess", { guess: "pizza" })).toMatchObject({ ok: false });
    expect(await b.client.emitWithAck("settings:update", { rounds: 10 })).toMatchObject({ ok: false });
  });
});

describe("room and membership isolation", () => {
  it("never delivers one room's private data to another room", async () => {
    const room1 = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const room2 = await createRoomWith(["Dev", "Esha", "Farhan"]);
    const game1 = await startGame(room1.players);
    await startGame(room2.players);
    expectNoLeak(room2.players, [game1.mainWord, game1.imposterWord].filter((word) => {
      // Only meaningful when the rooms drew different words.
      return !room2.players.some((player) => player.secrets[0].word === word);
    }), "cross-room");
    for (const player of room2.players) {
      expect(JSON.stringify(player.publicEvents)).not.toContain(room1.roomCode);
      expect(player.secrets.every((secret) => secret.roomCode === room2.roomCode)).toBe(true);
    }
    // Acting on another room's player ids fails: votes target only your own room's players.
    await ackRoles(room2.players);
    expect(await room2.players[0].client.emitWithAck("player:kick", { playerId: room1.players[1].playerId })).toEqual({ ok: false, message: "Player not found." });
  });

  it("rejects reconnecting as another player and gives an identical error for every failure", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b] = players;
    const thief = await connectClient();
    const wrongToken = await thief.emitWithAck("room:reconnect-player", { roomCode, playerId: a.playerId, reconnectToken: b.reconnectToken });
    const wrongPlayer = await thief.emitWithAck("room:reconnect-player", { roomCode, playerId: "00000000-0000-4000-8000-000000000000", reconnectToken: a.reconnectToken });
    const wrongRoom = await thief.emitWithAck("room:reconnect-player", { roomCode: "ZZZZZZ", playerId: a.playerId, reconnectToken: a.reconnectToken });
    expect(wrongToken.ok).toBe(false);
    expect(wrongPlayer).toEqual(wrongToken);
    expect(wrongRoom).toEqual(wrongToken);
    expect(await thief.emitWithAck("chat:history", {})).toMatchObject({ ok: false });
  });

  it("cuts a kicked player off from all further room data and actions", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const [host, , , kicked] = players;
    expect(await host.client.emitWithAck("player:kick", { playerId: kicked.playerId })).toEqual({ ok: true });
    await pause(30);
    const seenBefore = kicked.publicEvents.length;
    await startGame(players.slice(0, 3));
    await pause(30);
    expect(kicked.secrets).toHaveLength(0);
    expect(kicked.publicEvents.length).toBe(seenBefore);
    expect(await kicked.client.emitWithAck("role:ack", {})).toEqual({ ok: false, message: "Join a room first." });
    expect(await kicked.client.emitWithAck("chat:history", {})).toMatchObject({ ok: false });
    const fresh = await connectClient();
    expect((await fresh.emitWithAck("room:reconnect-player", { roomCode, playerId: kicked.playerId, reconnectToken: kicked.reconnectToken })).ok).toBe(false);
  });

  it("stops sending room data to a disconnected player's old socket and resends only their own role on reconnect", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const { imposter, normals } = await startGame(players);
    const leaver = normals[0];
    leaver.client.disconnect();
    await pause(30);
    const freshClient = await connectClient();
    const rejoined = track(leaver.name, freshClient, leaver.playerId, leaver.reconnectToken);
    expect((await freshClient.emitWithAck("room:reconnect-player", { roomCode, playerId: leaver.playerId, reconnectToken: leaver.reconnectToken })).ok).toBe(true);
    await pause(30);
    expect(rejoined.secrets).toHaveLength(1);
    expect(rejoined.secrets[0]).toMatchObject({ playerId: leaver.playerId, role: "Normal" });
    expectNoLeak([rejoined], [imposter.secrets[0].word], "reconnect");
  });
});
