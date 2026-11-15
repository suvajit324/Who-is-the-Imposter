import { MIN_PLAYERS, type AvatarId, type GameSettings, type MatchOutcome } from "@imposter/shared";
import type { MatchParticipantRecord, MatchRecord } from "../store/index.js";
import { rankPlayers } from "./scoring.js";

/** A seated player when the game ended, in seat (join) order. */
export type FinishedSeat = {
  /** In-room player id: used only to match the roster; never stored. */
  playerId: string;
  name: string;
  userId: string | null;
  avatar: AvatarId | null;
  score: number;
  connected: boolean;
};

export type FinishedGame = {
  gameId: string;
  startedAt: number;
  endedAt: number;
  settings: GameSettings;
  roundsPlayed: number;
  /** Players dealt into the game when the host started it. */
  rosterIds: ReadonlySet<string>;
  seats: FinishedSeat[];
};

export type MatchRecordDecision = { record: MatchRecord } | { record: null; reason: "too-few-players" | "no-accounts" | "no-rounds" };

/**
 * Builds the stored record for a game that reached the final results.
 *
 * Participants are the players who were dealt in at the start and are still seated at
 * the end. A player who disconnects stays seated (and keeps their score), so leaving
 * does not avoid a loss; a player removed by the host is not a participant.
 *
 * Outcomes follow the game's own rule (highest final score wins, equal top scores share
 * first place): first place is a win, everyone sharing first place is a draw, anything
 * else is a loss. Ranks are competition ranks (1, 1, 3).
 *
 * Games without enough participants, or without any signed-in player, are not stored.
 */
export function buildMatchRecord(game: FinishedGame): MatchRecordDecision {
  const seats = game.seats.filter((seat) => game.rosterIds.has(seat.playerId));
  if (game.roundsPlayed < 1) return { record: null, reason: "no-rounds" };
  if (seats.length < MIN_PLAYERS) return { record: null, reason: "too-few-players" };

  // Defensive: one account can never hold two results in the same game.
  const seenUsers = new Set<string>();
  const accountOf = (seat: FinishedSeat): string | null => {
    if (!seat.userId || seenUsers.has(seat.userId)) return null;
    seenUsers.add(seat.userId);
    return seat.userId;
  };
  const userIds = seats.map(accountOf);
  if (!userIds.some(Boolean)) return { record: null, reason: "no-accounts" };

  const ranks = new Map(rankPlayers(Object.fromEntries(seats.map((seat) => [seat.playerId, seat.score]))).map((row) => [row.playerId, row.rank]));
  const everyoneFirst = seats.every((seat) => ranks.get(seat.playerId) === 1);
  const outcomeFor = (rank: number): MatchOutcome => (everyoneFirst ? "draw" : rank === 1 ? "win" : "loss");

  const participants: MatchParticipantRecord[] = seats.map((seat, index) => {
    const finalRank = ranks.get(seat.playerId)!;
    const userId = userIds[index];
    return {
      seat: index + 1,
      userId,
      displayName: seat.name,
      avatar: userId ? seat.avatar : null,
      finalScore: seat.score,
      finalRank,
      outcome: outcomeFor(finalRank),
      connectedAtEnd: seat.connected
    };
  });

  return {
    record: {
      id: game.gameId,
      status: "completed",
      startedAt: new Date(game.startedAt),
      endedAt: new Date(game.endedAt),
      durationSeconds: Math.max(0, Math.round((game.endedAt - game.startedAt) / 1000)),
      // Every current game uses the reviewed word bank, so every completed game counts.
      counted: true,
      wordSource: "curated",
      settings: { categories: [...game.settings.categories], difficulty: game.settings.difficulty, rounds: game.settings.rounds },
      roundsPlayed: game.roundsPlayed,
      participants
    }
  };
}
