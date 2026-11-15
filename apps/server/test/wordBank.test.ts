import { describe, expect, it, vi } from "vitest";
import { categorySchema, defaultSettings, difficultySchema, type GameSettings } from "@imposter/shared";
import { fallbackWordBank, type WordPair } from "../src/data/wordBank.js";
import { formatWordBankReport, rejectedWordPairs, reviewWordBank, type ReviewOptions } from "../src/data/wordPairReview.js";
import { assignPairWords, isPlayableWordPair, matchingWordPairs, normalizeWord, selectWordPair } from "../src/domain/words.js";

const pairKey = (a: string, b: string) => [normalizeWord(a), normalizeWord(b)].sort().join("|");
const bankKeys = new Set(fallbackWordBank.map((pair) => pairKey(pair.wordA, pair.wordB)));
const settings = (patch: Partial<GameSettings> = {}): GameSettings => ({ ...defaultSettings, ...patch });

/** A well-formed pair; override fields to build test cases (including malformed ones). */
function entry(overrides: Record<string, unknown> = {}): WordPair {
  return { id: "test-01", wordA: "Mountain", wordB: "Volcano", category: "Nature", difficulty: "Medium", tags: ["landform"], ...overrides } as WordPair;
}

/** Review without the moderation pass unless a test asks for it (keeps unit cases focused). */
function review(entries: unknown[], options: ReviewOptions = {}) {
  return reviewWordBank(entries, { moderation: null, ...options });
}

function rulesAt(entries: unknown[], index: number, options: ReviewOptions = {}) {
  return review(entries, options).issues.filter((issue) => issue.index === index).map((issue) => issue.rule);
}

