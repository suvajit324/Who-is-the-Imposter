import type { AvatarId, StorageMode } from "@imposter/shared";
import type { MatchRecord, SessionRecord, Store, UserRecord } from "./types.js";

/**
 * In-memory store, used by the tests and as the clearly labelled demo mode when no
 * MongoDB is configured. Everything is lost when the server restarts.
 * Records are copied in and out so callers can never mutate stored state.
 */
export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private userIdsByKey = new Map<string, string>();
  private sessions = new Map<string, SessionRecord>();
  private matches = new Map<string, MatchRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async ready(): Promise<void> {}

  storageMode(): StorageMode {
    return "memory";
  }

  async createUser(user: UserRecord): Promise<"created" | "username-taken"> {
    if (this.userIdsByKey.has(user.usernameKey) || this.users.has(user.id)) return "username-taken";
    this.users.set(user.id, structuredClone(user));
    this.userIdsByKey.set(user.usernameKey, user.id);
    return "created";
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? structuredClone(user) : null;
  }

  async findUserByUsernameKey(usernameKey: string): Promise<UserRecord | null> {
    const id = this.userIdsByKey.get(usernameKey);
    return id ? this.findUserById(id) : null;
  }

  async findUsersByIds(ids: readonly string[]): Promise<UserRecord[]> {
    return ids.flatMap((id) => {
      const user = this.users.get(id);
      return user ? [structuredClone(user)] : [];
    });
  }

  async updateUserAvatar(id: string, avatar: AvatarId): Promise<void> {
    const user = this.users.get(id);
    if (user) user.avatar = avatar;
  }

  async createSession(session: SessionRecord): Promise<void> {
    this.pruneSessions();
    this.sessions.set(session.tokenHash, structuredClone(session));
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    return session ? structuredClone(session) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async saveMatch(match: MatchRecord): Promise<"saved" | "duplicate"> {
    if (this.matches.has(match.id)) return "duplicate";
    this.matches.set(match.id, structuredClone(match));
    return "saved";
  }

  async listMatchesForUser(userId: string, options: { countedOnly?: boolean; limit?: number; skip?: number } = {}): Promise<MatchRecord[]> {
    const rows = this.matchesFor(userId, options.countedOnly).sort(
      (a, b) => b.endedAt.getTime() - a.endedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
    const skip = options.skip ?? 0;
    return structuredClone(rows.slice(skip, options.limit === undefined ? undefined : skip + options.limit));
  }

  async countMatchesForUser(userId: string, options: { countedOnly?: boolean } = {}): Promise<number> {
    return this.matchesFor(userId, options.countedOnly).length;
  }

  async listCountedMatches(): Promise<MatchRecord[]> {
    return structuredClone([...this.matches.values()].filter((match) => match.counted));
  }

  private matchesFor(userId: string, countedOnly = false): MatchRecord[] {
    return [...this.matches.values()].filter(
      (match) => (!countedOnly || match.counted) && match.participants.some((participant) => participant.userId === userId)
    );
  }

  /** Expired sessions are useless; drop them so a long-running demo does not grow without bound. */
  private pruneSessions(): void {
    const now = this.now();
    for (const [hash, session] of this.sessions) {
      if (session.expiresAt.getTime() <= now) this.sessions.delete(hash);
    }
  }
}
