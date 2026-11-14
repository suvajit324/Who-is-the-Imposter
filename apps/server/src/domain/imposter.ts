import { randomInt } from "node:crypto";

/**
 * Picks the next Imposter.
 *
 * Fairness: only players who have been the Imposter the fewest times are eligible.
 * Secrecy: among those, the choice is made with a cryptographically secure RNG.
 * It must never depend on anything players can see (player ids, names, join order),
 * otherwise anyone could compute the Imposter from public room state.
 */
export function selectImposter(
  playerIds: string[],
  counts: Record<string, number>,
  randomIndex: (exclusiveMax: number) => number = randomInt
): string {
  if (playerIds.length === 0) throw new Error("Cannot select an imposter without players.");
  const lowest = Math.min(...playerIds.map((id) => counts[id] ?? 0));
  const candidates = playerIds.filter((id) => (counts[id] ?? 0) === lowest);
  return candidates[randomIndex(candidates.length)];
}
