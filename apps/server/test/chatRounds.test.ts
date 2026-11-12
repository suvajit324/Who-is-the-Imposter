import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatHistory, ChatMessage, ClientToServerEvents, PrivateRole, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
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
  secrets: PrivateRole[];
  lastState: PublicRoomState | null;
};

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;
const openClients: TestClient[] = [];
let idCounter = 0;

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
const nextId = () => `rounds-msg-${(idCounter += 1).toString().padStart(5, "0")}`;
const DISCUSSION_1 = "Discussion has started. Chat is open.";
const discussionN = (round: number) => `Round ${round} discussion has started. Chat is open.`;
const VOTING = "Voting has started. Chat is now closed.";
const GAME_END = "The game has ended. Chat is closed.";

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

function track(name: string, client: TestClient, playerId: string, reconnectToken: string): Player {
  const player: Player = { name, client, playerId, reconnectToken, chat: [], histories: [], secrets: [], lastState: null };
  client.on("chat:message", (message) => player.chat.push(message));
  client.on("chat:history", (history) => player.histories.push(history));
  client.on("player:secret", (secret) => player.secrets.push(secret));
  client.on("room:state", (state) => { player.lastState = state; });
  return player;
}

function waitForState(player: Player, predicate: (state: PublicRoomState) => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  if (player.lastState && predicate(player.lastState)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${player.name} never reached ${label}`)), timeoutMs);
    const onState = (state: PublicRoomState) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      player.client.off("room:state", onState);
      resolve();
    };
    player.client.on("room:state", onState);
  });
}

const atPhase = (players: Player[], phase: PublicRoomState["phase"], round?: number) =>
  Promise.all(players.map((player) => waitForState(player, (state) => state.phase === phase && (round === undefined || state.roundNumber === round), `${phase}${round ? ` r${round}` : ""}`)));

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

async function startGame(players: Player[], rounds: number, discussionSeconds: number) {
  const [host, ...guests] = players;
  expect(await host.client.emitWithAck("settings:update", { rounds, discussionSeconds, votingSeconds: 10 })).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
}

/** Role reveal + clue submission for the given (connected) players, ending in DISCUSSION. */
async function playIntoDiscussion(players: Player[], round: number) {
  await atPhase(players, "ROLE_ASSIGNMENT", round);
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await atPhase(players, "CLUE_PHASE", round);
  // Chat must be closed during the clue phase of every round.
  expect(await players[0].client.emitWithAck("chat:send", { text: "too early", clientMessageId: nextId() })).toEqual({
    ok: false,
    message: "Chat is only open during the discussion phase."
  });
  for (const [index, player] of players.entries()) {
    expect(await player.client.emitWithAck("clue:submit", { clue: `zq${round}${"vwxyz"[index]}k` })).toEqual({ ok: true });
  }
  await atPhase(players, "DISCUSSION", round);
}

/** Everyone except the target votes for the target; the target votes for someone else. No ties. */
async function voteOut(voters: Player[], target: Player) {
  const other = voters.find((player) => player !== target)!;
  for (const voter of voters) {
    const choice = voter === target ? other : target;
    expect(await voter.client.emitWithAck("vote:submit", { targetPlayerId: choice.playerId })).toEqual({ ok: true });
  }
}

async function say(player: Player, text: string) {
  const response = await player.client.emitWithAck("chat:send", { text, clientMessageId: nextId() });
  expect(response, `${player.name}: ${text}`).toMatchObject({ ok: true });
  return response;
}

async function history(player: Player) {
  const response = await player.client.emitWithAck("chat:history", {});
  if (!response.ok) throw new Error(response.message);
  return response;
}

/** Player messages may only appear while chat is open: between a discussion-start and the next voting/end marker. */
function expectPlayerMessagesOnlyDuringDiscussion(messages: ChatMessage[]) {
  let open = false;
  for (const message of messages) {
    if (message.kind === "system") {
      if (/discussion has started/i.test(message.text)) open = true;
      if (message.text === VOTING || message.text === GAME_END || /cancelled/.test(message.text)) open = false;
    } else {
      expect(open, `player message "${message.text}" arrived while chat was closed`).toBe(true);
    }
  }
}

describe("chat across multiple discussion rounds", () => {
  it("keeps history across rounds, announces each round, locks on voting, and resets on rematch", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a, b, c] = players;
    await startGame(players, 2, 2);

    // --- Round 1 ---
    await playIntoDiscussion(players, 1);
    await pause(20);
    for (const player of players) expect(player.chat.at(-1)?.text).toBe(DISCUSSION_1);
    await say(a, "round one: Bala's clue was vague");
    await say(b, "round one: mine was fine");
    await say(c, "round one: hmm");
    await atPhase(players, "VOTING", 1);
    await pause(20);
    for (const player of players) expect(player.chat.at(-1)?.text).toBe(VOTING);
    expect(await b.client.emitWithAck("chat:send", { text: "late", clientMessageId: nextId() })).toEqual({ ok: false, message: VOTING });
    expect((await history(c)).messages.filter((m) => m.kind === "player").map((m) => m.text)).toEqual([
      "round one: Bala's clue was vague",
      "round one: mine was fine",
      "round one: hmm"
    ]);
    await voteOut(players, c);
    await atPhase(players, "VOTE_RESULT", 1);
    expect(await a.client.emitWithAck("chat:send", { text: "results chat", clientMessageId: nextId() })).toMatchObject({ ok: false });
    expect(await a.client.emitWithAck("game:next-round", {})).toEqual({ ok: true });

    // --- Round 2 ---
    await playIntoDiscussion(players, 2);
    await pause(20);
    for (const player of players) expect(player.chat.at(-1)?.text).toBe(discussionN(2));
    const r2History = await history(a);
    expect(r2History.messages.filter((m) => m.kind === "player")).toHaveLength(3); // round 1 preserved
    expect(r2History.messages.map((m) => m.text)).toContain(DISCUSSION_1);
    await say(c, "round two: new word, new suspicions");
    await say(a, "round two: agreed");
    await pause(30);
    for (const player of players) {
      expect(player.chat.filter((m) => m.kind === "player").map((m) => m.text).slice(-2)).toEqual(["round two: new word, new suspicions", "round two: agreed"]);
    }
    await atPhase(players, "VOTING", 2);
    await pause(20);
    for (const player of players) expect(player.chat.at(-1)?.text).toBe(VOTING);
    expect(await a.client.emitWithAck("chat:send", { text: "late again", clientMessageId: nextId() })).toEqual({ ok: false, message: VOTING });
    expect((await history(b)).messages.filter((m) => m.kind === "player")).toHaveLength(5);

    await voteOut(players, a);
    await atPhase(players, "VOTE_RESULT", 2);
    expect(await a.client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
    await atPhase(players, "GAME_END");
    await pause(20);
    expect(a.chat.at(-1)?.text).toBe(GAME_END);
    expect(await b.client.emitWithAck("chat:send", { text: "gg", clientMessageId: nextId() })).toMatchObject({ ok: false });

    // Every client saw the same live messages in the same order, without duplicates or gaps,
    // from the first discussion on. (Messages from before a client joined, such as earlier
    // "joined the room" notices, arrive via chat:history instead, which the web client loads on entry.)
    const fromFirstDiscussion = (messages: ChatMessage[]) => messages.slice(messages.findIndex((m) => m.text === DISCUSSION_1));
    const reference = fromFirstDiscussion(a.chat).map((m) => m.id);
    // discussion 1, 3 messages, voting, discussion 2, 2 messages, voting, game end
    expect(fromFirstDiscussion(a.chat).map((m) => m.text)).toEqual([
      DISCUSSION_1, "round one: Bala's clue was vague", "round one: mine was fine", "round one: hmm", VOTING,
      discussionN(2), "round two: new word, new suspicions", "round two: agreed", VOTING, GAME_END
    ]);
    for (const player of players) {
      expect(fromFirstDiscussion(player.chat).map((m) => m.id)).toEqual(reference);
      expect(new Set(player.chat.map((m) => m.id)).size).toBe(player.chat.length);
    }
    const seqs = fromFirstDiscussion(a.chat).map((m) => m.seq);
    expect(seqs).toEqual(seqs.map((_, index) => seqs[0] + index));
    // And everyone's full history is identical.
    const fullHistories = await Promise.all(players.map((player) => history(player)));
    for (const full of fullHistories) expect(full.messages.map((m) => m.id)).toEqual(fullHistories[0].messages.map((m) => m.id));
    expectPlayerMessagesOnlyDuringDiscussion((await history(a)).messages);

    // --- Rematch: a genuinely new game resets the chat ---
    const oldEpoch = a.chat.at(-1)!.epoch;
    expect(await a.client.emitWithAck("game:rematch", {})).toEqual({ ok: true });
    await pause(30);
    for (const player of players) expect(player.histories.at(-1)).toMatchObject({ messages: [] });
    const fresh = await history(b);
    expect(fresh.epoch).not.toBe(oldEpoch);
    expect(fresh.messages.map((m) => m.text)).toEqual(["A new game has been set up. Get ready!"]);

    // The new game's first discussion is announced as round 1 again, not round 3.
    await startGame(players, 1, 2);
    await playIntoDiscussion(players, 1);
    await pause(20);
    expect(a.chat.at(-1)?.text).toBe(DISCUSSION_1);
    await say(b, "new game chat works");
    expect((await history(c)).messages.filter((m) => m.kind === "player").map((m) => m.text)).toEqual(["new game chat works"]);
  }, 40_000);

  it("keeps rooms isolated in every round", async () => {
    const room1 = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const room2 = await createRoomWith(["Dev", "Esha", "Farhan"]);
    await Promise.all([startGame(room1.players, 2, 2), startGame(room2.players, 2, 2)]);
    for (const room of [room1, room2]) await playIntoDiscussion(room.players, 1);
    await say(room1.players[0], "room1-round1 secret talk");
    await say(room2.players[0], "room2-round1 talk");
    for (const room of [room1, room2]) {
      await atPhase(room.players, "VOTING", 1);
      await voteOut(room.players, room.players[2]);
      await atPhase(room.players, "VOTE_RESULT", 1);
      expect(await room.players[0].client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
      await playIntoDiscussion(room.players, 2);
    }
    await say(room1.players[1], "room1-round2 secret talk");
    await say(room2.players[1], "room2-round2 talk");
    await pause(40);

    for (const player of room2.players) expect(player.chat.some((m) => m.text.startsWith("room1-"))).toBe(false);
    for (const player of room1.players) expect(player.chat.some((m) => m.text.startsWith("room2-"))).toBe(false);
    const h1 = await history(room1.players[2]);
    const h2 = await history(room2.players[2]);
    expect(h1.roomCode).toBe(room1.roomCode);
    expect(h2.roomCode).toBe(room2.roomCode);
    expect(h1.epoch).not.toBe(h2.epoch);
    expect(h1.messages.filter((m) => m.kind === "player").map((m) => m.text)).toEqual(["room1-round1 secret talk", "room1-round2 secret talk"]);
    expect(h2.messages.filter((m) => m.kind === "player").map((m) => m.text)).toEqual(["room2-round1 talk", "room2-round2 talk"]);
  }, 40_000);

  it("handles a player who disconnects in round 1 discussion and reconnects in the next round", async () => {
    const { roomCode, players } = await createRoomWith(["Asha", "Bala", "Chirag", "Dev"]);
    const [a, b, c, d] = players;
    const stayers = [a, b, c];
    await startGame(players, 2, 3);
    await playIntoDiscussion(players, 1);
    await say(d, "Dev here before dropping");

    d.client.disconnect();
    await pause(50);
    await say(a, "Dev dropped off");
    await atPhase(stayers, "VOTING", 1);
    // Dev is still an eligible voter, so voting runs to its 10s deadline.
    await voteOut(stayers, c);
    await atPhase(stayers, "VOTE_RESULT", 1);
    expect(await a.client.emitWithAck("game:next-round", {})).toEqual({ ok: true });

    // Round 2 starts with Dev still offline.
    await atPhase(stayers, "ROLE_ASSIGNMENT", 2);
    for (const player of stayers) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
    await atPhase(stayers, "CLUE_PHASE", 2);

    // Dev reconnects during round 2's clue phase.
    const freshClient = await connectClient();
    const dev = track("Dev", freshClient, d.playerId, d.reconnectToken);
    const rejoined = await freshClient.emitWithAck("room:reconnect-player", { roomCode, playerId: d.playerId, reconnectToken: d.reconnectToken });
    expect(rejoined).toMatchObject({ ok: true, state: { phase: "CLUE_PHASE", roundNumber: 2 } });
    await pause(30);
    expect(dev.secrets.at(-1)).toMatchObject({ playerId: d.playerId, roundNumber: 2 });

    const recovered = await history(dev);
    const texts = recovered.messages.map((m) => m.text);
    expect(texts).toEqual(expect.arrayContaining(["Dev here before dropping", "Dev disconnected.", "Dev dropped off", VOTING]));
    expect(texts.at(-1)).toBe("Dev reconnected.");
    expect(new Set(recovered.messages.map((m) => m.id)).size).toBe(recovered.messages.length);
    // Chat stays closed for the reconnected player until discussion opens.
    expect(await freshClient.emitWithAck("chat:send", { text: "hi again", clientMessageId: nextId() })).toMatchObject({ ok: false });

    for (const [index, player] of [...stayers, dev].entries()) {
      expect(await player.client.emitWithAck("clue:submit", { clue: `zq9${"vwxy"[index]}k` })).toEqual({ ok: true });
    }
    await atPhase([...stayers, dev], "DISCUSSION", 2);
    await pause(20);
    expect(dev.chat.at(-1)?.text).toBe(discussionN(2));
    await say(dev, "back for round two");
    await pause(30);
    for (const player of [a, b, c]) expect(player.chat.at(-1)).toMatchObject({ text: "back for round two", playerName: "Dev" });
    expectPlayerMessagesOnlyDuringDiscussion((await history(a)).messages);
  }, 40_000);

  it("never accepts a message after voting begins, even when sent right at the boundary", async () => {
    const { players } = await createRoomWith(["Asha", "Bala", "Chirag"]);
    const [a] = players;
    await startGame(players, 1, 1);
    await playIntoDiscussion(players, 1);
    // Fire messages continuously across the discussion -> voting transition.
    const outcomes: boolean[] = [];
    for (let attempt = 0; attempt < 40 && a.lastState?.phase !== "VOTING"; attempt += 1) {
      const response = await a.client.emitWithAck("chat:send", { text: `boundary ${attempt}`, clientMessageId: nextId() });
      outcomes.push(response.ok);
      await pause(110);
    }
    await atPhase(players, "VOTING", 1);
    const response = await a.client.emitWithAck("chat:send", { text: "after boundary", clientMessageId: nextId() });
    expect(response).toEqual({ ok: false, message: VOTING });
    expect(outcomes.some(Boolean)).toBe(true);
    const messages = (await history(a)).messages;
    expect(messages.at(-1)?.text).toBe(VOTING);
    expectPlayerMessagesOnlyDuringDiscussion(messages);
  }, 20_000);
});
