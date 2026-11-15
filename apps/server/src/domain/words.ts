import { randomInt } from "node:crypto";
import { categorySchema, difficultySchema, type GameSettings } from "@imposter/shared";
import type { WordPair } from "../data/wordBank.js";

/** Returns an integer in [0, exclusiveMax). Injectable so tests can be deterministic. */
export type RandomIndex = (exclusiveMax: number) => number;

/** Longest word the game will deal (clues are capped at 24 characters too). */
export const MAX_WORD_LENGTH = 24;

/** Letters, optionally joined by single spaces, hyphens or apostrophes ("Ice cream", "T-shirt"). */
const WORD_PATTERN = /^\p{L}+(?:[ '-]\p{L}+)*$/u;

const CATEGORIES: readonly string[] = categorySchema.options;
const DIFFICULTIES: readonly string[] = difficultySchema.options;

/** Case/spacing/punctuation-insensitive form, used to tell whether two words are really the same word. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function isPlayableWord(word: unknown): word is string {
  return typeof word === "string" && word.length <= MAX_WORD_LENGTH && WORD_PATTERN.test(word);
}

/**
 * Cheap structural check applied at selection time, so a malformed entry (empty or identical
 * words, unknown category or difficulty) can never be dealt to players. Gameplay quality
 * (synonyms, look-alike words) is a development-time review concern: see data/wordPairReview.ts.
 */
export function isPlayableWordPair(pair: unknown): pair is WordPair {
  if (!pair || typeof pair !== "object") return false;
  const { id, wordA, wordB, category, difficulty } = pair as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    isPlayableWord(wordA) &&
    isPlayableWord(wordB) &&
    normalizeWord(wordA) !== normalizeWord(wordB) &&
    typeof category === "string" &&
    CATEGORIES.includes(category) &&
    typeof difficulty === "string" &&
    DIFFICULTIES.includes(difficulty)
  );
}

export function matchingWordPairs(wordBank: readonly WordPair[], settings: GameSettings): WordPair[] {
  return wordBank.filter((pair) => {
    if (!isPlayableWordPair(pair)) return false;
    const categoryOk = settings.categories.includes(pair.category);
    const difficultyOk = settings.difficulty === "Any" || pair.difficulty === settings.difficulty;
    return categoryOk && difficultyOk;
  });
}

/**
 * Picks the next word pair for a room.
 *
 * - Only structurally valid pairs matching the room's categories and difficulty are eligible.
 * - Pairs in `usedIds` are skipped while any unused eligible pair remains.
 * - Once every eligible pair has been used, the most recently used half is still skipped, so a
 *   pair never comes straight back. This relies on `usedIds` being ordered from least to most
 *   recently used (Set insertion order; the room re-inserts a pair each time it is dealt).
 * - The draw uses a cryptographically secure RNG by default: like the Imposter choice, the
 *   upcoming pair must not be predictable from earlier rounds.
 */
export function selectWordPair(
  wordBank: readonly WordPair[],
  settings: GameSettings,
  usedIds: ReadonlySet<string> = new Set(),
  randomIndex: RandomIndex = randomInt
): WordPair {
  const matches = matchingWordPairs(wordBank, settings);
  if (matches.length === 0) throw new Error("No word pairs match the selected settings.");

  const unused = matches.filter((pair) => !usedIds.has(pair.id));
  const pool = unused.length > 0 ? unused : leastRecentlyUsed(matches, usedIds);
  return pool[randomIndex(pool.length)];
}

/** The older half (rounded up) of pairs that have all been used, oldest first. */
function leastRecentlyUsed(pairs: WordPair[], usedIds: ReadonlySet<string>): WordPair[] {
  const position = new Map([...usedIds].map((id, index) => [id, index]));
  const oldestFirst = [...pairs].sort((a, b) => (position.get(a.id) ?? -1) - (position.get(b.id) ?? -1));
  return oldestFirst.slice(0, Math.ceil(oldestFirst.length / 2));
}

/** Randomly decides which word of the pair is the main word and which goes to the Imposter. */
export function assignPairWords(pair: WordPair, randomIndex: RandomIndex = randomInt): { normalWord: string; imposterWord: string } {
  return randomIndex(2) === 0
    ? { normalWord: pair.wordA, imposterWord: pair.wordB }
    : { normalWord: pair.wordB, imposterWord: pair.wordA };
}
