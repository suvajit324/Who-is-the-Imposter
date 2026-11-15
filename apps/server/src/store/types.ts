import type { AvatarId, GameSettings, MatchOutcome, StorageMode } from "@imposter/shared";

/**
 * Server-side records. These are internal: API responses are always built from the
 * allow-listed response schemas in @imposter/shared, never by returning a record.
 */

export type UserRecord = {
  /** Random UUID. Never sent to clients (the username is the public identifier). */
  id: string;
  /** Display casing chosen at registration. */
  username: string;
  /** Lower-cased username; unique. */
  usernameKey: string;
  /** scrypt hash string (see accounts/passwords.ts). */
  passwordHash: string;
  avatar: AvatarId;
  createdAt: Date;
};

export type SessionRecord = {
  /** SHA-256 of the session token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
};

export type MatchParticipantRecord = {
  /** 1-based position in this match; used instead of in-room player ids. */
  seat: number;
  /** Account id, or null for a guest. */
  userId: string | null;
  displayName: string;
  avatar: AvatarId | null;
  finalScore: number;
  finalRank: number;
  outcome: MatchOutcome;
};

export type MatchRoundRecord = {
  roundNumber: number;
  /** Null if the Imposter was removed from the room before the game ended. */
  imposterSeat: number | null;
  mainWord: string;
  imposterWord: string;
  imposterCaught: boolean;
  imposterGuessCorrect: boolean;
  points: Array<{ seat: number; points: number }>;
};

export type MatchRecord = {
  /** The game id assigned when the host started the game. Unique: a game is saved at most once. */
  id: string;
  startedAt: Date;
  endedAt: Date;
  /** Whether the game counts towards statistics and the leaderboard. */
  counted: boolean;
  wordSource: "curated" | "custom";
  settings: Pick<GameSettings, "categories" | "difficulty" | "rounds">;
  participants: MatchParticipantRecord[];
  rounds: MatchRoundRecord[];
};

export interface Store {
  /** Prepares the store (for MongoDB: makes sure the unique indexes exist). Call once before serving. */
  ready(): Promise<void>;
  /** Where data lives right now. Only "mongodb" means it survives a server restart. */
  storageMode(): StorageMode;

  createUser(user: UserRecord): Promise<"created" | "username-taken">;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByUsernameKey(usernameKey: string): Promise<UserRecord | null>;
  findUsersByIds(ids: readonly string[]): Promise<UserRecord[]>;
  updateUserAvatar(id: string, avatar: AvatarId): Promise<void>;

  createSession(session: SessionRecord): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  /** Saves a finished game. Saving the same game id again changes nothing and returns "duplicate". */
  saveMatch(match: MatchRecord): Promise<"saved" | "duplicate">;
  /** Newest first. */
  listMatchesForUser(userId: string, options?: { countedOnly?: boolean; limit?: number }): Promise<MatchRecord[]>;
  listCountedMatches(): Promise<MatchRecord[]>;
}
