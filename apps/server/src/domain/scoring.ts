import type { RoundResult } from "@imposter/shared";

export const SCORE = {
  NORMAL_CORRECT_VOTE: 2,
  IMPOSTER_ESCAPE: 2,
  IMPOSTER_WORD_GUESS: 2,
  NORMAL_MAJORITY_BONUS: 1
} as const;

export type ScoreInput = {
  playerIds: string[];
  imposterId: string;
  votes: Map<string, string>;
  selectedPlayerId: string | null;
  imposterGuessCorrect: boolean;
};

export function calculateScores(input: ScoreInput): Record<string, number> {
  const points = Object.fromEntries(input.playerIds.map((id) => [id, 0]));
  for (const [voterId, targetId] of input.votes) {
    if (voterId !== input.imposterId && targetId === input.imposterId) {
      points[voterId] += SCORE.NORMAL_CORRECT_VOTE;
    }
  }

  const imposterCaught = input.selectedPlayerId === input.imposterId;
  if (!imposterCaught) points[input.imposterId] += SCORE.IMPOSTER_ESCAPE;
  if (imposterCaught && input.imposterGuessCorrect) points[input.imposterId] += SCORE.IMPOSTER_WORD_GUESS;

  const normalVoters = input.playerIds.filter((id) => id !== input.imposterId);
  const correctNormalVotes = normalVoters.filter((id) => input.votes.get(id) === input.imposterId).length;
  if (imposterCaught && correctNormalVotes > normalVoters.length / 2) {
    for (const id of normalVoters) points[id] += SCORE.NORMAL_MAJORITY_BONUS;
  }
  return points;
}

export function rankPlayers(scores: Record<string, number>): Array<{ playerId: string; score: number; rank: number }> {
  const rows = Object.entries(scores)
    .map(([playerId, score]) => ({ playerId, score, rank: 1 }))
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId));
  let previousScore: number | null = null;
  let rank = 0;
  rows.forEach((row, index) => {
    if (row.score !== previousScore) rank = index + 1;
    row.rank = rank;
    previousScore = row.score;
  });
  return rows;
}

export function resultSummary(result: RoundResult): string {
  if (!result.selectedPlayerId) return "The vote did not identify anyone. The Imposter escaped.";
  return result.correct ? "The group found the Imposter." : "The group accused the wrong player.";
}
