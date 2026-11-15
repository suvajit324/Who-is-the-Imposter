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
  /** 1-based seat in join order; used instead of in-room player ids, which are never stored. */
  seat: number;
  /** Account id, or null for a guest. Guest results are never linked to an account. */
  userId: string | null;
  /** Name shown in the room (the username for signed-in players). */
  displayName: string;
  /** The account's avatar when the game ended; null for guests. */
  avatar: AvatarId | null;
  finalScore: number;
  /** Competition rank by final score (1, 1, 3, ...). */
  finalRank: number;
  outcome: MatchOutcome;
  /** Whether the player was connected when the game ended. */
  connectedAtEnd: boolean;
};

/**
 * A completed game. Only games that reached the final results are stored (cancelled
 * games never are). Deliberately minimal: no words, clues, roles, votes or room code.
 */
export type MatchRecord = {
  /** Random id assigned when the host started the game. Unique: a game is saved at most once. */
  id: string;
  status: "completed";
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  /** Whether the game counts towards statistics and the leaderboard. */
  counted: boolean;
  wordSource: "curated" | "custom";
  settings: Pick<GameSettings, "categories" | "difficulty" | "rounds">;
  roundsPlayed: number;
  participants: MatchParticipantRecord[];
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
  /** The user's matches, newest first (ties broken by id so paging is stable). */
  listMatchesForUser(userId: string, options?: { countedOnly?: boolean; limit?: number; skip?: number }): Promise<MatchRecord[]>;
  countMatchesForUser(userId: string, options?: { countedOnly?: boolean }): Promise<number>;
  listCountedMatches(): Promise<MatchRecord[]>;
}
