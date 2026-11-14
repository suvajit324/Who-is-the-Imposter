import { defaultAbuseLexicon, type AbuseLexicon } from "./abuseLexicon.js";
import { collapseRepeats, foldText, lettersOf, NATO_ALPHABET, NUMBER_WORDS, phraseText, skeleton, tokenize, type Unit } from "./normalize.js";
import { defaultWordRelations, type WordRelation } from "./wordRelations.js";

/**
 * Rule-based chat moderation.
 *
 * SECURITY MODEL: a message is only ever compared with the words the *sender*
 * already knows (their own secret word). The decision is therefore a function of
 * (sender's own word, message) and carries no information about any word the
 * sender does not know, so it cannot be used as a guessing oracle. Each secret is
 * protected from every player who knows it: the main word from normal players,
 * the Imposter's word from the Imposter.
 */

export type ModerationOutcome = "ALLOW" | "BLOCK_SECRET_DISCLOSURE" | "BLOCK_INDIRECT_HINT" | "BLOCK_ABUSIVE_CONTENT" | "REVIEW_UNCERTAIN";
export type ModerationConcern = "secret" | "hint" | "abuse";

export type ModerationDecision = {
  outcome: ModerationOutcome;
  /** Which generic feedback applies (for REVIEW_UNCERTAIN too). Null when allowed. */
  concern: ModerationConcern | null;
  /** Internal diagnostic labels for tests. Server-side only: never sent to clients or logged. */
  signals: string[];
};

export type ModerationEngine = {
  moderate(text: string, knownWords: readonly string[]): ModerationDecision;
};

type PreparedWord = {
  letters: string;
  skel: string;
  length: number;
  first: string;
  last: string;
  rhyme: string | null;
  phonetic: string;
  aliases: Term[];
  antonyms: Term[];
  related: Term[];
};

/** A dictionary term in raw-letter and skeleton form. */
type Term = { letters: string; skel: string };

type Candidate = { letters: string; kind: "unit" | "concat" | "spelled" | "nato" };

type Analysis = {
  units: Unit[];
  words: string[];
  phrase: string;
  candidates: Candidate[];
  spelledRuns: string[];
  natoRuns: string[];
  initials: string;
  mentionsClue: boolean;
};

