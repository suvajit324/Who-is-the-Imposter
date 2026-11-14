import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, ClientToServerEvents, PrivateRole, PublicRoomState, ServerToClientEvents, WordCategory } from "@imposter/shared";
import type { WordPair } from "../src/data/wordBank.js";
import { RoomManager } from "../src/domain/roomManager.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

/**
 * End-to-end moderation through real sockets. A tiny custom word bank (one pair per
 * category) makes each room's words deterministic, while the Imposter is still chosen
 * by the server: tests discover roles only from each player's private `player:secret`.
 */
type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;
type Player = { name: string; client: TestClient; playerId: string; reconnectToken: string; chat: ChatMessage[]; secret: PrivateRole | null; lastState: PublicRoomState | null; events: string[] };

const testBank: WordPair[] = [
  { id: "t-animals", wordA: "Lion", wordB: "Tiger", category: "Animals", difficulty: "Easy", tags: [] },
  { id: "t-food", wordA: "Pizza", wordB: "Burger", category: "Food", difficulty: "Easy", tags: [] }
];

const SECRET_MSG = "Your message may reveal secret information. Please rephrase it.";
const HINT_MSG = "Giving hints about letters, spelling or word meaning is not allowed.";
const ABUSE_MSG = "Please keep the conversation respectful.";
const FINAL_WARNING = `${SECRET_MSG} Further violations will temporarily restrict your chat.`;
const RESTRICTED = "Your chat is temporarily restricted for 30 seconds because of repeated violations.";

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;
const openClients: TestClient[] = [];
let idCounter = 0;

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  registerHandlers(ioServer, new RoomManager(ioServer, { enabled: false, saveCompletedGame: async () => undefined }, testBank));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of openClients.splice(0)) client.disconnect();
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextId = () => `mod-msg-${(idCounter += 1).toString().padStart(5, "0")}`;

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

function track(name: string, client: TestClient, playerId: string, reconnectToken: string, existing?: Player): Player {
  const player: Player = existing ?? { name, client, playerId, reconnectToken, chat: [], secret: null, lastState: null, events: [] };
  player.client = client;
  client.on("chat:message", (message) => player.chat.push(message));
  client.on("player:secret", (secret) => { player.secret = secret; });
  client.on("room:state", (state) => { player.lastState = state; });
  // Record every event payload so we can assert nothing moderation-related is ever broadcast.
  client.onAny((event, ...args) => player.events.push(`${event} ${JSON.stringify(args)}`));
  return player;
}

function waitForPhase(player: Player, phase: PublicRoomState["phase"]): Promise<void> {
  if (player.lastState?.phase === phase) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${player.name} never reached ${phase}`)), 15_000);
    const onState = (state: PublicRoomState) => {
      if (state.phase !== phase) return;
      clearTimeout(timer);
      player.client.off("room:state", onState);
      resolve();
    };
    player.client.on("room:state", onState);
  });
}

const atPhase = (players: Player[], phase: PublicRoomState["phase"]) => Promise.all(players.map((player) => waitForPhase(player, phase)));

/** Creates a room for the given category, plays to the discussion phase and returns players with their roles. */
async function roomInDiscussion(names: string[], category: WordCategory) {
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
  const [host, ...guests] = players;
  expect(await host.client.emitWithAck("settings:update", { categories: [category], difficulty: "Any", rounds: 1, discussionSeconds: 120, votingSeconds: 30 })).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
  await atPhase(players, "ROLE_ASSIGNMENT");
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await atPhase(players, "CLUE_PHASE");
  for (const [index, player] of players.entries()) expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxyz"[index]}k` })).toEqual({ ok: true });
  await atPhase(players, "DISCUSSION");
  const imposter = players.find((player) => player.secret?.role === "Imposter")!;
  const normals = players.filter((player) => player !== imposter);
  return { roomCode: created.roomCode, players, imposter, normals };
}

/** Sends with a pause first so the ordinary chat rate limit never interferes. */
async function send(player: Player, text: string, clientMessageId = nextId()) {
  await pause(450);
  return player.client.emitWithAck("chat:send", { text, clientMessageId });
}

const delivered = (players: Player[], text: string) => players.every((player) => player.chat.some((message) => message.text === text));
const seenAnywhere = (players: Player[], fragment: string) => players.some((player) => player.events.some((event) => event.toLowerCase().includes(fragment.toLowerCase())));

