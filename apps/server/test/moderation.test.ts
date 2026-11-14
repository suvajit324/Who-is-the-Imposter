import { describe, expect, it } from "vitest";
import { fallbackWordBank } from "../src/data/wordBank.js";
import { buildRelationIndex, ChatModerationGate, createModerationEngine, defaultModerationPolicy, defaultWordRelations, type ModerationOutcome } from "../src/moderation/index.js";
import { lettersOf } from "../src/moderation/normalize.js";

const bankWords = fallbackWordBank.flatMap((pair) => [pair.wordA, pair.wordB]);
const engine = createModerationEngine({ bankWords });
const verdict = (text: string, word: string): ModerationOutcome => engine.moderate(text, [word]).outcome;
const concern = (text: string, word: string) => engine.moderate(text, [word]).concern;

const SECRET = "BLOCK_SECRET_DISCLOSURE";
const HINT = "BLOCK_INDIRECT_HINT";
const ABUSE = "BLOCK_ABUSIVE_CONTENT";
const REVIEW = "REVIEW_UNCERTAIN";
const ALLOW = "ALLOW";

describe("normalisation catches obfuscated spellings of the sender's word", () => {
  // The detection is word-agnostic, so any word works; "Funny" mirrors the spec's examples.
  it.each([
    "FUNNY", "funny", "F U N N Y", "f.u.n.n.y", "fu_nny", "fuuunnny", "f-u-n-n-y", "fu nny", "FuNnY", "f*u*n*n*y",
    "my word is funny!!!", "it's f u n n y lol", "fünny", `fun${String.fromCodePoint(0x043d)}y`.replace(String.fromCodePoint(0x043d), "n"),
    `funn${String.fromCodePoint(0x0443)}` // Cyrillic "u" look-alike for y
  ])("blocks %j for the word Funny", (text) => {
    expect(verdict(text, "Funny")).toBe(SECRET);
  });

  it("handles leetspeak, repeated letters and separators on real game words", () => {
    expect(verdict("t1ger", "Tiger")).toBe(SECRET);
    expect(verdict("T!GER", "Tiger")).toBe(SECRET);
    expect(verdict("tiiiiiger", "Tiger")).toBe(SECRET);
    expect(verdict("p1zz4", "Pizza")).toBe(SECRET);
    expect(verdict("piiizzzaaa", "Pizza")).toBe(SECRET);
    expect(verdict("c.o.f.f.e.e", "Coffee")).toBe(SECRET);
    expect(verdict("cof fee", "Coffee")).toBe(SECRET);
    expect(verdict("l 1 o n", "Lion")).toBe(SECRET);
  });
});

describe("secret disclosure", () => {
  it("blocks the exact secret word (main word or Imposter word alike)", () => {
    expect(verdict("My word is Tiger", "Tiger")).toBe(SECRET);
    expect(verdict("TIGER!!!", "Tiger")).toBe(SECRET);
    expect(verdict("it's obviously lion", "Lion")).toBe(SECRET);
    expect(verdict("I love pizza", "Pizza")).toBe(SECRET);
  });

  it("blocks plurals, reversals, misspellings and compounds conservatively", () => {
    expect(verdict("tigers everywhere", "Tiger")).toBe(SECRET);
    expect(verdict("regit", "Tiger")).toBe(SECRET); // reversed
    expect(verdict("tigre", "Tiger")).toBe(SECRET); // adjacent swap
    expect(verdict("burgr", "Burger")).toBe(SECRET); // dropped interior letter
    expect(verdict("krikket", "Cricket")).toBe(SECRET); // c/k swap + doubled letter
    expect(verdict("pizzas", "Pizza")).toBe(SECRET);
    expect(verdict("fresher", "Freshers")).toBe(SECRET);
    expect(verdict("pizzahut tonight?", "Pizza")).toBe(SECRET); // configured alias
    expect(verdict("basket", "Basketball")).toBe(REVIEW); // large part of the word: withheld, no strike
  });

  it("does not flag different real words that merely look similar (false-positive guard)", () => {
    expect(verdict("my house is far", "Horse")).toBe(ALLOW);
    expect(verdict("paste it here", "Pasta")).toBe(ALLOW);
    expect(verdict("top tier clue", "Tiger")).toBe(ALLOW);
    expect(verdict("while you were away", "Whale")).toBe(ALLOW);
    expect(verdict("let's dance tango", "Mango")).toBe(ALLOW);
    expect(verdict("a million votes", "Lion")).toBe(ALLOW);
    expect(verdict("small clue", "Mall")).toBe(ALLOW);
    expect(verdict("chill guys", "Hill")).toBe(ALLOW);
    expect(verdict("for example", "Exam")).toBe(ALLOW);
    expect(verdict("I passed", "Password")).toBe(ALLOW);
    expect(verdict("say the word", "Password")).toBe(ALLOW);
  });

  it("blocks synonyms and translations from the configurable dictionary", () => {
    expect(verdict("sher", "Lion")).toBe(SECRET);
    expect(verdict("it's like an espresso", "Coffee")).toBe(SECRET);
    expect(verdict("chai time", "Tea")).toBe(SECRET);
    expect(verdict("bunny", "Rabbit")).toBe(SECRET);
    expect(verdict("another word for doughnut", "Donut")).toBe(SECRET);
    expect(verdict("kushti", "Wrestling")).toBe(SECRET);
  });
});