const SIMILAR_LETTERS = new Set(["ck", "kc", "kq", "qk", "cq", "qc", "sz", "zs", "cs", "sc", "iy", "yi", "vw", "wv", "gj", "jg"]);
const CHAT_SHORTHAND_LETTERS = new Set(["u", "r", "y", "k", "i", "a", "n", "o"]);
const NUMBER_PATTERN = `\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")}`;
const LETTER_TARGET = String.raw`(?:(?:an?|the)\s+)?(?:letter\s+)?'?([a-z])'?(?=\s)`;
const SUBJECT = /\b(?:it|its|it's|word|answer|secret|mine|ours|thing)\b/;

const LETTER_PATTERNS: Array<{ re: RegExp; position: "first" | "last" | "contains" }> = [
  { re: new RegExp(String.raw`\b(?:starts?|starting|begins?|beginning)\s+(?:with|from)\s+${LETTER_TARGET}`, "g"), position: "first" },
  { re: new RegExp(String.raw`\b(?:ends?|ending|finish(?:es)?)\s+(?:with|in)\s+${LETTER_TARGET}`, "g"), position: "last" },
  { re: new RegExp(String.raw`\b(?:first|starting|beginning|initial)\s+(?:letter|character|char|alphabet)\s+(?:of\s+(?:my|the|our|this)\s+word\s+)?(?:is\s+|was\s+|'s\s+)?${LETTER_TARGET}`, "g"), position: "first" },
  { re: new RegExp(String.raw`\b(?:last|final|ending)\s+(?:letter|character|char|alphabet)\s+(?:of\s+(?:my|the|our|this)\s+word\s+)?(?:is\s+|was\s+|'s\s+)?${LETTER_TARGET}`, "g"), position: "last" },
  { re: /\b([a-z])\s+is\s+the\s+(?:first|starting|initial|beginning)\s+letter\b/g, position: "first" },
  { re: /\b([a-z])\s+is\s+the\s+(?:last|final|ending)\s+letter\b/g, position: "last" },
  { re: new RegExp(String.raw`\binitials?\s+(?:is\s+)?${LETTER_TARGET}`, "g"), position: "first" },
  { re: /\b(?:has|have|contains|got|includes)\s+(?:an?\s+|the\s+)?letter\s+'?([a-z])'?(?=\s)/g, position: "contains" }
];
const LENGTH_PATTERNS = [
  new RegExp(String.raw`\b(${NUMBER_PATTERN})\s+(?:letters?|characters?|chars|alphabets?)\b`, "g"),
  new RegExp(String.raw`\b(?:length|size)\s+(?:is\s+|of\s+|was\s+)?(${NUMBER_PATTERN})\b`, "g")
];

type HintPhrase = { re: RegExp; kind: "rhyme" | "sound" | "pronounce" | "spell" | "meaning" | "opposite" | "translate" | "related"; strong: boolean };
const HINT_PHRASES: HintPhrase[] = [
  { re: /\brhym(?:es|ing|e)?\s+(?:with\s+)?/g, kind: "rhyme", strong: true },
  { re: /\bsounds?\s+(?:like|similar\s+to)\s+/g, kind: "sound", strong: false },
  { re: /\b(?:pronounced|pronounce|pronunciation)\s+(?:is\s+|as\s+|like\s+)?/g, kind: "pronounce", strong: true },
  { re: /\b(?:spelled|spelt|spelling|spells)\s+(?:is\s+|as\s+|like\s+)?/g, kind: "spell", strong: true },
  { re: /\b(?:means?|meaning)\s+(?:the\s+)?same\s+(?:thing\s+)?(?:as\s+)?|\bsame\s+meaning\s+as\s+|\bsynonyms?\s+(?:of\s+|for\s+|is\s+|to\s+)?|\b(?:an)?other\s+word\s+for\s+|\balso\s+(?:called|known\s+as)\s+|\baka\s+|\bknown\s+as\s+/g, kind: "meaning", strong: true },
  { re: /\b(?:opposite|antonym|reverse)\s+(?:of\s+|is\s+|to\s+)?/g, kind: "opposite", strong: true },
  { re: /\btranslat(?:es|ed|ion)\s+(?:to\s+|is\s+|of\s+)?|\bin\s+(?:hindi|hinglish|tamil|telugu|bengali|bangla|marathi|urdu|punjabi|gujarati|kannada|malayalam|spanish|french|german|japanese)\s+(?:it's\s+|its\s+|it\s+is\s+|is\s+|we\s+say\s+)?/g, kind: "translate", strong: true },
  { re: /\b(?:related\s+to|associated\s+with|connected\s+to|reminds?\s+(?:me|you|us)\s+of|think\s+(?:of|about)|kind\s+of|type\s+of|sort\s+of|similar\s+to)\s+/g, kind: "related", strong: false }
];

const NOUN_TRIGGERS = new Set(["you", "u", "ur", "youre", "ure", "ya", "tu", "tum", "yo"]);
const ADJECTIVE_TRIGGERS = new Set(["you", "u", "ur", "youre", "ure", "r", "tu", "tum"]);

export function createModerationEngine(options: { bankWords: readonly string[]; relations?: Record<string, WordRelation>; lexicon?: AbuseLexicon }): ModerationEngine {
  const relations = buildRelationIndex(options.relations ?? defaultWordRelations, options.bankWords);
  const lexicon = prepareLexicon(options.lexicon ?? defaultAbuseLexicon);
  const prepared = new Map<string, PreparedWord>();

  const prepare = (word: string): PreparedWord => {
    const letters = lettersOf(word);
    let entry = prepared.get(letters);
    if (!entry) {
      const relation = relations.get(letters) ?? { aliases: [], antonyms: [], related: [] };
      entry = {
        letters,
        skel: skeleton(letters),
        length: letters.length,
        first: letters[0] ?? "",
        last: letters.at(-1) ?? "",
        rhyme: rhymeKey(letters),
        phonetic: phoneticKey(letters),
        ...relation
      };
      prepared.set(letters, entry);
    }
    return entry;
  };

  return {
    moderate(text, knownWords) {
      const analysis = analyze(text);
      if (isAbusive(analysis, lexicon)) return { outcome: "BLOCK_ABUSIVE_CONTENT", concern: "abuse", signals: ["abuse"] };

      const signals: string[] = [];
      let secret = false;
      let hint = false;
      let uncertainSecret = false;
      let uncertainHint = false;
      for (const raw of knownWords) {
        const word = prepare(raw);
        if (!word.letters) continue;
        const result = evaluateWord(analysis, word);
        signals.push(...result.signals);
        secret ||= result.secret;
        hint ||= result.hint;
        uncertainSecret ||= result.uncertainSecret;
        uncertainHint ||= result.uncertainHint;
      }
      if (secret) return { outcome: "BLOCK_SECRET_DISCLOSURE", concern: "secret", signals };
      if (hint) return { outcome: "BLOCK_INDIRECT_HINT", concern: "hint", signals };
      if (uncertainSecret) return { outcome: "REVIEW_UNCERTAIN", concern: "secret", signals };
      if (uncertainHint) return { outcome: "REVIEW_UNCERTAIN", concern: "hint", signals };
      return { outcome: "ALLOW", concern: null, signals };
    }
  };
}

// ---------------------------------------------------------------------------
// Dictionary preparation
// ---------------------------------------------------------------------------

/**
 * Normalises the relationship dictionary and drops any term equal to a word in the
 * word bank. This is a static, round-independent filter: it guarantees that a
 * player's own dictionary can never block a word that might be another player's
 * secret, without making the filter depend on the current round's other word.
 */
export function buildRelationIndex(relations: Record<string, WordRelation>, bankWords: readonly string[]) {
  const bank = new Set(bankWords.map((word) => skeleton(lettersOf(word))));
  const clean = (terms: string[] | undefined): Term[] => {
    const seen = new Map<string, Term>();
    for (const raw of terms ?? []) {
      const letters = lettersOf(raw);
      const skel = skeleton(letters);
      if (letters.length >= 2 && !bank.has(skel)) seen.set(letters, { letters, skel });
    }
    return [...seen.values()];
  };
  const index = new Map<string, { aliases: Term[]; antonyms: Term[]; related: Term[] }>();
  for (const [word, relation] of Object.entries(relations)) {
    index.set(lettersOf(word), { aliases: clean(relation.aliases), antonyms: clean(relation.antonyms), related: clean(relation.related) });
  }
  return index;
}

type PreparedLexicon = {
  tokens: Set<string>;
  tokensByCollapse: Map<string, string[]>;
  stems: string[];
  strongTerms: string[];
  nouns: Set<string>;
  adjectives: Set<string>;
  patterns: RegExp[];
  allow: Set<string>;
};

function prepareLexicon(lexicon: AbuseLexicon): PreparedLexicon {
  const tokens = new Set(lexicon.tokens.map(lettersOf));
  const tokensByCollapse = new Map<string, string[]>();
  for (const token of tokens) tokensByCollapse.set(collapseRepeats(token), [...(tokensByCollapse.get(collapseRepeats(token)) ?? []), token]);
  const stems = lexicon.stems.map(lettersOf);
  return {
    tokens,
    tokensByCollapse,
    stems,
    strongTerms: [...tokens, ...stems].filter((term) => term.length >= 4),
    nouns: new Set(lexicon.targetedNouns.map(lettersOf)),
    adjectives: new Set(lexicon.targetedAdjectives.map(lettersOf)),
    patterns: lexicon.patterns,
    allow: new Set(lexicon.allowlist.map(lettersOf))
  };
}

// ---------------------------------------------------------------------------
// Message analysis (word-independent, computed once per message)
// ---------------------------------------------------------------------------

function analyze(text: string): Analysis {
  const folded = foldText(text);
  const units = tokenize(folded);
  const words = units.map((unit) => unit.variants[0] ?? unit.text);
  const candidates: Candidate[] = [];
  for (const unit of units) for (const variant of unit.variants) candidates.push({ letters: variant, kind: "unit" });

  for (let start = 0; start < units.length; start += 1) {
    let joined = "";
    for (let length = 1; length <= 4 && start + length <= units.length; length += 1) {
      const variant = units[start + length - 1].variants[0];
      if (!variant) break;
      joined += variant;
      if (length >= 2) candidates.push({ letters: joined, kind: "concat" });
    }
  }

  const spelledRuns = runs(units, (unit) => unit.variants[0]?.length === 1 && unit.text.length <= 2, (unit) => unit.variants[0]);
  const natoRuns = runs(units, (unit) => Boolean(NATO_ALPHABET[unit.variants[0] ?? ""]), (unit) => NATO_ALPHABET[unit.variants[0]]);
  for (const run of spelledRuns) if (run.length >= 2) candidates.push({ letters: run, kind: "spelled" });
  for (const run of natoRuns) if (run.length >= 2) candidates.push({ letters: run, kind: "nato" });

  const phrase = phraseText(folded);
  return {
    units,
    words,
    phrase,
    candidates,
    spelledRuns,
    // Each NATO word is one letter, so run length == number of words; require 3+ to avoid ordinary words like "hotel".
    natoRuns: natoRuns.filter((run) => run.length >= 3),
    initials: units.map((unit) => unit.variants[0]?.[0] ?? "").join(""),
    mentionsClue: /\bclues?\b/.test(phrase)
  };
}

function runs(units: Unit[], belongs: (unit: Unit) => boolean, letter: (unit: Unit) => string): string[] {
  const out: string[] = [];
  let current = "";
  for (const unit of units) {
    if (belongs(unit)) current += letter(unit);
    else {
      if (current) out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

// ---------------------------------------------------------------------------
// Abuse (independent of secret words, identical for every player)
// ---------------------------------------------------------------------------

function isAbusive(analysis: Analysis, lexicon: PreparedLexicon): boolean {
  const termMatch = (letters: string, allowElongation: boolean) => {
    if (!letters || lexicon.allow.has(letters) || lexicon.allow.has(collapseRepeats(letters))) return false;
    if (lexicon.tokens.has(letters)) return true;
    const collapsed = collapseRepeats(letters);
    // "fuuuck" matches "fuck", but "as" must not match "ass": only elongations, never shortenings.
    if (allowElongation && (lexicon.tokensByCollapse.get(collapsed) ?? []).some((token) => letters.length > token.length)) return true;
    return lexicon.stems.some((stem) => letters.startsWith(stem) || (allowElongation && collapsed.startsWith(collapseRepeats(stem)) && letters.length > stem.length));
  };

  for (const unit of analysis.units) {
    if (unit.variants.some((variant) => termMatch(variant, true))) return true;
    if (unit.mask && maskedMatch(unit.mask, lexicon.strongTerms)) return true;
  }
  for (const run of analysis.spelledRuns) if (run.length >= 3 && termMatch(run, true)) return true;
  // Words split into short pieces: "fu ck", "bit ch".
  for (let start = 0; start < analysis.units.length - 1; start += 1) {
    let joined = "";
    for (let length = 1; length <= 3 && start + length <= analysis.units.length; length += 1) {
      const piece = analysis.units[start + length - 1].variants[0];
      if (!piece || piece.length > 3) break;
      joined += piece;
      if (length >= 2 && joined.length >= 4 && termMatch(joined, false)) return true;
    }
  }

  const words = analysis.words;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (lexicon.nouns.has(word)) {
      const before = words.slice(Math.max(0, index - 3), index);
      const article = ["a", "an", "such", "total", "complete", "big"].includes(words[index - 1] ?? "") && ["is", "are", "r", "ur", "youre"].includes(words[index - 2] ?? "");
      if (before.some((candidate) => NOUN_TRIGGERS.has(candidate)) || article) return true;
    }
    if (lexicon.adjectives.has(word) && words.slice(Math.max(0, index - 2), index).some((candidate) => ADJECTIVE_TRIGGERS.has(candidate))) return true;
  }

  const leetPhrase = ` ${words.join(" ")} `;
  return lexicon.patterns.some((pattern) => pattern.test(analysis.phrase) || pattern.test(leetPhrase));
}

function maskedMatch(mask: string, terms: string[]): boolean {
  const letters = mask.replace(/[^a-z*]/g, "");
  const masked = [...letters].filter((char) => char === "*").length;
  if (!letters || letters[0] === "*" || masked === 0 || masked > letters.length / 2) return false;
  return terms.some((term) => term.length === letters.length && [...letters].every((char, index) => char === "*" || char === term[index]));
}

// ---------------------------------------------------------------------------
// Secret disclosure and hints (per known word)
// ---------------------------------------------------------------------------

type WordEvaluation = { secret: boolean; hint: boolean; uncertainSecret: boolean; uncertainHint: boolean; signals: string[] };

function evaluateWord(analysis: Analysis, word: PreparedWord): WordEvaluation {
  const result: WordEvaluation = { secret: false, hint: false, uncertainSecret: false, uncertainHint: false, signals: [] };
  const flag = (kind: keyof Omit<WordEvaluation, "signals">, signal: string) => {
    result[kind] = true;
    result.signals.push(signal);
  };

  // 1. Direct disclosure: the word itself, obfuscated, misspelled, reversed, or a synonym/translation.
  for (const candidate of analysis.candidates) {
    const match = matchWord(candidate.letters, word);
    if (match) flag("secret", `word:${match}:${candidate.kind}`);
    if (matchesAny(candidate.letters, word.aliases)) flag("secret", `alias:${candidate.kind}`);
    if (candidate.kind === "unit" && !match && word.length >= 5) {
      const piece = skeleton(candidate.letters);
      if (piece !== word.skel && candidate.letters.length >= 5 && candidate.letters.length >= 0.6 * word.length && (word.skel.startsWith(piece) || word.skel.endsWith(piece))) {
        flag("uncertainSecret", "partial");
      }
      if (piece.length >= word.skel.length + 3 && (piece.startsWith(word.skel) || piece.endsWith(word.skel))) flag("uncertainSecret", "compound");
    }
  }
  if (word.length >= 4 && analysis.units.length >= word.length && analysis.initials.includes(word.letters)) flag("uncertainSecret", "acrostic");

  // 2. Letter-by-letter spelling ("t i g", "tango india golf").
  for (const run of [...analysis.spelledRuns, ...analysis.natoRuns]) {
    if (run.length < 2 || matchWord(run, word)) continue;
    if (run.length >= 3 && (word.letters.startsWith(run) || word.letters.endsWith(run))) flag("hint", "spelled-part");
    else if (run.length >= 3 && [...run].filter((char) => !CHAT_SHORTHAND_LETTERS.has(char)).length >= 2) flag("uncertainHint", "spelled-sequence");
  }

  // 3. Letter and length statements. These are withheld even when false: delivering only
  //    the false ones would let everyone infer which claims are true.
  for (const { re, position } of LETTER_PATTERNS) {
    for (const match of analysis.phrase.matchAll(re)) {
      const letter = match[1];
      const after = analysis.phrase.slice((match.index ?? 0) + match[0].length);
      if ((letter === "a" || letter === "i") && /^\s*[a-z]{2,}/.test(after) && !/^\s*(?:and|or)\b/.test(after)) continue;
      const truthful = position === "first" ? letter === word.first : position === "last" ? letter === word.last : word.letters.includes(letter);
      if (truthful) flag("hint", `letter-${position}`);
      else if (!analysis.mentionsClue) flag("uncertainHint", `letter-${position}-other`);
    }
  }
  for (const re of LENGTH_PATTERNS) {
    for (const match of analysis.phrase.matchAll(re)) {
      const value = NUMBER_WORDS[match[1]] ?? Number(match[1]);
      if (value === word.length) flag("hint", "length");
      else if (!analysis.mentionsClue) flag("uncertainHint", "length-other");
    }
  }

  // 4. Meaning / sound hints with a target ("rhymes with X", "opposite of X", "related to X").
  for (const phrase of HINT_PHRASES) {
    for (const match of analysis.phrase.matchAll(phrase.re)) {
      const start = (match.index ?? 0) + match[0].length;
      const target = analysis.phrase.slice(start).trim().split(" ").slice(0, 5).filter(Boolean);
      if (targetRelates(target, word, phrase.kind)) {
        flag("hint", `phrase-${phrase.kind}`);
        continue;
      }
      const before = analysis.phrase.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
      if (phrase.strong && target.length > 0 && SUBJECT.test(before)) flag("uncertainHint", `phrase-${phrase.kind}-unverified`);
    }
  }
  return result;
}

function targetRelates(target: string[], word: PreparedWord, kind: HintPhrase["kind"]): boolean {
  if (target.length === 0) return false;
  const pieces = target.map((token) => lettersOf(token)).filter(Boolean);
  const joined: string[] = [];
  for (let start = 0; start < pieces.length; start += 1) {
    let current = "";
    for (let length = 1; length <= 3 && start + length <= pieces.length; length += 1) {
      current += pieces[start + length - 1];
      joined.push(current);
    }
  }
  const singles = pieces.filter((piece) => piece.length === 1).join("");
  if (singles.length >= 2) joined.push(singles);

  if (joined.some((candidate) => matchWord(candidate, word) || matchesAny(candidate, word.aliases))) return true;
  if (kind === "spell" && singles.length >= 2 && (word.letters.startsWith(singles) || word.letters.endsWith(singles))) return true;
  if (kind === "opposite" && joined.some((candidate) => matchesAny(candidate, word.antonyms))) return true;
  if ((kind === "related" || kind === "meaning") && joined.some((candidate) => matchesAny(candidate, word.related))) return true;
  if (kind === "rhyme" || kind === "sound" || kind === "pronounce") {
    if (word.rhyme && pieces.some((piece) => piece !== word.letters && piece.length >= 3 && rhymeKey(piece) === word.rhyme)) return true;
    if (word.phonetic.length >= 3 && joined.some((candidate) => phoneticKey(candidate) === word.phonetic)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Word matching primitives
// ---------------------------------------------------------------------------

/** Whether some letter sequence spells the word: exact (after normalisation), plural, reversed, or one controlled edit away. */
export function matchWord(letters: string, word: PreparedWord | string): "exact" | "plural" | "reversed" | "misspelling" | null {
  const target = typeof word === "string" ? simpleWord(word) : word;
  if (!letters || !target.skel) return null;
  const piece = skeleton(letters);
  if (piece === target.skel) return "exact";
  if (piece === `${target.skel}s` || piece === `${target.skel}es` || (target.letters.endsWith("s") && target.length >= 5 && piece === skeleton(target.letters.slice(0, -1)))) return "plural";
  if (target.length >= 4 && piece.length >= 3 && [...piece].reverse().join("") === target.skel) return "reversed";
  if (target.length >= 5 && oneControlledEdit(letters, piece, target)) return "misspelling";
  return null;
}

function simpleWord(word: string): PreparedWord {
  const letters = lettersOf(word);
  return { letters, skel: skeleton(letters), length: letters.length, first: letters[0] ?? "", last: letters.at(-1) ?? "", rhyme: null, phonetic: "", aliases: [], antonyms: [], related: [] };
}

/**
 * Deliberately narrow edit distance, to catch intentional misspellings without
 * flagging different real words ("horse" vs "house"): an adjacent swap, a swap of
 * look/sound-alike letters (c/k, s/z, i/y, v/w, g/j), or dropping one interior letter.
 */
function oneControlledEdit(letters: string, piece: string, word: PreparedWord): boolean {
  const target = word.skel;
  if (piece.length === target.length) {
    const diffs: number[] = [];
    for (let index = 0; index < piece.length; index += 1) if (piece[index] !== target[index]) diffs.push(index);
    if (diffs.length === 1) return SIMILAR_LETTERS.has(piece[diffs[0]] + target[diffs[0]]);
    if (diffs.length === 2 && diffs[1] === diffs[0] + 1) return piece[diffs[0]] === target[diffs[1]] && piece[diffs[1]] === target[diffs[0]];
    return false;
  }
  if (word.length >= 6 && letters.length >= 5 && piece.length === target.length - 1) {
    for (let index = 1; index < target.length - 1; index += 1) {
      if (target.slice(0, index) + target.slice(index + 1) === piece) return true;
    }
  }
  return false;
}

/**
 * Dictionary match. Long terms match on skeleton (so "espreso" or "chaaai" still count);
 * short terms ("aam", "wwe", "iit") must match their letters exactly, or as an elongation,
 * because their skeletons ("am", "we", "it") are everyday words.
 */
function matchesAny(letters: string, terms: Term[]): boolean {
  if (terms.length === 0 || !letters) return false;
  const piece = skeleton(letters);
  return terms.some((term) => {
    if (letters === term.letters || letters === `${term.letters}s`) return true;
    if (term.skel.length >= 4) return piece === term.skel || piece === `${term.skel}s`;
    return piece === term.skel && letters.length > term.letters.length;
  });
}

/** Approximate rhyme: the word from its second-to-last vowel group on ("tiger" -> "iger"). */
export function rhymeKey(letters: string): string | null {
  let base = letters;
  if (base.length > 3 && /[^aeiou]e$/.test(base)) base = base.slice(0, -1);
  const groups = [...base.matchAll(/[aeiouy]+/g)].filter((group) => !(group.index === 0 && group[0] === "y"));
  if (groups.length === 0) return null;
  const pick = groups.length >= 2 ? groups[groups.length - 2] : groups[groups.length - 1];
  const key = base.slice(pick.index ?? 0);
  return key.length >= 2 ? key : null;
}

/** Rough consonant-skeleton phonetic key ("tiger" and "tie grr" -> "tgr"). */
export function phoneticKey(letters: string): string {
  if (!letters) return "";
  const s = letters
    .replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k")
    .replace(/x/g, "ks").replace(/z/g, "s").replace(/wh/g, "w").replace(/^kn/, "n").replace(/gh/g, "g").replace(/dg/g, "j").replace(/th/g, "0");
  const head = /[aeiou]/.test(s[0]) ? "a" : s[0];
  return collapseRepeats(head + s.slice(1).replace(/[aeiouyhw]/g, ""));
}
