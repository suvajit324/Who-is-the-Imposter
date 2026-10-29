export function selectImposter(playerIds: string[], counts: Record<string, number>): string {
  if (playerIds.length === 0) throw new Error("Cannot select an imposter without players.");
  const sorted = [...playerIds].sort((a, b) => {
    const byCount = (counts[a] ?? 0) - (counts[b] ?? 0);
    return byCount === 0 ? a.localeCompare(b) : byCount;
  });
  return sorted[0];
}
