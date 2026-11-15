import "dotenv/config";
import { createGameServer } from "./app.js";
import { createPersistence } from "./persistence/index.js";
import { createStore } from "./store/index.js";

// Last line of defence: log unexpected promise failures instead of letting one of them
// shut down the process (and every room in it). Known failure points handle their own errors.
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled promise rejection:", reason);
});

const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const persistence = createPersistence(process.env.MONGODB_URI);
await persistence.connect();
const store = createStore(persistence.enabled);
await store.ready();

const { httpServer } = createGameServer({ clientOrigin, persistence, store });

httpServer.listen(port, () => {
  console.log(`Who's the Imposter server listening on http://localhost:${port}`);
  if (!persistence.enabled) {
    console.log("MongoDB is not configured: accounts and match records are kept in memory (demo mode) and reset when the server restarts.");
  }
});
