import type { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  chatSendSchema,
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
type EventName = keyof ClientToServerEvents;
type AckOf<E extends EventName> = Parameters<ClientToServerEvents[E]>[1] extends (response: infer R) => void ? R : never;

const readySchema = z.object({ ready: z.boolean() });
const kickSchema = z.object({ playerId: z.string().min(8).max(64) });

const INTERNAL_ERROR = { ok: false as const, message: "Something went wrong. Please try again." };

export function registerHandlers(io: GameServer, roomManager: RoomManager): void {
  io.on("connection", (socket: GameSocket) => {
    const ip = socket.handshake.address;

    /**
     * Registers a handler that can never crash the process. Socket.IO runs listeners
     * inside process.nextTick, so an exception thrown by a handler (e.g. from a null
     * payload, or calling a missing ack) becomes an uncaught exception that kills the
     * server for every room. All client input is untrusted, so:
     *  - events without an ack callback are ignored (every legitimate client call has one);
     *  - the payload is passed on as `unknown`, and each handler validates it with zod;
     *  - unexpected exceptions are logged and answered with a generic error.
     */
    const handle = <E extends EventName>(event: E, handler: (payload: unknown, reply: (response: AckOf<E>) => void) => void) => {
      const listener = (payload: unknown, ack: unknown) => {
        if (typeof ack !== "function") return;
        const reply = ack as (response: AckOf<E>) => void;
        try {
          handler(payload, reply);
        } catch (error) {
          console.error(`[socket] "${event}" handler failed:`, error);
          reply(INTERNAL_ERROR as AckOf<E>);
        }
      };
      socket.on(event, listener as never);
    };

    handle("room:create", (payload, ack) => {
      const parsed = createRoomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a valid player name." });
      ack(roomManager.createRoom(socket, parsed.data.playerName, ip));
    });

    handle("room:join", (payload, ack) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a valid room code and player name." });
      ack(roomManager.joinRoom(socket, parsed.data.roomCode.toUpperCase(), parsed.data.playerName, ip));
    });

    handle("room:reconnect-player", (payload, ack) => {
      const parsed = reconnectSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Stored reconnect credentials are invalid." });
      ack(roomManager.reconnect(socket, parsed.data.roomCode.toUpperCase(), parsed.data.playerId, parsed.data.reconnectToken));
    });

    handle("player:ready", (payload, ack) => {
      const parsed = readySchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Invalid ready state." });
      ack(roomManager.setReady(socket, parsed.data.ready));
    });

    handle("settings:update", (payload, ack) => {
      const parsed = settingsSchema.partial().safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Those settings are not valid." });
      ack(roomManager.updateSettings(socket, parsed.data));
    });

    handle("player:kick", (payload, ack) => {
      const parsed = kickSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Choose a player to remove." });
      ack(roomManager.kick(socket, parsed.data.playerId));
    });

    handle("game:start", (_payload, ack) => {
      ack(roomManager.startGame(socket));
    });

    handle("role:ack", (_payload, ack) => {
      ack(roomManager.acknowledgeRole(socket));
    });

    handle("clue:submit", (payload, ack) => {
      const parsed = clueSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter one short clue." });
      ack(roomManager.submitClue(socket, parsed.data.clue));
    });

    handle("vote:submit", (payload, ack) => {
      const parsed = voteSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Choose a valid player." });
      ack(roomManager.submitVote(socket, parsed.data.targetPlayerId));
    });

    handle("imposter:guess", (payload, ack) => {
      const parsed = imposterGuessSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "Enter a guess." });
      ack(roomManager.submitImposterGuess(socket, parsed.data.guess));
    });

    handle("game:next-round", (_payload, ack) => {
      ack(roomManager.nextRound(socket));
    });

    handle("game:rematch", (_payload, ack) => {
      ack(roomManager.rematch(socket));
    });

    handle("chat:send", (payload, ack) => {
      // Only `text` and `clientMessageId` are read; any sender name/id in the payload is discarded.
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, message: "That message could not be sent." });
      ack(roomManager.sendChat(socket, parsed.data.text, parsed.data.clientMessageId));
    });

    handle("chat:history", (_payload, ack) => {
      ack(roomManager.chatHistory(socket));
    });

    socket.on("disconnect", () => {
      try {
        roomManager.disconnect(socket);
      } catch (error) {
        console.error("[socket] disconnect handler failed:", error);
      }
    });
  });
}
