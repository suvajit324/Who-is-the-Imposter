import { createServer, type Server as HttpServer } from "node:http";
import { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as Client, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientToServerEvents, ServerToClientEvents } from "@imposter/shared";
import { RoomManager } from "../src/domain/roomManager.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let httpServer: HttpServer;
let ioServer: Server<ClientToServerEvents, ServerToClientEvents>;
let url: string;

beforeEach(async () => {
  httpServer = createServer();
  ioServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  const persistence = { enabled: false, saveCompletedGame: async () => undefined };
  registerHandlers(ioServer, new RoomManager(ioServer, persistence));
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  ioServer.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connectClient(): Promise<TestClient> {
  const client = Client(url, { forceNew: true }) as TestClient;
  return new Promise((resolve, reject) => {
    client.on("connect", () => resolve(client));
    client.on("connect_error", reject);
  });
}

describe("socket multiplayer flow", () => {
  it("creates and joins a room, rejects unauthorized start, and sends private roles only to players", async () => {
    const a = await connectClient();
    const b = await connectClient();
    const c = await connectClient();

    const created = await a.emitWithAck("room:create", { playerName: "Asha" });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("create failed");

    const joinedB = await b.emitWithAck("room:join", { roomCode: created.roomCode, playerName: "Bala" });
    const joinedC = await c.emitWithAck("room:join", { roomCode: created.roomCode, playerName: "Chirag" });
    expect(joinedB.ok).toBe(true);
    expect(joinedC.ok).toBe(true);

    expect(await b.emitWithAck("game:start", {})).toEqual({ ok: false, message: "Only the host can start the game." });
    expect(await b.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });
    expect(await c.emitWithAck("player:ready", { ready: true })).toEqual({ ok: true });

    const secrets: string[] = [];
    a.on("player:secret", (secret) => secrets.push(`a:${secret.word}`));
    b.on("player:secret", (secret) => secrets.push(`b:${secret.word}`));
    c.on("player:secret", (secret) => secrets.push(`c:${secret.word}`));
    expect(await a.emitWithAck("game:start", {})).toEqual({ ok: true });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secrets).toHaveLength(3);
    expect(new Set(secrets.map((item) => item[0]))).toEqual(new Set(["a", "b", "c"]));

    a.disconnect();
    b.disconnect();
    c.disconnect();
  });
});