describe("indirect hints", () => {
  it("blocks first-letter hints", () => {
    expect(verdict("it starts with T", "Tiger")).toBe(HINT);
    expect(verdict("my word starts with a t", "Tiger")).toBe(HINT);
    expect(verdict("first letter is t", "Tiger")).toBe(HINT);
    expect(verdict("first letter of my word is 't'", "Tiger")).toBe(HINT);
    expect(verdict("T is the first letter", "Tiger")).toBe(HINT);
    expect(verdict("begins with the letter p", "Pizza")).toBe(HINT);
  });

  it("blocks last-letter hints", () => {
    expect(verdict("it ends with r", "Tiger")).toBe(HINT);
    expect(verdict("last letter is R", "Tiger")).toBe(HINT);
    expect(verdict("ends in an a", "Pizza")).toBe(HINT);
  });

  it("blocks word-length hints", () => {
    expect(verdict("It has five letters.", "Tiger")).toBe(HINT);
    expect(verdict("5 letter word", "Tiger")).toBe(HINT);
    expect(verdict("five-letter word", "Tiger")).toBe(HINT);
    expect(verdict("length is 4", "Lion")).toBe(HINT);
  });

  it("withholds false letter/length claims too (no strike), so delivery never confirms a claim", () => {
    expect(verdict("it starts with an L", "Tiger")).toBe(REVIEW);
    expect(concern("it starts with an L", "Tiger")).toBe("hint");
    expect(verdict("it has seven letters", "Tiger")).toBe(REVIEW);
  });

  it("blocks spelling and letter-by-letter hints", () => {
    expect(verdict("t i g", "Tiger")).toBe(HINT);
    expect(verdict("tango india golf echo romeo", "Tiger")).toBe(SECRET);
    expect(verdict("tango india golf", "Tiger")).toBe(HINT);
    expect(verdict("it's spelled t i g", "Tiger")).toBe(HINT);
  });

  it("blocks rhyming and pronunciation clues", () => {
    expect(verdict("it rhymes with liger", "Tiger")).toBe(HINT);
    expect(verdict("sounds like tie grr", "Tiger")).toBe(SECRET); // "tiegrr" is a split misspelling of the word itself
    expect(verdict("rhymes with tango", "Mango")).toBe(HINT);
    expect(verdict("it rhymes with deal", "Seal")).toBe(HINT);
    expect(verdict("it rhymes with cat", "Tiger")).toBe(REVIEW); // explicit rhyme hint we cannot verify: withheld, no strike
  });

  it("blocks synonym, antonym and relationship hints", () => {
    expect(verdict("it's the opposite of tragedy", "Comedy")).toBe(HINT);
    expect(verdict("it is related to stripes", "Tiger")).toBe(HINT);
    expect(verdict("think of caffeine", "Coffee")).toBe(HINT);
    expect(verdict("it means the same as advocate", "Lawyer")).toBe(SECRET);
  });

  it("allows the same phrases in ordinary conversation", () => {
    expect(verdict("the round starts with a vote", "Tiger")).toBe(ALLOW);
    expect(verdict("this starts with a bang", "Tiger")).toBe(ALLOW);
    expect(verdict("that sounds like a guess", "Chess")).toBe(ALLOW);
    expect(verdict("it sounds like Bala is lying", "Tiger")).toBe(ALLOW);
    expect(verdict("I think it's related to what Bala said", "Tiger")).toBe(ALLOW);
    expect(verdict("think of everyone's clues again", "Tiger")).toBe(ALLOW);
    expect(verdict("stripes are a good clue honestly", "Tiger")).toBe(ALLOW); // related idea, no hint phrasing
    expect(verdict("Bala's clue starts with an s", "Tiger")).toBe(ALLOW);
    expect(verdict("I have two brothers", "Tiger")).toBe(ALLOW);
  });
});

