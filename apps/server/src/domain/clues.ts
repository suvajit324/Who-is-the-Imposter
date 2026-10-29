export function normalizeClue(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function validateClue(raw: string, existing: string[], forbiddenWords: string[]): string | null {
  const clue = raw.trim();
  if (!clue) return "Enter a clue before submitting.";
  if (/\s/.test(clue)) return "Clues must be a single word.";
  if (clue.length > 24) return "Clues must be 24 characters or fewer.";

  const normalized = normalizeClue(clue);
  if (!normalized) return "Use at least one letter or number.";
  if (existing.map(normalizeClue).includes(normalized)) return "That clue has already been used.";
  if (forbiddenWords.map(normalizeClue).includes(normalized)) return "Your clue cannot be the secret word.";
  return null;
}
