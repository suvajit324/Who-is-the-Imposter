import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, PublicRoomState, ServerToClientEvents } from "@imposter/shared";
import { AccountService, type AccountServiceOptions } from "./accounts/accountService.js";
import { toOrigin } from "./clientOrigin.js";
import { fallbackWordBank, type WordPair } from "./data/wordBank.js";
import { RoomManager } from "./domain/roomManager.js";
import { createApiRouter, jsonErrorHandler } from "./http/api.js";
import type { ModerationPolicy } from "./moderation/index.js";
import { attachSocketIdentity, disconnectSession } from "./socket/identity.js";
import { registerHandlers } from "./socket/registerHandlers.js";
import { MatchRecorder, type MatchRecorderOptions } from "./stats/matchRecorder.js";
import { StatsService } from "./stats/statsService.js";
import type { Store } from "./store/index.js";

export type GameServerOptions = {
  /** Origin of the web client (CORS for HTTP and Socket.IO). A path or trailing slash is ignored. */
  clientOrigin: string;
  persistence: { enabled: boolean; saveCompletedGame: (state: PublicRoomState) => Promise<void> };
  store: Store;
  wordBank?: WordPair[];
  moderationPolicy?: ModerationPolicy;
  accountOptions?: AccountServiceOptions;
  matchRecorderOptions?: MatchRecorderOptions;
  /** Room timing overrides; tests shorten the reconnect grace period. */
  roomOptions?: { reconnectGraceMs?: number };
};

/**
 * Builds the Express app, HTTP server, Socket.IO server and room manager without
 * listening, so index.ts and the tests share exactly the same wiring.
 */
export function createGameServer(options: GameServerOptions) {
  const clientOrigin = toOrigin(options.clientOrigin);
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    // Every response is JSON (or empty): never let a browser sniff it as something else.
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(cors({ origin: clientOrigin }));
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
      origin: clientOrigin,
      methods: ["GET", "POST"]
    }
  });

  const accounts = new AccountService(options.store, options.accountOptions);
  const stats = new StatsService(options.store);
  const matchRecorder = new MatchRecorder(options.store, options.matchRecorderOptions);
  app.use("/api", createApiRouter({ accounts, stats, onSessionRevoked: (hash) => disconnectSession(io, hash) }));
  app.use(jsonErrorHandler);

  attachSocketIdentity(io, accounts);
  const roomManager = new RoomManager(io, options.persistence, options.wordBank ?? fallbackWordBank, {
    moderationPolicy: options.moderationPolicy,
    matchSink: matchRecorder,
    reconnectGraceMs: options.roomOptions?.reconnectGraceMs
  });
  registerHandlers(io, roomManager);

  return { app, httpServer, io, roomManager, accounts, stats, matchRecorder };
}