describe("abusive content", () => {
  it.each([
    "fuck", "f u c k", "fuuuuck this", "f**k off", "f.u.c.k", "sh1t", "what the fuck", "you idiot", "u r so dumb",
    "you're such a loser", "Bala is an idiot", "madarchod", "chutiya hai tu", "bhenchod", "bsdk", "kys", "I will kill you",
    "go die", "send nudes", "show me your boobs", "tu pagal hai", "b!tch", "motherfucker", "asss"
  ])("blocks %j", (text) => {
    expect(verdict(text, "Tiger")).toBe(ABUSE);
  });

  it.each([
    "that clue is dumb lol", "class is over", "pass the vote", "assassin vibes", "as I said earlier", "Scunthorpe",
    "cocktail party", "who is the loser this round", "dumb charades later?", "chhod do yaar", "chod do yaar", "you killed it",
    "this round is killing me", "shiitake mushrooms", "I hope you win", "assume nothing", "glass", "cockpit"
  ])("allows %j", (text) => {
    expect(verdict(text, "Tiger")).toBe(ALLOW);
  });

  it("treats abuse the same for every player regardless of their word", () => {
    for (const word of ["Tiger", "Lion", "Pizza", "Chess"]) expect(verdict("you idiot", word)).toBe(ABUSE);
  });
});

describe("false-positive corpus: ordinary discussion is allowed for every word in the bank", () => {
  const harmless = [
    "I think Bala is the imposter", "Chirag's clue was way too vague", "who do we vote for?", "Let's vote for Dev",
    "that clue doesn't fit at all", "hmm I'm not sure", "lol nice one", "bro what was that clue", "I'm sus of Asha",
    "my clue was pretty obvious", "yaar ye kya clue tha", "chal vote karte hain", "mujhe lagta hai Dev imposter hai",
    "accha theek hai", "same here", "no idea honestly", "wait what", "it makes sense to me", "that sounds like a guess",
    "it's kind of obvious who it is", "I think it's related to what Bala said", "think about everyone's clues again",
    "the round starts with a vote", "this game is so much fun", "can we start the next round", "I'll vote last",
    "everyone gave good clues", "ok ok", "u r right", "u r a legend", "omg", "gg", "brb", "tbh I have no clue",
    "first time playing this", "the last round was crazy", "it was the first clue I thought of",
    "two of you gave similar clues", "I have 2 votes", "three players left", "Asha starts first", "who goes first?",
    "I'm going to vote for you", "you got me", "as I said earlier", "that's a classic move", "you killed it",
    "I'm dying lol", "Dev's clue fits better than mine", "Esha was too quiet", "trust me bro", "kuch samajh nahi aaya",
    "sahi baat hai", "why are you defending him", "your clue gave it away", "I agree with Asha", "nope", "maybe Farhan?"
  ];

  it("produces no blocks and no withheld messages", () => {
    const flagged: string[] = [];
    for (const word of bankWords) {
      for (const line of harmless) {
        const result = engine.moderate(line, [word]);
        if (result.outcome !== ALLOW) flagged.push(`${word}: "${line}" -> ${result.outcome} [${result.signals.join(",")}]`);
      }
    }
    expect(flagged).toEqual([]);
  });
});

