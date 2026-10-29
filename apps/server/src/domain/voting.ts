import type { VoteOutcome } from "@imposter/shared";

export function resolveVotes(votes: Map<string, string>, eligiblePlayerIds: string[], candidateIds = eligiblePlayerIds, runoff = false): VoteOutcome {
  const counts: Record<string, number> = Object.fromEntries(candidateIds.map((id) => [id, 0]));
  let totalVotes = 0;
  for (const [voterId, targetId] of votes) {
    if (!eligiblePlayerIds.includes(voterId) || !candidateIds.includes(targetId) || voterId === targetId) continue;
    counts[targetId] += 1;
    totalVotes += 1;
  }

  const highest = Math.max(0, ...Object.values(counts));
  const tiedPlayerIds = candidateIds.filter((id) => counts[id] === highest);
  const unresolvedTie = tiedPlayerIds.length > 1;
  return {
    selectedPlayerId: highest > 0 && !unresolvedTie ? tiedPlayerIds[0] : null,
    tiedPlayerIds: highest > 0 && unresolvedTie ? tiedPlayerIds : [],
    runoff,
    unresolvedTie: runoff && unresolvedTie,
    totalVotes,
    abstentions: Math.max(0, eligiblePlayerIds.length - totalVotes),
    counts
  };
}

export function validateVote(voterId: string, targetId: string, eligibleIds: string[], candidateIds = eligibleIds): string | null {
  if (!eligibleIds.includes(voterId)) return "You are not eligible to vote.";
  if (!candidateIds.includes(targetId)) return "That player is not an eligible vote target.";
  if (voterId === targetId) return "You cannot vote for yourself.";
  return null;
}
