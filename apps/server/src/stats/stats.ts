import { LEADERBOARD_SIZE, type AvatarId, type LeaderboardEntry, type MatchHistoryEntry, type PlayerStats } from "@imposter/shared";
import type { MatchRecord } from "../store/index.js";

/*
 * Statistics are always computed from the stored completed-match records (never from
 * separately incremented counters or anything a client sends), so a game can only ever
 * count once and every number can be re-derived at any time. Only "counted" matches
 * contribute; cancelled games are never stored at all.
 */

type Totals = { gamesPlayed: number; wins: number; draws: number; losses: number; totalPoints: number; bestScore: number | null };

const emptyTotals = (): Totals => ({ gamesPlayed: 0, wins: 0, draws: 0, losses: 0, totalPoints: 0, bestScore: null });

/** wins / games as a percentage with one decimal place; null when no games were played. */
export function winRatePercent(wins: number, gamesPlayed: number): number | null {
  return gamesPlayed === 0 ? null : Math.round((wins / gamesPlayed) * 1000) / 10;
}

function add(totals: Totals, result: { outcome: string; finalScore: number }): void {
  totals.gamesPlayed += 1;
  totals.totalPoints += result.finalScore;
  totals.bestScore = Math.max(totals.bestScore ?? 0, result.finalScore);
  if (result.outcome === "win") totals.wins += 1;
  else if (result.outcome === "draw") totals.draws += 1;
  else totals.losses += 1;
}

export function computeStats(userId: string, matches: readonly MatchRecord[]): PlayerStats {
  const totals = emptyTotals();
  for (const match of matches) {
    if (!match.counted) continue;
    const mine = match.participants.find((participant) => participant.userId === userId);
    if (mine) add(totals, mine);
  }
  return { ...totals, winRatePercent: winRatePercent(totals.wins, totals.gamesPlayed) };
}

/**
 * One match as shown in the player's own history. Built field by field: final scores and
 * ranks only. Account ids, seats, words, clues, roles and votes are never included.
 */
export function toHistoryEntry(userId: string, match: MatchRecord): MatchHistoryEntry | null {
  const mine = match.participants.find((participant) => participant.userId === userId);
  if (!mine) return null;
  return {
    endedAt: match.endedAt.toISOString(),
    durationSeconds: match.durationSeconds,
    roundsPlayed: Math.max(1, match.roundsPlayed),
    finalScore: mine.finalScore,
    finalRank: mine.finalRank,
    outcome: mine.outcome,
    counted: match.counted,
    participants: [...match.participants]
      .sort((a, b) => a.finalRank - b.finalRank || a.seat - b.seat)
      .map((participant) => ({
        name: participant.displayName,
        username: participant.userId ? participant.displayName : null,
        avatar: participant.userId ? participant.avatar : null,
        finalScore: participant.finalScore,
        finalRank: participant.finalRank,
        you: participant === mine
      }))
  };
}

type Ranked = Totals & { username: string; avatar: AvatarId };

/**
 * Leaderboard order:
 *  1. more wins;
 *  2. higher win rate (compared exactly, as fractions);
 *  3. more total points.
 * Players equal on all three share a rank (1, 2, 2, 4) and are listed alphabetically.
 */
export function compareLeaderboardRows(a: Ranked, b: Ranked): number {
  return b.wins - a.wins || b.wins * a.gamesPlayed - a.wins * b.gamesPlayed || b.totalPoints - a.totalPoints;
}

/** All-time leaderboard of signed-in players over counted matches. Guests never appear. */
export function computeLeaderboard(
  matches: readonly MatchRecord[],
  users: ReadonlyMap<string, { username: string; avatar: AvatarId }>,
  size = LEADERBOARD_SIZE
): LeaderboardEntry[] {
  const totals = new Map<string, Totals>();
  for (const match of matches) {
    if (!match.counted) continue;
    for (const participant of match.participants) {
      if (!participant.userId) continue;
      const row = totals.get(participant.userId) ?? emptyTotals();
      add(row, participant);
      totals.set(participant.userId, row);
    }
  }

  const rows: Ranked[] = [...totals.entries()]
    .flatMap(([userId, row]) => {
      const user = users.get(userId);
      return user ? [{ ...row, username: user.username, avatar: user.avatar }] : [];
    })
    .sort((a, b) => compareLeaderboardRows(a, b) || a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

  let rank = 0;
  return rows.slice(0, size).map((row, index) => {
    if (index === 0 || compareLeaderboardRows(rows[index - 1], row) !== 0) rank = index + 1;
    return {
      rank,
      username: row.username,
      avatar: row.avatar,
      gamesPlayed: row.gamesPlayed,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      winRatePercent: winRatePercent(row.wins, row.gamesPlayed) ?? 0,
      totalPoints: row.totalPoints
    };
  });
}
