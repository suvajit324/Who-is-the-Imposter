import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthResponse } from "@imposter/shared";
import { api, closeAll, connectClient, createRoomWith, playGame, readyAndStart, startTestServer, track, until } from "./helpers/harness.js";

vi.setConfig({ testTimeout: 30_000 });

afterEach(closeAll);

const PASSWORD = "correct horse 42";

async function register(url: string, username: string, avatar = "rocket") {
  const response = await api<AuthResponse>(url, "/api/auth/register", { body: { username, password: PASSWORD, avatar } });
  expect(response.status, response.text).toBe(201);
  return response.body.token;
}

async function login(url: string, username: string) {
  const response = await api<AuthResponse>(url, "/api/auth/login", { body: { username, password: PASSWORD } });
  expect(response.status).toBe(200);
  return response.body.token;
}

describe("signed-in players in rooms", () => {
  it("seats signed-in players under their username with a public profile; guests have none", async () => {
    const server = await startTestServer();
    const ana = await register(server.url, "Ana_Plays", "cat");
    const players = await createRoomWith(server.url, ["Pretending", "Ben", "Cy"], [ana]);
    await until(() => players[0].lastState?.players.length === 3, "all players");

    const seats = players[0].lastState!.players;
    expect(seats.map((seat) => seat.name)).toEqual(["Ana_Plays", "Ben", "Cy"]);
    expect(seats[0].profile).toEqual({ username: "Ana_Plays", avatar: "cat" });
    expect(seats[1].profile).toBeNull();
    expect(seats[2].profile).toBeNull();

    // The account id and session token never reach any client.
    const anaId = (await server.store.findUserByUsernameKey("ana_plays"))!.id;
    for (const player of players) {
      const wire = JSON.stringify(player.events);
      expect(wire.includes(anaId)).toBe(false);
      expect(wire.includes(ana)).toBe(false);
      expect(wire.includes("userId")).toBe(false);
    }
  });

  it("keeps one seat per account in a room", async () => {
    const server = await startTestServer();
    await register(server.url, "Solo");
    const first = await login(server.url, "Solo");
    const second = await login(server.url, "Solo");
    const [host] = await createRoomWith(server.url, ["Solo"], [first]);
    const duplicate = await connectClient(server.url, second);
    expect(await duplicate.emitWithAck("room:join", { roomCode: host.roomCode, playerName: "Someone Else" })).toEqual({
      ok: false,
      message: "Your account is already playing in this room."
    });
  });

  it("does not let a signed-in player take a name a guest already uses", async () => {
    const server = await startTestServer();
    const token = await register(server.url, "Taken");
    const [host] = await createRoomWith(server.url, ["taken"]);
    const member = await connectClient(server.url, token);
    expect(await member.emitWithAck("room:join", { roomCode: host.roomCode, playerName: "Whatever" })).toEqual({
      ok: false,
      message: "That player name is already taken in this room."
    });
  });

  it("lets only the same account resume an account seat", async () => {
    const server = await startTestServer();
    const owner = await register(server.url, "Seat_holder");
    const stranger = await register(server.url, "Stranger");
    const players = await createRoomWith(server.url, ["Seat_holder", "Ben", "Cy"], [owner]);
    const seat = players[0];
    seat.client.disconnect();
    await until(() => players[1].lastState?.players[0].connected === false, "the disconnect");

    const credentials = { roomCode: seat.roomCode, playerId: seat.playerId, reconnectToken: seat.reconnectToken };
    const failure = { ok: false, message: "Reconnect failed. Please rejoin from the lobby if the game has not started." };
    expect(await (await connectClient(server.url)).emitWithAck("room:reconnect-player", credentials)).toEqual(failure);
    expect(await (await connectClient(server.url, stranger)).emitWithAck("room:reconnect-player", credentials)).toEqual(failure);

    // The same account, even with a new session, gets the seat back.
    const resumed = await (await connectClient(server.url, await login(server.url, "Seat_holder"))).emitWithAck("room:reconnect-player", credentials);
    expect(resumed.ok).toBe(true);
  });

  it("still lets guest seats reconnect as before", async () => {
    const server = await startTestServer();
    const players = await createRoomWith(server.url, ["Ana", "Ben", "Cy"]);
    const seat = players[1];
    seat.client.disconnect();
    await until(() => players[0].lastState?.players[1].connected === false, "the disconnect");
    const client = await connectClient(server.url);
    const resumed = await client.emitWithAck("room:reconnect-player", { roomCode: seat.roomCode, playerId: seat.playerId, reconnectToken: seat.reconnectToken });
    expect(resumed.ok).toBe(true);
  });

  it("plays a full mixed game of signed-in players and guests", async () => {
    const server = await startTestServer();
    const tokens = [await register(server.url, "Mixed_a"), undefined, await register(server.url, "Mixed_c")];
    const players = await createRoomWith(server.url, ["x1", "Guest B", "x3"], tokens);
    await readyAndStart(players, { rounds: 2, discussionEnabled: false });
    await playGame(players, 2, [{ catchImposter: true }, { catchImposter: false }]);
    expect(players[0].lastState?.players.map((player) => player.profile?.username ?? null)).toEqual(["Mixed_a", null, "Mixed_c"]);
  });
});

describe("socket handshake authentication", () => {
  it("refuses an unknown, malformed or revoked token so the client can fall back to guest", async () => {
    const server = await startTestServer();
    await expect(connectClient(server.url, "A".repeat(43))).rejects.toThrow("SESSION_INVALID");
    await expect(connectClient(server.url, "short")).rejects.toThrow("SESSION_INVALID");

    const token = await register(server.url, "Revoked");
    await connectClient(server.url, token);
    await api(server.url, "/api/auth/logout", { method: "POST", token });
    await expect(connectClient(server.url, token)).rejects.toThrow("SESSION_INVALID");
  });

  it("closes the sockets of a session when it logs out, and only those", async () => {
    const server = await startTestServer();
    const mine = await register(server.url, "Leaver");
    const other = await register(server.url, "Stayer");
    const mySocket = await connectClient(server.url, mine);
    const otherSocket = await connectClient(server.url, other);
    const guestSocket = await connectClient(server.url);
    const reasons: string[] = [];
    mySocket.on("disconnect", (reason) => reasons.push(reason));

    expect((await api(server.url, "/api/auth/logout", { method: "POST", token: mine })).status).toBe(204);
    await until(() => reasons.length === 1, "the forced disconnect");
    expect(reasons).toEqual(["io server disconnect"]);
    expect(otherSocket.connected).toBe(true);
    expect(guestSocket.connected).toBe(true);
  });

  it("reports a store outage during the handshake instead of silently signing the player out", async () => {
    const server = await startTestServer();
    const token = await register(server.url, "Outage");
    vi.spyOn(server.store, "findSession").mockRejectedValue(new Error("database down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(connectClient(server.url, token)).rejects.toThrow("ACCOUNTS_UNAVAILABLE");
    // Guests are unaffected.
    const guest = await connectClient(server.url);
    const created = await guest.emitWithAck("room:create", { playerName: "Guest" });
    expect(created.ok).toBe(true);
    if (created.ok) track("Guest", guest, created);
    vi.restoreAllMocks();
  });
});