describe("curated word bank", () => {
  it("passes the full word-pair review, including the chat-moderation check, with nothing left unreviewed", () => {
    const report = reviewWordBank(fallbackWordBank);
    expect(report.errors, formatWordBankReport(report)).toEqual([]);
    expect(report.warnings, formatWordBankReport(report)).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("has at least 100 pairs, and at least three for every category and difficulty", () => {
    expect(fallbackWordBank.length).toBeGreaterThanOrEqual(100);
    const { coverage } = reviewWordBank(fallbackWordBank, { moderation: null });
    for (const category of categorySchema.options) {
      for (const difficulty of difficultySchema.options) {
        expect(coverage[category][difficulty], `${category} / ${difficulty}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("never pairs a word with itself, ignoring case, spacing and punctuation", () => {
    for (const pair of fallbackWordBank) expect(normalizeWord(pair.wordA), pair.id).not.toBe(normalizeWord(pair.wordB));
  });

  it("has unique ids and no duplicate pairs, in either order", () => {
    expect(new Set(fallbackWordBank.map((pair) => pair.id)).size).toBe(fallbackWordBank.length);
    expect(bankKeys.size).toBe(fallbackWordBank.length);
  });

  it("uses only valid categories and difficulties, and records what links every pair", () => {
    for (const pair of fallbackWordBank) {
      expect(categorySchema.safeParse(pair.category).success, pair.id).toBe(true);
      expect(difficultySchema.safeParse(pair.difficulty).success, pair.id).toBe(true);
      expect(pair.tags.length, pair.id).toBeGreaterThan(0);
      expect(isPlayableWordPair(pair), pair.id).toBe(true);
    }
  });

  it("excludes Mountain / Hill (regression) and every other reviewed-and-rejected pair, in either order", () => {
    expect(bankKeys.has(pairKey("Mountain", "Hill"))).toBe(false);
    expect(fallbackWordBank.some((pair) => [pair.wordA, pair.wordB].some((word) => normalizeWord(word) === "hill"))).toBe(false);
    for (const rejected of rejectedWordPairs) {
      expect(bankKeys.has(pairKey(...rejected.words)), rejected.words.join(" / ")).toBe(false);
    }
  });
});

describe("word-pair review", () => {
  it("rejects empty and malformed entries", () => {
    const entries: unknown[] = [
      null,
      42,
      entry({ wordA: "" }),
      entry({ wordB: "   " }),
      entry({ wordA: "Pizza!!" }),
      entry({ wordA: 7 }),
      entry({ wordA: " Volcano " }),
      entry({ wordA: "Supercalifragilisticexpialidocious" }),
      entry({ category: undefined }),
      entry({ category: "Planets" }),
      entry({ difficulty: "" }),
      entry({ difficulty: "Extreme" }),
      entry({ tags: [] }),
      entry({ tags: ["Not Kebab"] }),
      entry({ id: "" }),
      entry({ id: "Bad Id" })
    ];
    const expected = [
      "invalid-entry", "invalid-entry", "empty-word", "empty-word", "invalid-word", "invalid-word", "invalid-word", "invalid-word",
      "missing-category", "invalid-category", "missing-difficulty", "invalid-difficulty", "missing-tags", "invalid-tag", "invalid-id", "invalid-id"
    ];
    const report = review(entries);
    expected.forEach((rule, index) => expect(rulesAt(entries, index), `entry #${index}`).toContain(rule));
    expect(report.errors.length).toBeGreaterThanOrEqual(expected.length);
    expect(report.passed).toBe(false);

    // The runtime never deals entries with unusable words, category, difficulty or id.
    const unplayable = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14];
    for (const index of unplayable) expect(isPlayableWordPair(entries[index]), `entry #${index}`).toBe(false);
  });

  it("detects identical words, plural variants, exact and case-insensitive duplicates, reversed duplicates and reused ids", () => {
    const entries = [
      entry({ id: "dup-01", wordA: "Lion", wordB: "LION" }),
      entry({ id: "dup-02", wordA: "Tiger", wordB: "Tigers" }),
      entry({ id: "dup-03", wordA: "Pizza", wordB: "Burger" }),
      entry({ id: "dup-04", wordA: "Pizza", wordB: "Burger" }),
      entry({ id: "dup-05", wordA: "pizza", wordB: "BURGER" }),
      entry({ id: "dup-06", wordA: "Burger", wordB: "Pizza" }),
      entry({ id: "dup-06", wordA: "Rose", wordB: "Sunflower" })
    ];
    expect(rulesAt(entries, 0)).toContain("identical-words");
    expect(rulesAt(entries, 1)).toContain("word-variant");
    expect(rulesAt(entries, 2)).toEqual([]);
    expect(rulesAt(entries, 3)).toContain("duplicate-pair");
    expect(rulesAt(entries, 4)).toContain("duplicate-pair");
    expect(rulesAt(entries, 5)).toContain("reversed-duplicate");
    expect(rulesAt(entries, 6)).toContain("duplicate-id");
  });

  it.each([
    ["Mountain", "Hill"],
    ["Sofa", "Couch"],
    ["Ocean", "Sea"],
    ["Road", "Street"],
    ["Cup", "Mug"],
    ["Bicycle", "Bike"],
    ["Doctor", "Physician"],
    ["Laptop", "Notebook"]
  ])("blocks %s / %s, and flags it as a near-synonym even without the rejected list", (wordA, wordB) => {
    for (const [first, second] of [[wordA, wordB], [wordB.toLowerCase(), wordA.toUpperCase()]]) {
      const report = review([entry({ wordA: first, wordB: second })]);
      expect(report.errors.map((issue) => issue.rule)).toContain("rejected-pair");
      expect(report.passed).toBe(false);
    }
    const unlisted = review([entry({ wordA, wordB })], { rejected: [] });
    expect(unlisted.warnings.map((issue) => issue.rule)).toContain("near-synonym");
    expect(unlisted.passed).toBe(false);
  });

  it("flags look-alike words for human review", () => {
    expect(rulesAt([entry({ wordA: "Pancake", wordB: "Cupcake" })], 0)).toContain("shared-stem");
    expect(rulesAt([entry({ wordA: "Password", wordB: "Passport" })], 0)).toContain("shared-stem");
    expect(rulesAt([entry({ wordA: "Pen", wordB: "Pencil" })], 0)).toContain("contains-word");
    expect(rulesAt([entry({ wordA: "Theatre", wordB: "Theater" })], 0)).toContain("similar-spelling");
    expect(rulesAt([entry({ wordA: "Desert", wordB: "Dessert" })], 0)).toContain("similar-spelling");
    expect(rulesAt([entry({ wordA: "Ice cream", wordB: "Popsicle" })], 0)).toContain("multi-word");
    const report = review([entry({ wordA: "Pancake", wordB: "Cupcake" })]);
    expect(report.issues.every((issue) => issue.severity === "warning")).toBe(true);
    expect(report.passed).toBe(false);
  });

  it("judges gameplay, not similarity: neither unrelated nor related words are rejected automatically", () => {
    // Low similarity is not an error (whether a pair links well enough is a human decision)...
    expect(reviewWordBank([entry({ wordA: "Telescope", wordB: "Banana", category: "Mixed" })]).issues).toEqual([]);
    // ...and neither is high relatedness, as long as the words are distinct things.
    expect(reviewWordBank([entry({ wordA: "Mountain", wordB: "Volcano" })]).issues).toEqual([]);
    expect(reviewWordBank([entry({ wordA: "Glacier", wordB: "Iceberg" })]).issues).toEqual([]);
  });

  it("lets a reviewer accept a flagged pair with a reason, but never an error", () => {
    const flagged = [entry({ wordA: "Pancake", wordB: "Cupcake" })];
    const accepted = review(flagged, { acknowledged: [{ words: ["cupcake", "PANCAKE"], rules: ["shared-stem"], note: "Reviewed." }] });
    expect(accepted.warnings).toEqual([]);
    expect(accepted.acknowledged.map((issue) => issue.acknowledgement)).toEqual(["Reviewed."]);
    expect(accepted.passed).toBe(true);

    const blocked = review([entry({ wordA: "Mountain", wordB: "Hill" })], {
      acknowledged: [{ words: ["Mountain", "Hill"], rules: ["rejected-pair", "near-synonym"], note: "Trying to force it in." }]
    });
    expect(blocked.errors.map((issue) => issue.rule)).toEqual(["rejected-pair"]);
    expect(blocked.passed).toBe(false);
  });

  it("reports a pair as an error when chat moderation would hold back the partner word", () => {
    // "Water" reads as "Waiter" with a dropped letter; "Flower" is most of "Sunflower".
    for (const [wordA, wordB] of [["Waiter", "Water"], ["Sunflower", "Flower"]]) {
      const report = reviewWordBank([entry({ wordA, wordB, category: "Mixed" })]);
      expect(report.errors.map((issue) => issue.rule), `${wordA} / ${wordB}`).toContain("moderation-conflict");
    }
    // A merely related pair is fine.
    expect(reviewWordBank([entry({ wordA: "Chef", wordB: "Bartender", category: "Professions" })]).errors).toEqual([]);
  });

  it("prints a readable report naming each flagged pair and why", () => {
    const text = formatWordBankReport(review([entry({ id: "places-05", wordA: "Mountain", wordB: "Hill" })]));
    expect(text).toContain("places-05  Mountain / Hill  [rejected-pair]");
    expect(text).toContain("[near-synonym]");
    expect(text).toContain("Result: FAILED");
  });
});

describe("word selection", () => {
  const foodEasy = [
    entry({ id: "food-a", wordA: "Pizza", wordB: "Burger", category: "Food", difficulty: "Easy" }),
    entry({ id: "food-b", wordA: "Sushi", wordB: "Taco", category: "Food", difficulty: "Easy" }),
    entry({ id: "food-c", wordA: "Soup", wordB: "Salad", category: "Food", difficulty: "Easy" }),
    entry({ id: "food-d", wordA: "Honey", wordB: "Jam", category: "Food", difficulty: "Easy" })
  ];
  const foodSettings = settings({ categories: ["Food"], difficulty: "Easy" });
  /** Mirrors the room: re-insert on use so the Set stays least -> most recently used. */
  const markUsed = (used: Set<string>, id: string) => {
    used.delete(id);
    used.add(id);
  };

  it("only ever deals structurally valid pairs", () => {
    const valid = entry({ id: "valid", wordA: "Lion", wordB: "Tiger", category: "Animals", difficulty: "Easy" });
    const bank = [
      entry({ id: "bad-empty", wordA: "", category: "Animals", difficulty: "Easy" }),
      entry({ id: "bad-same", wordA: "Lion", wordB: "LION", category: "Animals", difficulty: "Easy" }),
      entry({ id: "bad-symbols", wordA: "<script>", category: "Animals", difficulty: "Easy" }),
      entry({ id: "bad-category", category: "Planets", difficulty: "Easy" }),
      entry({ id: "bad-difficulty", category: "Animals", difficulty: "Extreme" }),
      entry({ id: "", category: "Animals", difficulty: "Easy" }),
      null as unknown as WordPair,
      valid
    ];
    const animals = settings({ categories: ["Animals"], difficulty: "Any" });
    expect(matchingWordPairs(bank, animals)).toEqual([valid]);
    for (let draw = 0; draw < 25; draw += 1) expect(selectWordPair(bank, animals, new Set())).toBe(valid);
  });

  it("throws when no valid pair matches, which is how a room refuses to start", () => {
    const broken = [entry({ wordA: "Lion", wordB: "lion", category: "Animals", difficulty: "Easy" })];
    const animals = settings({ categories: ["Animals"] });
    expect(matchingWordPairs(broken, animals)).toEqual([]);
    expect(() => selectWordPair(broken, animals, new Set())).toThrow(/No word pairs match/);
    expect(() => selectWordPair(fallbackWordBank, settings({ categories: [] }), new Set())).toThrow(/No word pairs match/);
  });

  it("respects the category and difficulty settings", () => {
    for (const category of categorySchema.options) {
      for (const difficulty of difficultySchema.options) {
        const matches = matchingWordPairs(fallbackWordBank, settings({ categories: [category], difficulty }));
        expect(matches.length).toBeGreaterThanOrEqual(3);
        expect(matches.every((pair) => pair.category === category && pair.difficulty === difficulty)).toBe(true);
      }
      const any = matchingWordPairs(fallbackWordBank, settings({ categories: [category], difficulty: "Any" }));
      expect(any).toEqual(fallbackWordBank.filter((pair) => pair.category === category));
    }
  });

  it("never repeats a pair while unused alternatives remain", () => {
    for (const bankSettings of [foodSettings, settings({ categories: ["Nature"], difficulty: "Any" }), defaultSettings]) {
      const bank = bankSettings === foodSettings ? foodEasy : fallbackWordBank;
      const eligible = matchingWordPairs(bank, bankSettings).length;
      const used = new Set<string>();
      for (let round = 0; round < eligible; round += 1) {
        const pair = selectWordPair(bank, bankSettings, used);
        expect(used.has(pair.id), `round ${round + 1} repeated ${pair.id}`).toBe(false);
        markUsed(used, pair.id);
      }
      expect(used.size).toBe(eligible);
    }
  });

  it("once every matching pair has been dealt, holds back the most recent half", () => {
    const allUsed = new Set(["food-a", "food-b", "food-c", "food-d"]); // oldest first
    for (let index = 0; index < 2; index += 1) {
      expect(["food-a", "food-b"]).toContain(selectWordPair(foodEasy, foodSettings, allUsed, () => index).id);
    }
    const reordered = new Set(["food-c", "food-a", "food-d", "food-b"]);
    for (let index = 0; index < 2; index += 1) {
      expect(["food-c", "food-a"]).toContain(selectWordPair(foodEasy, foodSettings, reordered, () => index).id);
    }
    // Two pairs alternate; a single pair is still dealt rather than failing.
    expect(selectWordPair(foodEasy.slice(0, 2), foodSettings, new Set(["food-b", "food-a"]), () => 0).id).toBe("food-b");
    expect(selectWordPair(foodEasy.slice(0, 1), foodSettings, new Set(["food-a"]), () => 0).id).toBe("food-a");

    // Over many rounds with the real RNG, a pair never comes straight back.
    const used = new Set<string>();
    let previous: string | null = null;
    for (let round = 0; round < 60; round += 1) {
      const { id } = selectWordPair(foodEasy.slice(0, 3), foodSettings, used);
      expect(id).not.toBe(previous);
      markUsed(used, id);
      previous = id;
    }
  });

  it("assigns one word of the pair to each role, in either orientation", () => {
    const pair = foodEasy[0];
    expect(assignPairWords(pair, () => 0)).toEqual({ normalWord: "Pizza", imposterWord: "Burger" });
    expect(assignPairWords(pair, () => 1)).toEqual({ normalWord: "Burger", imposterWord: "Pizza" });
    const mainWords = new Set(Array.from({ length: 100 }, () => assignPairWords(pair).normalWord));
    expect(mainWords).toEqual(new Set(["Pizza", "Burger"]));
  });

  it("draws pairs and their orientation from a secure RNG, never the predictable Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    try {
      const used = new Set<string>();
      for (let round = 0; round < 40; round += 1) {
        const pair = selectWordPair(fallbackWordBank, defaultSettings, used);
        assignPairWords(pair);
        used.add(pair.id);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