describe("detection corpus: templated disclosure attempts are caught for every word in the bank", () => {
  it("blocks each word's direct, obfuscated, letter and length forms", () => {
    const missed: string[] = [];
    for (const word of bankWords) {
      const letters = lettersOf(word);
      const attempts: Array<[string, ModerationOutcome]> = [
        [word, SECRET],
        [`my word is ${word.toUpperCase()}`, SECRET],
        [letters.split("").join(" "), SECRET],
        [letters.split("").join("."), SECRET],
        [`${letters.slice(0, 2)}_${letters.slice(2)}`, SECRET],
        [letters.replace(/([aeiou])/, "$1$1$1"), SECRET],
        [`it starts with ${letters[0]}`, HINT],
        [`last letter is ${letters.at(-1)}`, HINT],
        [`it has ${letters.length} letters`, HINT]
      ];
      for (const [text, expected] of attempts) {
        const result = engine.moderate(text, [word]).outcome;
        if (result !== expected) missed.push(`${word}: "${text}" -> ${result} (expected ${expected})`);
      }
    }
    expect(missed).toEqual([]);
  });
});

describe("oracle resistance", () => {
  it("never blocks a player for typing a word that could be someone else's secret", () => {
    // For every pair, the partner word (and every other bank word) is allowed for the sender:
    // a guess about a word you do not know is just a message.
    const blocked: string[] = [];
    for (const pair of fallbackWordBank) {
      for (const [own, other] of [[pair.wordA, pair.wordB], [pair.wordB, pair.wordA]]) {
        for (const text of [other, `is it ${other}?`, `I bet the other word is ${other.toLowerCase()}`]) {
          const result = engine.moderate(text, [own]);
          if (result.outcome !== ALLOW) blocked.push(`${own} typing "${text}" -> ${result.outcome}`);
        }
      }
    }
    expect(blocked).toEqual([]);
  });

  it("keeps the relationship dictionary free of any word-bank word (static, round-independent filter)", () => {
    const index = buildRelationIndex(defaultWordRelations, bankWords);
    const bank = new Set(bankWords.map((word) => lettersOf(word)));
    for (const [word, relation] of index) {
      for (const term of [...relation.aliases, ...relation.antonyms, ...relation.related]) {
        expect(bank.has(term.letters), `${word} -> ${term.letters}`).toBe(false);
      }
    }
    // e.g. "villain" is the obvious antonym of "hero" but is itself a secret word, so it is dropped.
    expect((index.get("hero")?.antonyms ?? []).map((term) => term.letters)).not.toContain("villain");
  });

  it("matches short dictionary terms exactly, so everyday words are not caught by their collapsed forms", () => {
    expect(verdict("aam", "Mango")).toBe(SECRET);
    expect(verdict("I am here", "Mango")).toBe(ALLOW);
    expect(verdict("wwe fan", "Wrestling")).toBe(SECRET);
    expect(verdict("we should vote", "Wrestling")).toBe(ALLOW);
  });

  it("supports several known words (e.g. a future multi-Imposter mode) while judging each sender only by their own words", () => {
    // Two Imposters share the Imposter word; a normal player knows only the main word.
    const imposterWords = ["Tiger"];
    const normalWords = ["Lion"];
    expect(engine.moderate("lion?", imposterWords).outcome).toBe(ALLOW);
    expect(engine.moderate("tiger?", normalWords).outcome).toBe(ALLOW);
    expect(engine.moderate("tiger?", imposterWords).outcome).toBe(SECRET);
    expect(engine.moderate("lion?", normalWords).outcome).toBe(SECRET);
    expect(engine.moderate("sher or bagh", ["Lion", "Tiger"]).outcome).toBe(SECRET);
  });
});

