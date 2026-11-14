import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatHistory, ChatMessage, ClientToServerEvents, GamePhase, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
import { RoomManager } from "../src/domain/roomManager.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

type Player = {
  name: string;
  client: TestClient;
  playerId: string;
  reconnectToken: string;
  chat: ChatMessage[];
  histories: ChatHistory[];
  lastState: PublicRoomState | null;
  secretWord: string | null;
};

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;
const openClients: TestClient[] = [];
let idCounter = 0;

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  const persistence = { enabled: false, saveCompletedGame: async () => undefined };
  registerHandlers(ioServer, new RoomManager(ioServer, persistence));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const client of openClients.splice(0)) client.disconnect();
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextId = () => `test-client-msg-${(idCounter += 1).toString().padStart(4, "0")}`;

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

function track(name: string, client: TestClient, playerId: string, reconnectToken: string): Player {
  const player: Player = { name, client, playerId, reconnectToken, chat: [], histories: [], lastState: null, secretWord: null };
  client.on("player:secret", (secret) => { player.secretWord = secret.word; });
  client.on("chat:message", (message) => player.chat.push(message));
  client.on("chat:history", (history) => player.histories.push(history));
  client.on("room:state", (state) => { player.lastState = state; });
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

async function createRoomWith(names: string[]): Promise<{ roomCode: string; players: Player[] }> {
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

/** Plays a room through role reveal and clues into the DISCUSSION phase. */
async function reachDiscussion(players: Player[], discussionSeconds: number, rounds = 3) {
  const [host, ...guests] = players;
  expect(await host.client.emitWithAck("settings:update", { discussionSeconds, rounds })).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  const clues = ["qwzx", "vbnk", "plmj", "rtyg", "hjkf"];
  for (const [index, player] of players.entries()) {
    expect(await player.client.emitWithAck("clue:submit", { clue: clues[index] })).toEqual({ ok: true });
  }
  await Promise.all(players.map((player) => waitForPhase(player, "DISCUSSION")));
}

describe("room discussion chat over sockets", () => {
  it("delivers messages in real time, in order, exactly once, to all three players", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b, c] = players;
    await reachDiscussion(players, 300);
    await pause(30);

    const sent1 = await a.client.emitWithAck("chat:send", { text: "  I think Bala's clue was odd  ", clientMessageId: nextId() });
    const sent2 = await b.client.emitWithAck("chat:send", { text: "No way, it fits!", clientMessageId: nextId() });
    const sent3 = await c.client.emitWithAck("chat:send", { text: "Hmm 🤔", clientMessageId: nextId() });
    expect(sent1).toMatchObject({ ok: true, chatMessage: { playerName: "Asha", text: "I think Bala's clue was odd", kind: "player" } });
    expect(sent2.ok && sent3.ok).toBe(true);
    await pause(50);

    for (const player of players) {
      const playerMessages = player.chat.filter((message) => message.kind === "player");
      expect(playerMessages.map((message) => `${message.playerName}: ${message.text}`)).toEqual([
        "Asha: I think Bala's clue was odd",
        "Bala: No way, it fits!",
        "Chirag: Hmm 🤔"
      ]);
      const seqs = player.chat.map((message) => message.seq);
      expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
      expect(new Set(player.chat.map((message) => message.id)).size).toBe(player.chat.length);
    }
    expect(a.chat.some((message) => message.kind === "system" && /Discussion has started/.test(message.text))).toBe(true);

    const history = await c.client.emitWithAck("chat:history", {});
    expect(history).toMatchObject({ ok: true, roomCode });
    if (history.ok) {
      expect(history.messages.filter((message) => message.kind === "system").map((message) => message.text)).toEqual([
        "Asha created the room.",
        "Bala joined the room.",
        "Chirag joined the room.",
        "Discussion has started. Chat is open."
      ]);
    }
  });

  it("uses the server-side identity and ignores spoofed sender fields", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b] = players;
    await reachDiscussion(players, 300);

    const spoofed = { text: "Vote Asha!", clientMessageId: nextId(), playerName: "Bala", playerId: b.playerId, kind: "system" };
    const result = await a.client.emitWithAck("chat:send", spoofed as unknown as { text: string; clientMessageId: string });
    expect(result).toMatchObject({ ok: true, chatMessage: { playerId: a.playerId, playerName: "Asha", kind: "player" } });
  });

  it("validates messages and rejects spam and duplicate submissions", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b, c] = players;
    await reachDiscussion(players, 300);

    expect(await a.client.emitWithAck("chat:send", { text: "    ", clientMessageId: nextId() })).toMatchObject({ ok: false, message: expect.stringMatching(/Type a message/) });
    expect(await a.client.emitWithAck("chat:send", { text: "x".repeat(301), clientMessageId: nextId() })).toMatchObject({ ok: false, message: expect.stringMatching(/300/) });
    expect(await a.client.emitWithAck("chat:send", { text: "hi", clientMessageId: "bad id!" })).toMatchObject({ ok: false });

    // Same clientMessageId twice (e.g. a retry after a lost ack) yields one message, broadcast once.
    const clientMessageId = nextId();
    const first = await b.client.emitWithAck("chat:send", { text: "retry me", clientMessageId });
    const retry = await b.client.emitWithAck("chat:send", { text: "retry me", clientMessageId });
    expect(first.ok && retry.ok && first.chatMessage.id === retry.chatMessage.id).toBe(true);

    // Flooding is throttled.
    expect((await c.client.emitWithAck("chat:send", { text: "one", clientMessageId: nextId() })).ok).toBe(true);
    expect(await c.client.emitWithAck("chat:send", { text: "two", clientMessageId: nextId() })).toMatchObject({ ok: false, message: expect.stringMatching(/too quickly/) });

    await pause(50);
    expect(a.chat.filter((message) => message.text === "retry me")).toHaveLength(1);
  });

  it("keeps rooms isolated from each other", async () => {
    const room1 = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const room2 = await createRoomWith(["Dev", "Esha", "Farhan"]);
    await Promise.all([reachDiscussion(room1.players, 300), reachDiscussion(room2.players, 300)]);

    expect((await room1.players[0].client.emitWithAck("chat:send", { text: "secret plan for room one", clientMessageId: nextId() })).ok).toBe(true);
    expect((await room2.players[0].client.emitWithAck("chat:send", { text: "room two talk", clientMessageId: nextId() })).ok).toBe(true);
    await pause(50);

    for (const player of room2.players) {
      expect(player.chat.every((message) => message.text !== "secret plan for room one")).toBe(true);
      expect(player.chat.every((message) => !/Asha|Bala|Chirag/.test(message.text))).toBe(true);
    }
    for (const player of room1.players) expect(player.chat.every((message) => message.text !== "room two talk")).toBe(true);

    const history2 = await room2.players[1].client.emitWithAck("chat:history", {});
    expect(history2.ok && history2.roomCode).toBe(room2.roomCode);
    if (history2.ok) expect(history2.messages.some((message) => message.text === "secret plan for room one")).toBe(false);

    // A socket that never joined a room can neither read nor write any chat.
    const outsider = await connectClient();
    expect(await outsider.emitWithAck("chat:history", {})).toMatchObject({ ok: false });
    expect(await outsider.emitWithAck("chat:send", { text: "hello?", clientMessageId: nextId() })).toMatchObject({ ok: false });
  });

  it("blocks chat outside discussion, locks it when voting starts, keeps history, and resets for a new game", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b, c] = players;

    expect(await a.client.emitWithAck("chat:send", { text: "lobby chatter", clientMessageId: nextId() })).toMatchObject({
      ok: false,
      message: "Chat is only open during the discussion phase."
    });

    await reachDiscussion(players, 1, 1);
    expect((await b.client.emitWithAck("chat:send", { text: "quick, decide!", clientMessageId: nextId() })).ok).toBe(true);

    await Promise.all(players.map((player) => waitForPhase(player, "VOTING", 3_000)));
    await pause(30);
    for (const player of players) {
      expect(player.chat.at(-1)).toMatchObject({ kind: "system", text: "Voting has started. Chat is now closed." });
    }
    expect(await c.client.emitWithAck("chat:send", { text: "too late", clientMessageId: nextId() })).toEqual({
      ok: false,
      message: "Voting has started. Chat is now closed."
    });
    const duringVoting = await c.client.emitWithAck("chat:history", {});
    expect(duringVoting.ok && duringVoting.messages.some((message) => message.text === "quick, decide!")).toBe(true);

    // Finish the (single-round) game.
    expect(await a.client.emitWithAck("vote:submit", { targetPlayerId: b.playerId })).toEqual({ ok: true });
    expect(await b.client.emitWithAck("vote:submit", { targetPlayerId: a.playerId })).toEqual({ ok: true });
    expect(await c.client.emitWithAck("vote:submit", { targetPlayerId: a.playerId })).toEqual({ ok: true });
    await waitForPhase(a, "VOTE_RESULT");
    expect(await a.client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
    await waitForPhase(a, "GAME_END");
    await pause(30);
    expect(a.chat.at(-1)).toMatchObject({ kind: "system", text: "The game has ended. Chat is closed." });
    expect(await b.client.emitWithAck("chat:send", { text: "gg", clientMessageId: nextId() })).toMatchObject({ ok: false });

    const oldEpoch = a.chat.at(-1)?.epoch;
    expect(await a.client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await pause(50);
    for (const player of players) {
      expect(player.histories.at(-1)).toMatchObject({ messages: [] });
      expect(player.histories.at(-1)?.epoch).not.toBe(oldEpoch);
    }
    const fresh = await b.client.emitWithAck("chat:history", {});
    expect(fresh.ok && fresh.messages.map((message) => message.text)).toEqual(["A new game has been set up. Get ready!"]);

    // No private game data (secret words) is ever written into the chat by the server.
    const secretWords = players.map((player) => player.secretWord?.toLowerCase()).filter(Boolean) as string[];
    expect(secretWords.length).toBe(3);
    for (const player of players) {
      for (const message of player.chat.filter((item) => item.kind === "system")) {
        for (const word of secretWords) expect(message.text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("recovers missed messages after a reconnect without duplicates", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const [a, b] = players;
    await reachDiscussion(players, 300);

    b.client.disconnect();
    await pause(50);
    expect((await a.client.emitWithAck("chat:send", { text: "said while Bala was away", clientMessageId: nextId() })).ok).toBe(true);

    const fresh = await connectClient();
    const rejoined = await fresh.emitWithAck("room:reconnect-player", { roomCode, playerId: b.playerId, reconnectToken: b.reconnectToken });
    expect(rejoined.ok).toBe(true);
    const history = await fresh.emitWithAck("chat:history", {});
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const texts = history.messages.map((message) => message.text);
    expect(texts).toContain("Bala disconnected.");
    expect(texts).toContain("said while Bala was away");
    expect(texts.at(-1)).toBe("Bala reconnected.");
    expect(new Set(history.messages.map((message) => message.id)).size).toBe(history.messages.length);

    // The reconnected player can chat again, under their own identity.
    const sent = await fresh.emitWithAck("chat:send", { text: "I'm back", clientMessageId: nextId() });
    expect(sent).toMatchObject({ ok: true, chatMessage: { playerName: "Bala", playerId: b.playerId } });
  });

  it("stops a kicked player's socket from receiving the room's chat", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const [a, , , d] = players;
    expect(await a.client.emitWithAck("player:kick", { playerId: d.playerId })).toEqual({ ok: true });
    await pause(30);
    const before = d.chat.length;
    await reachDiscussion(players.slice(0, 3), 300);
    expect((await a.client.emitWithAck("chat:send", { text: "Dev can't see this", clientMessageId: nextId() })).ok).toBe(true);
    await pause(50);
    expect(d.chat.length).toBe(before);
    expect(await d.client.emitWithAck("chat:history", {})).toMatchObject({ ok: false });
  });
});
