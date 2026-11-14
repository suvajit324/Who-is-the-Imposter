import type { GameSettings } from "@imposter/shared";
import type { WordPair } from "../data/wordBank.js";

export function matchingWordPairs(wordBank: WordPair[], settings: GameSettings): WordPair[] {
  return wordBank.filter((pair) => {
    const categoryOk = settings.categories.includes(pair.category);
    const difficultyOk = settings.difficulty === "Any" || pair.difficulty === settings.difficulty;
    return categoryOk && difficultyOk;
  });
}

export function selectWordPair(wordBank: WordPair[], settings: GameSettings, usedIds: Set<string>, random = Math.random): WordPair {
  const matches = matchingWordPairs(wordBank, settings);
  if (matches.length === 0) throw new Error("No word pairs match the selected settings.");

  const unused = matches.filter((pair) => !usedIds.has(pair.id));
  const pool = unused.length > 0 ? unused : matches;
  return pool[Math.floor(random() * pool.length)];
}
