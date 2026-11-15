import type { AddressInfo } from "node:net";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { expect } from "vitest";
import type { ClientToServerEvents, GamePhase, GameSettings, PrivateRole, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
import { createGameServer, type GameServerOptions } from "../../src/app.js";
import { MemoryStore, type Store } from "../../src/store/index.js";

/**
 * Shared harness for tests that need the real server: the same createGameServer()
 * wiring as production, listening on a random local port, with real Socket.IO
 * clients and real HTTP requests.
 */

export type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

export type TrackedPlayer = {
  name: string;
  client: TestClient;
  playerId: string;
  reconnectToken: string;
  roomCode: string;
  secrets: PrivateRole[];
  /** Every server->client event this player received, including their own private role. */
  events: Array<{ event: string; payload: unknown }>;
  lastState: PublicRoomState | null;
};

export type TestServer = {
  url: string;
  store: Store;
  close: () => Promise<void>;
};

const openServers: TestServer[] = [];
const openClients: TestClient[] = [];

export async function startTestServer(options: Partial<GameServerOptions> = {}): Promise<TestServer> {
  const store = options.store ?? new MemoryStore();
  const { httpServer, io } = createGameServer({
    clientOrigin: "http://localhost:5173",
    persistence: { enabled: false, saveCompletedGame: async () => undefined },
    ...options,
    store
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  const server: TestServer = {
    url,
    store,
    close: async () => {
      io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
  openServers.push(server);
  return server;
}

/** Disconnects every client and stops every server started by this harness. Call in afterEach. */
export async function closeAll(): Promise<void> {
  for (const client of openClients.splice(0)) client.disconnect();
  for (const server of openServers.splice(0)) await server.close().catch(() => undefined);
}

export function connectClient(url: string, token?: string): Promise<TestClient> {
  const client = Client(url, { forceNew: true, reconnection: false, auth: token ? { token } : {} }) as TestClient;
  openClients.push(client);
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

export function track(name: string, client: TestClient, ack: { playerId: string; reconnectToken: string; roomCode: string }): TrackedPlayer {
  const player: TrackedPlayer = { name, client, ...ack, secrets: [], events: [], lastState: null };
  client.onAny((event: string, payload: unknown) => {
    player.events.push({ event, payload });
    if (event === "player:secret") player.secrets.push(payload as PrivateRole);
    if (event === "room:state") player.lastState = payload as PublicRoomState;
  });
  return player;
}

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(condition: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await pause(10);
  }
}

export const waitForPhase = (players: TrackedPlayer[], phase: GamePhase) =>
  until(() => players.every((player) => player.lastState?.phase === phase), `phase ${phase}`);

/**
 * Creates a room with the first entry as host and joins the rest.
 * `tokens[i]` (optional) is the session token player i connects with; omitted means guest.
 */
export async function createRoomWith(url: string, names: string[], tokens: Array<string | undefined> = []): Promise<TrackedPlayer[]> {
  const [hostName, ...guestNames] = names;
  const hostClient = await connectClient(url, tokens[0]);
  const created = await hostClient.emitWithAck("room:create", { playerName: hostName });
  if (!created.ok) throw new Error(created.message);
  const players = [track(hostName, hostClient, created)];
  for (const [index, name] of guestNames.entries()) {
    const client = await connectClient(url, tokens[index + 1]);
    const joined = await client.emitWithAck("room:join", { roomCode: created.roomCode, playerName: name });
    if (!joined.ok) throw new Error(joined.message);
    players.push(track(name, client, joined));
  }
  return players;
}

export async function readyAndStart(players: TrackedPlayer[], settings: Partial<GameSettings> = {}): Promise<void> {
  const [host, ...guests] = players;
  if (Object.keys(settings).length > 0) expect(await host.client.emitWithAck("settings:update", settings)).toEqual({ ok: true });
  for (const guest of guests) expect(await guest.client.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
  expect(await host.client.emitWithAck("game:start", {})).toEqual({ ok: true });
}

export type RoundPlan = {
  /** true (default): every normal player votes for the Imposter. false: everyone votes out the first normal player. */
  catchImposter?: boolean;
};

/**
 * Plays the current round (discussion must be disabled) up to its result and returns what was dealt.
 * The Imposter always votes for the first normal player.
 */
export async function playRound(players: TrackedPlayer[], secretsSoFar: number, plan: RoundPlan = {}) {
  await until(() => players.every((player) => player.secrets.length === secretsSoFar + 1), "this round's roles");
  await waitForPhase(players, "ROLE_ASSIGNMENT");
  for (const player of players) expect(await player.client.emitWithAck("role:ack", {})).toEqual({ ok: true });
  await waitForPhase(players, "CLUE_PHASE");
  for (const [index, player] of players.entries()) {
    expect(await player.client.emitWithAck("clue:submit", { clue: `zq${"vwxyzbcdfg"[index]}k` })).toEqual({ ok: true });
  }
  await waitForPhase(players, "VOTING");
  const imposter = players.find((player) => player.secrets.at(-1)?.role === "Imposter")!;
  const normals = players.filter((player) => player !== imposter);
  const scapegoat = normals[0];
  for (const normal of normals) {
    const votedFor = plan.catchImposter === false ? (normal === scapegoat ? normals[1] : scapegoat) : imposter;
    expect(await normal.client.emitWithAck("vote:submit", { targetPlayerId: votedFor.playerId })).toEqual({ ok: true });
  }
  expect(await imposter.client.emitWithAck("vote:submit", { targetPlayerId: scapegoat.playerId })).toEqual({ ok: true });
  await waitForPhase(players, "VOTE_RESULT");
  return { imposter, normals, mainWord: normals[0].secrets.at(-1)!.word, imposterWord: imposter.secrets.at(-1)!.word };
}

/** Plays a whole game of `rounds` rounds and waits for GAME_END. */
export async function playGame(players: TrackedPlayer[], rounds: number, plans: RoundPlan[] = []) {
  const results = [];
  for (let round = 0; round < rounds; round += 1) {
    results.push(await playRound(players, round, plans[round]));
    expect(await players[0].client.emitWithAck("game:next-round", {})).toEqual({ ok: true });
  }
  await waitForPhase(players, "GAME_END");
  return results;
}

export async function api<T = unknown>(
  url: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string; rawBody?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: T; text: string }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.body !== undefined || options.rawBody !== undefined) headers["Content-Type"] = "application/json";
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const response = await fetch(`${url}${path}`, {
    method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
    headers,
    body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T, text };
}
