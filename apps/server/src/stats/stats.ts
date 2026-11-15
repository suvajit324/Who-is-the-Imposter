import type { AvatarId, LeaderboardEntry, PlayerStats, RecentMatch } from "@imposter/shared";
import type { MatchRecord } from "../store/index.js";

/*
 * Statistics are always computed from the saved match records (never from separately
 * incremented counters), so a game can only ever be counted once and the numbers can
 * be re-derived at any time. Only "counted" matches contribute.
 */

export function computeStats(userId: string, matches: readonly MatchRecord[]): PlayerStats {
  const stats = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0, totalPoints: 0 };
  for (const match of matches) {
    if (!match.counted) continue;
    const me = match.participants.find((participant) => participant.userId === userId);
    if (!me) continue;
    stats.gamesPlayed += 1;
    stats.totalPoints += me.finalScore;
    if (me.outcome === "win") stats.wins += 1;
    else if (me.outcome === "draw") stats.draws += 1;
    else stats.losses += 1;
  }
  return {
    ...stats,
    winRatePercent: stats.gamesPlayed === 0 ? null : Math.round((stats.wins / stats.gamesPlayed) * 1000) / 10
  };
}

/** The player's own result in one match. No other player, word, clue or role is included. */
export function toRecentMatch(userId: string, match: MatchRecord): RecentMatch | null {
  const me = match.participants.find((participant) => participant.userId === userId);
  if (!me) return null;
  return {
    endedAt: match.endedAt.toISOString(),
    playerCount: match.participants.length,
    rounds: Math.max(1, match.rounds.length),
    finalScore: me.finalScore,
    finalRank: me.finalRank,
    outcome: me.outcome,
    counted: match.counted
  };
}

export const LEADERBOARD_SIZE = 50;

/**
 * All-time points leaderboard over counted matches. Players with equal totals share a
 * rank (1, 2, 2, 4); within a tie, rows are listed alphabetically.
 */
export function computeLeaderboard(
  matches: readonly MatchRecord[],
  users: ReadonlyMap<string, { username: string; avatar: AvatarId }>,
  size = LEADERBOARD_SIZE
): LeaderboardEntry[] {
  const totals = new Map<string, { totalPoints: number; gamesPlayed: number; wins: number }>();
  for (const match of matches) {
    if (!match.counted) continue;
    for (const participant of match.participants) {
      if (!participant.userId) continue;
      const row = totals.get(participant.userId) ?? { totalPoints: 0, gamesPlayed: 0, wins: 0 };
      row.totalPoints += participant.finalScore;
      row.gamesPlayed += 1;
      if (participant.outcome === "win") row.wins += 1;
      totals.set(participant.userId, row);
    }
  }

  const rows = [...totals.entries()]
    .flatMap(([userId, row]) => {
      const user = users.get(userId);
      return user ? [{ username: user.username, avatar: user.avatar, ...row }] : [];
    })
    .sort((a, b) => b.totalPoints - a.totalPoints || a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

  let rank = 0;
  let previous: number | null = null;
  return rows.slice(0, size).map((row, index) => {
    if (row.totalPoints !== previous) rank = index + 1;
    previous = row.totalPoints;
    return { rank, username: row.username, avatar: row.avatar, totalPoints: row.totalPoints, gamesPlayed: row.gamesPlayed, wins: row.wins };
  });
}
