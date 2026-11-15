import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientToServerEvents, GamePhase, GameSettings, PrivateRole, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
import type { WordPair } from "../src/data/wordBank.js";
import { RoomManager } from "../src/domain/roomManager.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

/**
 * Word selection and distribution over real sockets. Each test runs its own server with a
 * small injected word bank, so the pairs a room can be dealt are known in advance.
 */

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type Player = {
  name: string;
  client: TestClient;
  playerId: string;
  secrets: PrivateRole[];
  /** Every server->client event this player received, including their own private role. */
  events: Array<{ event: string; payload: unknown }>;
  lastState: PublicRoomState | null;
};

let httpServer: HttpServer | null = null;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
let url = "";
const openClients: TestClient[] = [];

async function startServer(wordBank: WordPair[]) {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerHandlers(ioServer, new RoomManager(ioServer, { enabled: false, saveCompletedGame: async () => undefined }, wordBank));
  await new Promise<void>((resolve) => httpServer!.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const client of openClients.splice(0)) client.disconnect();
  ioServer?.close();
  const server = httpServer;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  ioServer = null;
  httpServer = null;
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pairKey = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join("|");

function pair(id: string, wordA: string, wordB: string, category: WordPair["category"], difficulty: WordPair["difficulty"]): WordPair {
  return { id, wordA, wordB, category, difficulty, tags: ["test"] };
}

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

function track(name: string, client: TestClient, playerId: string): Player {
  const player: Player = { name, client, playerId, secrets: [], events: [], lastState: null };
  client.onAny((event: string, payload: unknown) => {
    player.events.push({ event, payload });
    if (event === "player:secret") player.secrets.push(payload as PrivateRole);
    if (event === "room:state") player.lastState = payload as PublicRoomState;
  });
  return player;
}

async function until(condition: () => boolean, label: string, timeoutMs = 5_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await pause(10);
  }
}

const waitForPhase = (players: Player[], phase: GamePhase) =>
  until(() => players.every((player) => player.lastState?.phase === phase), `phase ${phase}`);

async function createRoomWith(names: string[]) {
  const [hostName, ...guestNames] = names;
  const hostClient = await connectClient();
  const created = await hostClient.emitWithAck("room:create", { playerName: hostName });
  if (!created.ok) throw new Error(created.message);
  const players = [track(hostName, hostClient, created.playerId)];
  for (const name of guestNames) {
    const client = await connectClient();
    const joined = await client.emitWithAck("room:join", { roomCode: created.roomCode, playerName: name });
    if (!joined.ok) throw new Error(joined.message);
    players.push(track(name, client, joined.playerId));
  }
  return players;
}

async function readyAndStart(players: Player[], settings: Partial<GameSettings> = {}) {
  const [host, ...guests] = players;
  if (Object.keys(settings).length > 0) expect(await host.client.emitWithAck("settings:update", settings)).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
}

/** Plays the current round to its result (discussion disabled) and returns the words that were dealt. */
async function playRound(players: Player[], secretsSoFar: number) {
  await until(() => players.every((player) => player.secrets.length === secretsSoFar + 1), "this round's roles");
  await waitForPhase(players, "ROLE_ASSIGNMENT");
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await waitForPhase(players, "CLUE_PHASE");
  for (const [index, player] of players.entries()) {
    expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxy"[index]}k` })).toEqual({ ok: true });
  }
  await waitForPhase(players, "VOTING");
  const imposter = players.find((player) => player.secrets.at(-1)?.role === "Imposter")!;
  const normals = players.filter((player) => player !== imposter);
  for (const normal of normals) expect(await normal.client.emitWithAck("vote:submit", { targetPlayerId: imposter.playerId })).toEqual({ ok: true });
  expect(await imposter.client.emitWithAck("vote:submit", { targetPlayerId: normals[0].playerId })).toEqual({ ok: true });
  await waitForPhase(players, "VOTE_RESULT");
  return { mainWord: normals[0].secrets.at(-1)!.word, imposterWord: imposter.secrets.at(-1)!.word };
}

