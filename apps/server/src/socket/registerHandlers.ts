import type { Server, Socket } from "socket.io";
import {
  clueSchema,
  createRoomSchema,
  imposterGuessSchema,
  joinRoomSchema,
  reconnectSchema,
  settingsSchema,
  voteSchema,
  type ClientToServerEvents,
  type ServerToClientEvents
} from "@imposter/shared";
import type { RoomManager } from "../domain/roomManager.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: GameServer, roomManager: RoomManager): void {
  io.on("connection", (socket: GameSocket) => {
    const ip = socket.handshake.address;

    socket.on("room:create", (payload, ack) => {
      const parsed = createRoomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a valid player name." });
      ack(roomManager.createRoom(socket, parsed.data.playerName, ip));
    });

    socket.on("room:join", (payload, ack) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a valid room code and player name." });
      ack(roomManager.joinRoom(socket, parsed.data.roomCode.toUpperCase(), parsed.data.playerName, ip));
    });

    socket.on("room:reconnect-player", (payload, ack) => {
      const parsed = reconnectSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Stored reconnect credentials are invalid." });
      ack(roomManager.reconnect(socket, parsed.data.roomCode.toUpperCase(), parsed.data.playerId, parsed.data.reconnectToken));
    });

    socket.on("player:ready", (payload, ack) => {
      ack(roomManager.setReady(socket, Boolean(payload.ready)));
    });

    socket.on("settings:update", (payload, ack) => {
      const parsed = settingsSchema.partial().safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Those settings are not valid." });
      ack(roomManager.updateSettings(socket, parsed.data));
    });

    socket.on("player:kick", (payload, ack) => {
      if (!payload?.playerId) return ack({ ok: false, message: "Choose a player to remove." });
      ack(roomManager.kick(socket, payload.playerId));
    });

    socket.on("game:start", (_payload, ack) => {
      ack(roomManager.startGame(socket));
    });

    socket.on("role:ack", (_payload, ack) => {
      ack(roomManager.acknowledgeRole(socket));
    });

    socket.on("clue:submit", (payload, ack) => {
      const parsed = clueSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter one short clue." });
      ack(roomManager.submitClue(socket, parsed.data.clue));
    });

    socket.on("vote:submit", (payload, ack) => {
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Choose a valid player." });
      ack(roomManager.submitVote(socket, parsed.data.targetPlayerId));
    });

    socket.on("imposter:guess", (payload, ack) => {
      const parsed = imposterGuessSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a guess." });
      ack(roomManager.submitImposterGuess(socket, parsed.data.guess));
    });

    socket.on("game:next-round", (_payload, ack) => {
      ack(roomManager.nextRound(socket));
    });

    socket.on("game:rematch", (_payload, ack) => {
      ack(roomManager.rematch(socket));
    });

    socket.on("disconnect", () => {
      roomManager.disconnect(socket);
    });
  });
}
