import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
import { AccountService, type AccountServiceOptions } from "./accounts/accountService.js";
import { fallbackWordBank, type WordPair } from "./data/wordBank.js";
import { RoomManager } from "./domain/roomManager.js";
import { createApiRouter, jsonErrorHandler } from "./http/api.js";
import type { ModerationPolicy } from "./moderation/index.js";
import { attachSocketIdentity, disconnectSession } from "./socket/identity.js";
import { registerHandlers } from "./socket/registerHandlers.js";
import type { Store } from "./store/index.js";

export type GameServerOptions = {
  /** Exact origin of the web client (CORS for HTTP and Socket.IO). */
  clientOrigin: string;
  persistence: { enabled: boolean; saveCompletedGame: (state: PublicRoomState) => Promise<void> };
  store: Store;
  wordBank?: WordPair[];
  moderationPolicy?: ModerationPolicy;
  accountOptions?: AccountServiceOptions;
};

/**
 * Builds the Express app, HTTP server, Socket.IO server and room manager without
 * listening, so index.ts and the tests share exactly the same wiring.
 */
export function createGameServer(options: GameServerOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: options.clientOrigin }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "whos-the-imposter-server",
      persistenceEnabled: options.persistence.enabled,
      storage: options.store.storageMode()
    });
  });

  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: options.clientOrigin,
      methods: ["GET", "POST"]
    }
  });

  const accounts = new AccountService(options.store, options.accountOptions);
  app.use("/api", createApiRouter({ accounts, onSessionRevoked: (hash) => disconnectSession(io, hash) }));
  app.use(jsonErrorHandler);

  attachSocketIdentity(io, accounts);
  const roomManager = new RoomManager(io, options.persistence, options.wordBank ?? fallbackWordBank, {
    moderationPolicy: options.moderationPolicy
  });
  registerHandlers(io, roomManager);

  return { app, httpServer, io, roomManager, accounts };
}
