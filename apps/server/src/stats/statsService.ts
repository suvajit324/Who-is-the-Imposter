import {
  MATCH_HISTORY_PAGE_SIZE,
  leaderboardResponseSchema,
  matchHistoryResponseSchema,
  profileResponseSchema,
  type LeaderboardResponse,
  type MatchHistoryResponse,
  type ProfileResponse
} from "@imposter/shared";
import { toAccount } from "../accounts/accountService.js";
import { usernameKey } from "../accounts/usernames.js";
import type { Store } from "../store/index.js";
import { computeLeaderboard, computeStats, toHistoryEntry } from "./stats.js";

/**
 * Read-only views of completed matches. Every response is validated against its strict
 * shared schema before it leaves the server, so an unexpected field cannot be sent.
 */
export class StatsService {
  constructor(
    private readonly store: Store,
    private readonly now: () => number = Date.now
  ) {}

  /** Public profile: account details and statistics, no match details. */
  async profile(username: string): Promise<ProfileResponse | null> {
    const user = await this.store.findUserByUsernameKey(usernameKey(username));
    if (!user) return null;
    const matches = await this.store.listMatchesForUser(user.id, { countedOnly: true });
    return profileResponseSchema.parse({ profile: toAccount(user), stats: computeStats(user.id, matches) });
  }

  /** The signed-in player's own completed matches, newest first. */
  async history(userId: string, page: number): Promise<MatchHistoryResponse> {
    const pageSize = MATCH_HISTORY_PAGE_SIZE;
    const totalMatches = await this.store.countMatchesForUser(userId);
    const matches = await this.store.listMatchesForUser(userId, { skip: (page - 1) * pageSize, limit: pageSize });
    return matchHistoryResponseSchema.parse({
      matches: matches.flatMap((match) => toHistoryEntry(userId, match) ?? []),
      page,
      pageSize,
      totalMatches,
      totalPages: Math.ceil(totalMatches / pageSize)
    });
  }

  async leaderboard(): Promise<LeaderboardResponse> {
    const matches = await this.store.listCountedMatches();
    const userIds = [...new Set(matches.flatMap((match) => match.participants.flatMap((participant) => participant.userId ?? [])))];
    const users = new Map((await this.store.findUsersByIds(userIds)).map((user) => [user.id, { username: user.username, avatar: user.avatar }]));
    return leaderboardResponseSchema.parse({ entries: computeLeaderboard(matches, users), generatedAt: new Date(this.now()).toISOString() });
  }
}