describe("word selection over sockets", () => {
  it("rejects category/difficulty combinations with no playable pairs instead of crashing", async () => {
    await startServer([
      pair("food-easy", "Pizza", "Burger", "Food", "Easy"),
      // Malformed (identical words): must not count as a Food/Hard pair.
      pair("food-hard-broken", "Honey", "HONEY", "Food", "Hard")
    ]);
    const players = await createRoomWith(["Asha", "Bala", "Chirag"]);
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

  it("deals a different pair every round, and does not replay the last pair after a rematch", async () => {
    const foodEasy = [
      pair("food-1", "Pizza", "Burger", "Food", "Easy"),
      pair("food-2", "Sushi", "Taco", "Food", "Easy"),
      pair("food-3", "Soup", "Salad", "Food", "Easy")
    ];
    await startServer([
      ...foodEasy,
      pair("food-broken", "Tea", "tea", "Food", "Easy"),
      pair("animals-1", "Lion", "Tiger", "Animals", "Easy")
    ]);
    const validKeys = new Set(foodEasy.map((entry) => pairKey(entry.wordA, entry.wordB)));
    const players = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const host = players[0];
    await readyAndStart(players, { categories: ["Food"], difficulty: "Easy", rounds: 3, discussionEnabled: false });

    const dealt: string[] = [];
    for (let round = 0; round < 3; round += 1) {
      const { mainWord, imposterWord } = await playRound(players, round);
      expect(mainWord).not.toBe(imposterWord);
      dealt.push(pairKey(mainWord, imposterWord));
      expect(await host.client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
    }
    await waitForPhase(players, "GAME_END");
    expect(dealt.every((key) => validKeys.has(key))).toBe(true);
    expect(new Set(dealt).size).toBe(3);

    // A rematch is a new game for the same group: the pair they just played is held back.
    expect(await host.client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await waitForPhase(players, "LOBBY");
    await readyAndStart(players);
    const { mainWord, imposterWord } = await playRound(players, 3);
    const next = pairKey(mainWord, imposterWord);
    expect(next).not.toBe(dealt[2]);
    expect([dealt[0], dealt[1]]).toContain(next);
  });

  it("sends each player only their own word; the other word and the pair's metadata stay on the server", async () => {
    const secretPair: WordPair = { id: "pair-id-7f3a91", wordA: "Narwhal", wordB: "Platypus", category: "Animals", difficulty: "Hard", tags: ["metadata-tag-c41e"] };
    await startServer([secretPair]);
    const players = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    await readyAndStart(players, { categories: ["Animals"], difficulty: "Any", rounds: 1, discussionEnabled: true, discussionSeconds: 1 });

    await until(() => players.every((player) => player.secrets.length === 1), "roles");
    await waitForPhase(players, "ROLE_ASSIGNMENT");
    for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
    await waitForPhase(players, "CLUE_PHASE");
    for (const [index, player] of players.entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxy"[index]}k` })).toEqual({ ok: true });
    }
    await waitForPhase(players, "DISCUSSION");
    expect((await players[1].client.emitWithAck("chat:send", { text: "who is it?", clientMessageId: "word-leak-0001" })).ok).toBe(true);
    await waitForPhase(players, "VOTING");
    await pause(30);

    const imposter = players.find((player) => player.secrets[0].role === "Imposter")!;
    const normals = players.filter((player) => player !== imposter);
    const mainWord = normals[0].secrets[0].word;
    const imposterWord = imposter.secrets[0].word;
    expect([mainWord, imposterWord].sort()).toEqual(["Narwhal", "Platypus"]);

    for (const player of players) {
      // Exactly one private role, addressed to this player, carrying only their own word.
      expect(player.secrets).toHaveLength(1);
      expect(player.secrets[0]).toMatchObject({ playerId: player.playerId, word: player === imposter ? imposterWord : mainWord });

      // Nothing this player received (public or private) mentions the word they must not know,
      // or any of the pair's server-side metadata.
      const wire = JSON.stringify(player.events);
      const hiddenWord = player === imposter ? mainWord : imposterWord;
      expect(wire.toLowerCase(), `${player.name} saw the hidden word`).not.toContain(hiddenWord.toLowerCase());
      for (const metadata of [secretPair.id, ...secretPair.tags, '"pair"', '"wordA"', '"wordB"', '"Hard"']) {
        expect(wire, `${player.name} saw ${metadata}`).not.toContain(metadata);
      }
    }
  });
});