describe("chat moderation over sockets", () => {
  it("blocks each player's own secret word before broadcast, with identical feedback for both roles", async () => {
    const { players, imposter, normals } = await roomInDiscussion(["Asha", "Bala", "Chirag"], "Animals");
    const normalWord = normals[0].secret!.word;
    const imposterWord = imposter.secret!.word;
    expect(new Set([normalWord, imposterWord])).toEqual(new Set(["Lion", "Tiger"]));

    const historyBefore = await players[0].client.emitWithAck("chat:history", {});
    expect(await send(normals[0], `my word is ${normalWord.toUpperCase()}`)).toEqual({ ok: false, message: SECRET_MSG });
    expect(await send(imposter, imposterWord.split("").join(" "))).toEqual({ ok: false, message: SECRET_MSG });
    expect(await send(normals[1], `it starts with ${normalWord[0]}`)).toEqual({ ok: false, message: HINT_MSG });
    await pause(200);

    // Nothing was stored or broadcast, and no client ever saw a moderation reason or the blocked text.
    expect(await players[0].client.emitWithAck("chat:history", {})).toEqual(historyBefore);
    expect(seenAnywhere(players, "my word is")).toBe(false);
    expect(seenAnywhere(players, "BLOCK_")).toBe(false);
    expect(seenAnywhere(players, "REVIEW_")).toBe(false);

    // Ordinary discussion still works.
    expect(await send(normals[0], "I think Bala is acting sus")).toMatchObject({ ok: true });
    await pause(200);
    expect(delivered(players, "I think Bala is acting sus")).toBe(true);
  });

  it("is not a guessing oracle: typing a word you do not know is delivered like any other message", async () => {
    const { players, imposter, normals } = await roomInDiscussion(["Asha", "Bala", "Chirag"], "Animals");
    const normalWord = normals[0].secret!.word;
    const imposterWord = imposter.secret!.word;

    // The Imposter probing for the main word, and a normal player probing for the Imposter's word,
    // both get an ordinary delivery: the verdict depends only on the sender's own word.
    expect(await send(imposter, `is it ${normalWord.toLowerCase()}?`)).toMatchObject({ ok: true });
    expect(await send(normals[0], `maybe the other word is ${imposterWord.toLowerCase()}`)).toMatchObject({ ok: true });
    await pause(200);
    expect(delivered(players, `is it ${normalWord.toLowerCase()}?`)).toBe(true);
    // Probing with letter/length claims is withheld whether or not the claim is true for anyone.
    expect(await send(imposter, "it starts with a q")).toEqual({ ok: false, message: HINT_MSG });
    expect(await send(normals[1], "it starts with a q")).toEqual({ ok: false, message: HINT_MSG });
  });

  it("blocks abusive messages for everyone", async () => {
    const { players } = await roomInDiscussion(["Asha", "Bala", "Chirag"], "Animals");
    expect(await send(players[0], "you idiot")).toEqual({ ok: false, message: ABUSE_MSG });
    expect(await send(players[1], "f u c k this")).toEqual({ ok: false, message: ABUSE_MSG });
    expect(await send(players[2], "madarchod")).toEqual({ ok: false, message: ABUSE_MSG });
    await pause(200);
    expect(players.every((player) => player.chat.every((message) => message.kind === "system"))).toBe(true);
  });

  it("escalates warnings to a temporary restriction that survives a reconnect, and replays a retried message without double counting", async () => {
    // Four players, so one disconnect does not drop the game below the minimum player count.
    const { roomCode, players, normals } = await roomInDiscussion(["Asha", "Bala", "Chirag", "Dev"], "Animals");
    const offender = normals[0];
    const word = offender.secret!.word;

    const firstId = nextId();
    expect(await send(offender, word, firstId)).toEqual({ ok: false, message: SECRET_MSG });
    // A network retry of the same submission returns the same answer and is not a new violation.
    expect(await send(offender, word, firstId)).toEqual({ ok: false, message: SECRET_MSG });
    expect(await send(offender, `${word}!!`)).toEqual({ ok: false, message: FINAL_WARNING });

    // Reconnecting on a fresh socket does not reset the count (it is keyed by the server-side player id).
    offender.client.disconnect();
    await pause(300);
    const fresh = await connectClient();
    const rejoined = await fresh.emitWithAck("room:reconnect-player", { roomCode, playerId: offender.playerId, reconnectToken: offender.reconnectToken });
    expect(rejoined).toMatchObject({ ok: true });
    track(offender.name, fresh, offender.playerId, offender.reconnectToken, offender);
    expect(offender.lastState?.phase ?? "DISCUSSION").toBe("DISCUSSION");

    expect(await send(offender, word.split("").join("."))).toEqual({ ok: false, message: RESTRICTED });
    const restricted = await send(offender, "ok sorry, I'll behave");
    expect(restricted.ok).toBe(false);
    expect(restricted.ok === false && restricted.message).toMatch(/^Your chat is temporarily restricted\. Try again in \d+ seconds\.$/);

    // Other players are unaffected.
    const other = players.find((player) => player !== offender)!;
    expect(await send(other, "let's keep going")).toMatchObject({ ok: true });
  });

  it("keeps rooms isolated: each room is moderated against its own words and violations do not cross rooms", async () => {
    const animals = await roomInDiscussion(["Asha", "Bala", "Chirag"], "Animals");
    const food = await roomInDiscussion(["Dev", "Esha", "Farhan"], "Food");
    const animalWord = animals.normals[0].secret!.word;
    const foodWord = food.normals[0].secret!.word;
    expect(["Pizza", "Burger"]).toContain(foodWord);

    expect(await send(animals.normals[0], animalWord)).toEqual({ ok: false, message: SECRET_MSG });
    // The animal word is meaningless in the food room and is delivered there.
    expect(await send(food.normals[0], `${animalWord.toLowerCase()} would be a fun word`)).toMatchObject({ ok: true });
    expect(await send(food.normals[1], foodWord)).toEqual({ ok: false, message: SECRET_MSG });
    await pause(200);
    expect(animals.players.some((player) => player.chat.some((message) => message.text.includes("fun word")))).toBe(false);
  });
});
