import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@imposter/shared";
import { RoomManager } from "./domain/roomManager.js";
import { createPersistence } from "./persistence/index.js";
import { registerHandlers } from "./socket/registerHandlers.js";

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const persistence = createPersistence(process.env.MONGODB_URI);
await persistence.connect();

const app = express();
app.use(cors({ origin: clientOrigin }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "whos-the-imposter-server",
    persistenceEnabled: persistence.enabled
  });
});

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: clientOrigin,
    methods: ["GET", "POST"]
  }
});

const roomManager = new RoomManager(io, persistence);
registerHandlers(io, roomManager);

httpServer.listen(port, () => {
  console.log(`Who's the Imposter server listening on http://localhost:${port}`);
  if (!persistence.enabled) console.log("MongoDB is not configured; using in-memory rooms and fallback word bank only.");
});
