import { describe, expect, it } from "vitest";
import { defaultSettings } from "@imposter/shared";
import { fallbackWordBank } from "../src/data/wordBank.js";
import { validateClue } from "../src/domain/clues.js";
import { selectImposter } from "../src/domain/imposter.js";
import { calculateScores, rankPlayers } from "../src/domain/scoring.js";
import { resolveVotes, validateVote } from "../src/domain/voting.js";
import { selectWordPair } from "../src/domain/words.js";

describe("imposter selection", () => {
  it("selects the player with the lowest imposter count deterministically", () => {
    expect(selectImposter(["b", "a", "c"], { a: 1, b: 0, c: 0 })).toBe("b");
    expect(selectImposter(["b", "a", "c"], { a: 0, b: 0, c: 0 })).toBe("a");
  });
});

describe("word selection", () => {
  it("filters by category and difficulty and avoids used pairs", () => {
    const settings = { ...defaultSettings, categories: ["Food" as const], difficulty: "Easy" as const };
    const first = selectWordPair(fallbackWordBank, settings, new Set(), () => 0);
    expect(first.category).toBe("Food");
    expect(first.difficulty).toBe("Easy");
    const second = selectWordPair(fallbackWordBank, settings, new Set([first.id]), () => 0);
    expect(second.id).not.toBe(first.id);
  });
});

describe("clue validation", () => {
  it("rejects empty, multi-word, duplicate, and exact secret clues", () => {
    expect(validateClue("", [], ["Pizza"])).toMatch(/Enter/);
    expect(validateClue("hot dog", [], ["Pizza"])).toMatch(/single/);
    expect(validateClue("Crunchy!", ["crunchy"], ["Pizza"])).toMatch(/already/);
    expect(validateClue("pizza", [], ["Pizza"])).toMatch(/secret/);
  });

  it("accepts a unique single-word clue", () => {
    expect(validateClue("melty", ["crispy"], ["Pizza"])).toBeNull();
  });
});

describe("voting", () => {
  it("prevents self voting and ineligible targets", () => {
    expect(validateVote("a", "a", ["a", "b"])).toMatch(/yourself/);
    expect(validateVote("a", "c", ["a", "b"])).toMatch(/eligible/);
    expect(validateVote("a", "b", ["a", "b"])).toBeNull();
  });

  it("selects a unique highest vote getter and counts abstentions", () => {
    const outcome = resolveVotes(new Map([["a", "b"], ["c", "b"]]), ["a", "b", "c"]);
    expect(outcome.selectedPlayerId).toBe("b");
    expect(outcome.abstentions).toBe(1);
  });

  it("detects a tie and unresolved runoff", () => {
    const tied = resolveVotes(new Map([["a", "b"], ["c", "a"]]), ["a", "b", "c"]);
    expect(tied.tiedPlayerIds).toEqual(["a", "b"]);
    const runoff = resolveVotes(new Map([["c", "a"], ["b", "c"]]), ["a", "b", "c"], ["a", "c"], true);
    expect(runoff.unresolvedTie).toBe(true);
    expect(runoff.selectedPlayerId).toBeNull();
  });

  it("treats zero votes as no selected player", () => {
    expect(resolveVotes(new Map(), ["a", "b", "c"]).selectedPlayerId).toBeNull();
  });
});

describe("scoring", () => {
  it("awards normal correct votes, majority bonus, and escape points", () => {
    const caught = calculateScores({
      playerIds: ["a", "b", "c"],
      imposterId: "a",
      votes: new Map([["b", "a"], ["c", "a"]]),
      selectedPlayerId: "a",
      imposterGuessCorrect: false
    });
    expect(caught).toEqual({ a: 0, b: 3, c: 3 });

    const escaped = calculateScores({
      playerIds: ["a", "b", "c"],
      imposterId: "a",
      votes: new Map([["b", "c"]]),
      selectedPlayerId: "c",
      imposterGuessCorrect: false
    });
    expect(escaped.a).toBe(2);
  });

  it("awards the imposter word guess only when caught", () => {
    const scores = calculateScores({
      playerIds: ["a", "b", "c"],
      imposterId: "a",
      votes: new Map([["b", "a"], ["c", "a"]]),
      selectedPlayerId: "a",
      imposterGuessCorrect: true
    });
    expect(scores.a).toBe(2);
  });

  it("keeps shared ranks for equal scores", () => {
    expect(rankPlayers({ a: 4, b: 4, c: 1 }).map((row) => row.rank)).toEqual([1, 1, 3]);
  });
});