describe("violation policy (ChatModerationGate)", () => {
  const make = () => new ChatModerationGate(engine, defaultModerationPolicy);
  const screen = (gate: ChatModerationGate, text: string, now: number, roundNumber = 1, playerId = "player-1") =>
    gate.screen({ playerId, roundNumber, knownWords: ["Tiger"], text, now });

  it("warns, warns more strongly, then restricts temporarily with escalating cooldowns", () => {
    const gate = make();
    const first = screen(gate, "tiger", 0);
    const second = screen(gate, "tiger!", 1_000);
    const third = screen(gate, "t i g e r", 2_000);
    expect(first).toMatchObject({ allow: false, message: "Your message may reveal secret information. Please rephrase it." });
    expect(second).toMatchObject({ allow: false, message: "Your message may reveal secret information. Please rephrase it. Further violations will temporarily restrict your chat." });
    expect(third).toMatchObject({ allow: false, message: "Your chat is temporarily restricted for 30 seconds because of repeated violations." });
    expect(screen(gate, "hello everyone", 10_000)).toMatchObject({ allow: false, outcome: "RESTRICTED", message: "Your chat is temporarily restricted. Try again in 22 seconds.", cacheable: false });
    expect(screen(gate, "hello everyone", 32_001)).toEqual({ allow: true, outcome: "ALLOW" });
    expect(screen(gate, "tiger", 33_000)).toMatchObject({ message: "Your chat is temporarily restricted for 60 seconds because of repeated violations." });
  });

  it("never punishes a single uncertain classification; only a repeated pattern counts", () => {
    const gate = make();
    expect(screen(gate, "it starts with an L", 0)).toMatchObject({ allow: false, outcome: REVIEW, message: "Giving hints about letters, spelling or word meaning is not allowed." });
    expect(screen(gate, "it starts with an M", 1_000)).toMatchObject({ outcome: REVIEW, message: "Giving hints about letters, spelling or word meaning is not allowed." });
    // Third uncertain message in the round counts as the first violation (a plain warning, still no restriction).
    expect(screen(gate, "it starts with an N", 2_000)).toMatchObject({ outcome: REVIEW, message: "Giving hints about letters, spelling or word meaning is not allowed." });
    expect(screen(gate, "tiger", 3_000).allow).toBe(false);
    expect(screen(gate, "hello", 4_000)).toEqual({ allow: true, outcome: "ALLOW" }); // two violations: warned, not restricted
  });

  it("resets violation counts each round and on a new game, but lets an active restriction run out", () => {
    const gate = make();
    for (const at of [0, 1, 2]) screen(gate, "tiger", at);
    expect(screen(gate, "hello", 5_000, 2).allow).toBe(false); // restriction carries into the next round
    expect(screen(gate, "tiger", 31_000, 2)).toMatchObject({ message: "Your message may reveal secret information. Please rephrase it." }); // fresh count
    gate.reset();
    expect(screen(gate, "hello", 31_500, 2)).toEqual({ allow: true, outcome: "ALLOW" });
  });

  it("tracks players independently", () => {
    const gate = make();
    for (const at of [0, 1, 2]) screen(gate, "tiger", at, 1, "player-1");
    expect(screen(gate, "hello", 3, 1, "player-2")).toEqual({ allow: true, outcome: "ALLOW" });
  });

  it("supports a permissive review policy and disabling moderation", () => {
    const lenient = new ChatModerationGate(engine, { ...defaultModerationPolicy, uncertainPolicy: "allow" });
    expect(lenient.screen({ playerId: "p", roundNumber: 1, knownWords: ["Tiger"], text: "it starts with an L", now: 0 })).toEqual({ allow: true, outcome: REVIEW });
    const off = new ChatModerationGate(engine, { ...defaultModerationPolicy, enabled: false });
    expect(off.screen({ playerId: "p", roundNumber: 1, knownWords: ["Tiger"], text: "tiger", now: 0 })).toEqual({ allow: true, outcome: "ALLOW" });
  });

  it("uses only the three generic category messages and never echoes the secret", () => {
    const gate = new ChatModerationGate(engine, { ...defaultModerationPolicy, warningsBeforeRestriction: 1_000 });
    const messages = new Set<string>();
    const samples = ["tiger", "regit", "it starts with t", "5 letter word", "rhymes with liger", "you idiot", "sher", "it starts with an L", "basket"];
    for (const [index, text] of samples.entries()) {
      const result = gate.screen({ playerId: `p${index}`, roundNumber: 1, knownWords: ["Tiger", "Basketball"], text, now: index });
      if (!result.allow) messages.add(result.message);
    }
    expect([...messages].sort()).toEqual([
      "Giving hints about letters, spelling or word meaning is not allowed.",
      "Please keep the conversation respectful.",
      "Your message may reveal secret information. Please rephrase it."
    ]);
    for (const message of messages) expect(message.toLowerCase()).not.toMatch(/tiger|basket/);
  });
});
