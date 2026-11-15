import { MemoryStore } from "./memoryStore.js";
import { MongoStore } from "./mongoStore.js";
import type { Store } from "./types.js";

export { MemoryStore } from "./memoryStore.js";
export { MongoStore } from "./mongoStore.js";
export type { MatchParticipantRecord, MatchRecord, MatchRoundRecord, SessionRecord, Store, UserRecord } from "./types.js";

/** MongoDB when a connection string is configured (and connected), otherwise the in-memory demo store. */
export function createStore(persistenceEnabled: boolean): Store {
  return persistenceEnabled ? new MongoStore() : new MemoryStore();
}
