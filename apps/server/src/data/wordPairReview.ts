/**
 * Development-time quality review for the word bank. Run it with `npm run words:review`;
 * the seed script and the test suite run it too. It is NOT used while a game is running:
 * runtime selection only applies the cheap structural check in domain/words.ts.
 *
 * Two kinds of findings:
 *  - errors:   the pair cannot ship (malformed entry, duplicate, identical words, unknown
 *              category or difficulty, a pair already reviewed and rejected, or a pair that
 *              chat moderation would leak).
 *  - warnings: heuristics that flag a pair for a human decision (possible near-synonym,
 *              shared stem, look-alike spelling). They are signals, not verdicts: related
 *              words can make an excellent pair, and unrelated-looking words can still be
 *              confusing. Fix the pair, or record why it is fine in `acknowledgedWarnings`.
 *
 * No embeddings or external services are involved. Synonym detection uses the curated
 * `nearSynonymGroups` below plus spelling heuristics, so it is deterministic and dependency-free.
 */
import { categorySchema, difficultySchema, type Difficulty, type WordCategory } from "@imposter/shared";
import { isPlayableWord, isPlayableWordPair, normalizeWord } from "../domain/words.js";
import { createModerationEngine } from "../moderation/index.js";

export type ReviewSeverity = "error" | "warning";

export type ReviewRule =
  | "invalid-entry"
  | "invalid-id"
  | "duplicate-id"
  | "empty-word"
  | "invalid-word"
  | "identical-words"
  | "word-variant"
  | "duplicate-pair"
  | "reversed-duplicate"
  | "missing-category"
  | "invalid-category"
  | "missing-difficulty"
  | "invalid-difficulty"
  | "missing-tags"
  | "invalid-tag"
  | "rejected-pair"
  | "moderation-conflict"
  | "near-synonym"
  | "contains-word"
  | "shared-stem"
  | "similar-spelling"
  | "multi-word";

const WARNING_RULES = new Set<ReviewRule>(["near-synonym", "contains-word", "shared-stem", "similar-spelling", "multi-word"]);

export type ReviewIssue = {
  severity: ReviewSeverity;
  rule: ReviewRule;
  /** Position of the entry in the reviewed list. */
  index: number;
  pairId: string | null;
  /** Display form, e.g. "Mountain / Hill". */
  pair: string;
  message: string;
  /** The reviewer's reason when a warning was accepted after review; null otherwise. */
  acknowledgement: string | null;
};

export type WordBankReport = {
  entries: number;
  issues: ReviewIssue[];
  errors: ReviewIssue[];
  /** Warnings that still need a decision. */
  warnings: ReviewIssue[];
  /** Warnings a reviewer has accepted, with their reason. */
  acknowledged: ReviewIssue[];
  /** Playable pairs per category and difficulty. */
  coverage: Record<WordCategory, Record<Difficulty, number>>;
  /** True when there are no errors and no open warnings. */
  passed: boolean;
};

export type RejectedPair = { words: readonly [string, string]; reason: string };
export type Acknowledgement = { words: readonly [string, string]; rules: readonly ReviewRule[]; note: string };
type ModerationLike = { moderate(text: string, knownWords: readonly string[]): { outcome: string } };

/**
 * Pairs reviewed and rejected for gameplay reasons. Any of them reappearing (in either order)
 * is an error. Mountain / Hill is the regression case that started this review.
 */
export const rejectedWordPairs: readonly RejectedPair[] = [
  { words: ["Mountain", "Hill"], reason: "A hill is just a smaller mountain: climb, peak, slope and view fit both, so the Imposter blends in without trying." },
  { words: ["Sofa", "Couch"], reason: "Synonyms in ordinary usage." },
  { words: ["Ocean", "Sea"], reason: "Heavy overlap; used interchangeably." },
  { words: ["Road", "Street"], reason: "Closely overlapping meanings." },
  { words: ["Cup", "Mug"], reason: "Near-identical everyday drinking vessels." },
  { words: ["Bicycle", "Bike"], reason: "Interchangeable: bike is short for bicycle." },
  { words: ["Doctor", "Physician"], reason: "Synonyms." },
  { words: ["Laptop", "Notebook"], reason: "Often interchangeable (notebook computer)." },
  { words: ["Telescope", "Microscope"], reason: "Too similar: both are lens-based magnifiers, so clues like lens, zoom, magnify and eyepiece fit both." },
  // Removed from the previous word bank:
  { words: ["Beach", "Island"], reason: "Islands are known for their beaches: sand, sea and holiday clues fit both." },
  { words: ["Pasta", "Noodles"], reason: "Pasta is often called noodles; most clues fit both." },
  { words: ["Pancake", "Waffle"], reason: "The same batter cooked two ways: breakfast, syrup and batter fit both." },
  { words: ["Eagle", "Falcon"], reason: "Interchangeable birds of prey for most players; few everyday clues separate them." },
  { words: ["Crocodile", "Alligator"], reason: "Practically the same animal for ordinary players; the differences are trivia." },
  { words: ["Cinema", "Theatre"], reason: "In Indian English 'theatre' usually means a cinema hall." },
  { words: ["Trailer", "Teaser"], reason: "Both are short promotional clips; near-synonyms." },
  { words: ["Comedy", "Sitcom"], reason: "A sitcom is a kind of comedy; little separation." },
  { words: ["Museum", "Gallery"], reason: "Art museums and galleries overlap heavily." },
  { words: ["Hostel", "Dormitory"], reason: "Interchangeable student-housing terms." },
  { words: ["Notebook", "Diary"], reason: "A diary is a kind of notebook; overlapping usage." },
  { words: ["Wallet", "Purse"], reason: "Interchangeable in Indian English, where purse often means wallet." },
  { words: ["Browser", "Search"], reason: "Overlapping concepts (you search in the browser; Google is both), not distinct things." },
  { words: ["Server", "Cloud"], reason: "In everyday computing the cloud is servers." },
  { words: ["Password", "Passkey"], reason: "Two forms of the same login secret, sharing the 'pass' stem." },
  { words: ["Teacher", "Professor"], reason: "Both teach classes; a professor is a kind of teacher." },
  { words: ["Pilot", "Captain"], reason: "Airline pilots are called captain; captain also spans ships and teams." },
  { words: ["Exam", "Quiz"], reason: "A quiz is a short exam; near-synonyms." },
  { words: ["Assignment", "Project"], reason: "Used interchangeably for college coursework." },
  { words: ["Canteen", "Cafeteria"], reason: "Synonyms." }
];

/**
 * Words that ordinary players use interchangeably (synonyms, variants, regional names).
 * A pair with both words in one group is flagged for review. Only list genuinely
 * interchangeable words here: different-but-related things (Glacier / Iceberg) belong in the bank.
 */
export const nearSynonymGroups: readonly (readonly string[])[] = [
  ["mountain", "hill", "hillock", "mount", "peak"],
  ["sofa", "couch", "settee"],
  ["ocean", "sea"],
  ["road", "street", "lane", "avenue"],
  ["cup", "mug"],
  ["bicycle", "bike", "cycle"],
  ["motorcycle", "motorbike", "bike"],
  ["doctor", "physician", "medic"],
  ["laptop", "notebook"],
  ["notebook", "diary", "journal", "notepad"],
  ["canteen", "cafeteria", "mess"],
  ["wallet", "purse"],
  ["hostel", "dormitory", "dorm"],
  ["museum", "gallery"],
  ["exam", "examination", "test", "quiz"],
  ["pasta", "noodles", "spaghetti"],
  ["cinema", "theatre", "theater", "multiplex"],
  ["trailer", "teaser", "promo", "preview"],
  ["comedy", "sitcom"],
  ["teacher", "professor", "lecturer", "tutor"],
  ["pilot", "captain", "aviator"],
  ["server", "cloud"],
  ["password", "passkey", "passcode"],
  ["assignment", "homework", "project"],
  ["crocodile", "alligator"],
  ["eagle", "falcon", "hawk"],
  ["frog", "toad"],
  ["turtle", "tortoise"],
  ["cheetah", "leopard", "jaguar"],
  ["octopus", "squid"],
  ["donkey", "mule"],
  ["rabbit", "hare", "bunny"],
  ["forest", "jungle", "woods"],
  ["lake", "pond"],
  ["river", "stream"],
  ["boat", "ship"],
  ["beach", "shore", "seashore", "coast"],
  ["pancake", "waffle", "crepe"],
  ["muffin", "cupcake"],
  ["biscuit", "cookie"],
  ["candy", "sweets", "toffee"],
  ["jam", "jelly", "marmalade"],
  ["butter", "ghee"],
  ["yogurt", "curd", "dahi"],
  ["lemon", "lime"],
  ["jail", "prison", "lockup"],
  ["shop", "store"],
  ["hotel", "motel", "inn", "lodge"],
  ["restaurant", "eatery", "diner"],
  ["fort", "fortress", "castle", "citadel"],
  ["pharmacy", "chemist", "drugstore"],
  ["taxi", "cab"],
  ["car", "automobile"],
  ["plane", "airplane", "aeroplane", "aircraft", "jet"],
  ["truck", "lorry"],
  ["elevator", "lift"],
  ["metro", "subway", "underground"],
  ["fridge", "refrigerator"],
  ["television", "tv"],
  ["phone", "mobile", "cellphone", "smartphone"],
  ["photo", "picture", "photograph"],
  ["film", "movie"],
  ["gift", "present"],
  ["stone", "rock", "pebble"],
  ["garbage", "trash", "rubbish"],
  ["child", "kid"],
  ["city", "town"],
  ["comet", "meteor", "asteroid"]
];

/** Warnings a reviewer has looked at and accepted. Errors can never be acknowledged. */
export const acknowledgedWarnings: readonly Acknowledgement[] = [
  {
    words: ["Basketball", "Volleyball"],
    rules: ["shared-stem"],
    note: "Different sports that happen to share the 'ball' compound; hoop, dribble and dunk versus net, spike and beach keep them apart."
  }
];

export type ReviewOptions = {
  rejected?: readonly RejectedPair[];
  synonymGroups?: readonly (readonly string[])[];
  acknowledged?: readonly Acknowledgement[];
  /**
   * Chat moderation used to confirm that neither player is blocked from typing the partner
   * word (a block would reveal the pair). Defaults to the real engine; pass null to skip.
   */
  moderation?: ModerationLike | null;
};

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES: readonly string[] = categorySchema.options;
const DIFFICULTIES: readonly string[] = difficultySchema.options;
/** Endings that do not make two words related ("Singing" / "Dancing", "Elevator" / "Escalator"). */
const GRAMMATICAL_SUFFIXES = [
  "ations", "ation", "tions", "tion", "sions", "sion", "ments", "ment", "ness", "ators", "ator", "ings", "ing",
  "able", "ible", "ance", "ence", "ists", "ist", "isms", "ism", "ers", "er", "ors", "or", "ies", "es", "ed", "s"
];

export function reviewWordBank(entries: readonly unknown[], options: ReviewOptions = {}): WordBankReport {
  const rejected = indexByPair(options.rejected ?? rejectedWordPairs);
  const acknowledged = indexByPair(options.acknowledged ?? acknowledgedWarnings);
  const synonymLookup = buildSynonymLookup(options.synonymGroups ?? nearSynonymGroups);
  const moderation = options.moderation === undefined ? defaultModeration(entries) : options.moderation;

  const issues: ReviewIssue[] = [];
  const seenIds = new Map<string, string>();
  const seenPairs = new Map<string, string>();

  entries.forEach((entry, index) => {
    const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const pairId = typeof raw?.id === "string" && raw.id.trim() ? raw.id : null;
    const label = raw ? `${display(raw.wordA)} / ${display(raw.wordB)}` : "(not an object)";
    const report = (rule: ReviewRule, message: string, words?: readonly [string, string]) => {
      const severity: ReviewSeverity = WARNING_RULES.has(rule) ? "warning" : "error";
      const accepted = severity === "warning" && words ? acknowledged.get(unorderedKey(words[0], words[1])) : undefined;
      const note = accepted && accepted.rules.includes(rule) ? accepted.note : null;
      issues.push({ severity, rule, index, pairId, pair: label, message, acknowledgement: note });
    };

    if (!raw) {
      report("invalid-entry", `Entry #${index} is ${entry === null ? "null" : typeof entry}, not a word pair object.`);
      return;
    }

    // Identity
    if (!pairId) report("invalid-id", "Missing id.");
    else if (!ID_PATTERN.test(pairId)) report("invalid-id", `Id "${pairId}" must be lowercase kebab-case (e.g. "nature-05").`);
    if (pairId) {
      const earlier = seenIds.get(pairId.toLowerCase());
      if (earlier !== undefined) report("duplicate-id", `Id "${pairId}" is already used by entry #${earlier}.`);
      else seenIds.set(pairId.toLowerCase(), String(index));
    }

    // Category, difficulty, tags
    if (raw.category === undefined || raw.category === null || raw.category === "") report("missing-category", "Missing category.");
    else if (typeof raw.category !== "string" || !CATEGORIES.includes(raw.category)) {
      report("invalid-category", `Unknown category ${JSON.stringify(raw.category)}. Use one of: ${CATEGORIES.join(", ")}.`);
    }
    if (raw.difficulty === undefined || raw.difficulty === null || raw.difficulty === "") report("missing-difficulty", "Missing difficulty.");
    else if (typeof raw.difficulty !== "string" || !DIFFICULTIES.includes(raw.difficulty)) {
      report("invalid-difficulty", `Unknown difficulty ${JSON.stringify(raw.difficulty)}. Use one of: ${DIFFICULTIES.join(", ")}.`);
    }
    if (!Array.isArray(raw.tags) || raw.tags.length === 0) {
      report("missing-tags", "Add at least one tag naming what links the two words (their shared context).");
    } else {
      const bad = raw.tags.filter((tag) => typeof tag !== "string" || !TAG_PATTERN.test(tag));
      if (bad.length > 0) report("invalid-tag", `Tags must be lowercase kebab-case strings: ${bad.map((tag) => JSON.stringify(tag)).join(", ")}.`);
    }

    // Words
    let wordsOk = true;
    for (const field of ["wordA", "wordB"] as const) {
      const word = raw[field];
      if (word === undefined || word === null || (typeof word === "string" && word.trim() === "")) {
        report("empty-word", `${field} is empty.`);
        wordsOk = false;
      } else if (!isPlayableWord(word)) {
        report("invalid-word", `${field} ${JSON.stringify(word)} must be letters only (single spaces or hyphens between words), at most 24 characters, with no surrounding spaces.`);
        wordsOk = false;
      }
    }
    if (!wordsOk) return;
    const wordA = raw.wordA as string;
    const wordB = raw.wordB as string;
    const words = [wordA, wordB] as const;
    const a = normalizeWord(wordA);
    const b = normalizeWord(wordB);

    if (a === b) {
      report("identical-words", `Both words are "${wordA}".`);
      return;
    }

    // Duplicates (case- and spacing-insensitive)
    const orderedKey = `${a}|${b}`;
    const earlier = seenPairs.get(orderedKey);
    const earlierReversed = seenPairs.get(`${b}|${a}`);
    if (earlier !== undefined) report("duplicate-pair", `Duplicates entry ${earlier}.`, words);
    else if (earlierReversed !== undefined) report("reversed-duplicate", `Same pair as entry ${earlierReversed}, in reverse order.`, words);
    if (!seenPairs.has(orderedKey)) seenPairs.set(orderedKey, pairId ? `"${pairId}" (#${index})` : `#${index}`);

    const rejection = rejected.get(unorderedKey(wordA, wordB));
    if (rejection) report("rejected-pair", `Previously reviewed and rejected: ${rejection.reason}`, words);

    // Variants and look-alikes
    if (isInflection(a, b)) {
      report("word-variant", `"${wordA}" and "${wordB}" are forms of the same word.`, words);
    } else if (a.includes(b) || b.includes(a)) {
      const [inner, outer] = a.length < b.length ? [wordA, wordB] : [wordB, wordA];
      report("contains-word", `"${outer}" contains "${inner}". Likely a variant, and chat moderation would hold back the longer word for the shorter word's owner.`, words);
    } else {
      const stem = sharedStem(a, b);
      if (stem) report("shared-stem", `The words share "${stem}", which often marks variants (Pancake / Cupcake, Password / Passkey).`, words);
      const distance = levenshtein(a, b);
      const shortest = Math.min(a.length, b.length);
      if ((shortest >= 5 && distance <= 2) || (shortest >= 3 && distance <= 1)) {
        report("similar-spelling", `"${wordA}" and "${wordB}" are only ${distance} edit${distance === 1 ? "" : "s"} apart (possible spelling variant or easy mix-up).`, words);
      }
    }

    const group = sharedSynonymGroup(a, b, synonymLookup);
    if (group) report("near-synonym", `Listed as near-synonyms (${group.join(", ")}): players may treat them as the same thing.`, words);

    for (const word of words) {
      if (/[ '-]/.test(word)) report("multi-word", `"${word}" has several parts; exact-word checks (clues, the Imposter's guess) are less reliable for it.`, words);
    }

    // Chat moderation must never block a player for typing the other word of their own pair.
    if (moderation) {
      for (const [own, other] of [[wordA, wordB], [wordB, wordA]]) {
        for (const text of [other, `is it ${other}?`]) {
          const { outcome } = moderation.moderate(text, [own]);
          if (outcome !== "ALLOW") {
            report("moderation-conflict", `Chat moderation withholds "${text}" from a player whose word is "${own}" (${outcome}), which would reveal the pair.`, words);
          }
        }
      }
    }
  });

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning" && issue.acknowledgement === null);
  const acknowledgedIssues = issues.filter((issue) => issue.acknowledgement !== null);
  return {
    entries: entries.length,
    issues,
    errors,
    warnings,
    acknowledged: acknowledgedIssues,
    coverage: coverageOf(entries),
    passed: errors.length === 0 && warnings.length === 0
  };
}

/** Plain-text report for the terminal. */
export function formatWordBankReport(report: WordBankReport): string {
  const lines: string[] = [];
  const playable = Object.values(report.coverage).reduce((sum, row) => sum + row.Easy + row.Medium + row.Hard, 0);
  lines.push(
    `Word-pair review: ${report.entries} entries, ${playable} playable pairs, ${report.errors.length} errors, ` +
      `${report.warnings.length} open warnings, ${report.acknowledged.length} acknowledged.`
  );

  lines.push("", "Coverage (playable pairs per category and difficulty)");
  lines.push(`  ${"Category".padEnd(13)}${"Easy".padStart(6)}${"Medium".padStart(8)}${"Hard".padStart(6)}${"Total".padStart(7)}`);
  const totals = { Easy: 0, Medium: 0, Hard: 0 };
  for (const [category, row] of Object.entries(report.coverage)) {
    const total = row.Easy + row.Medium + row.Hard;
    totals.Easy += row.Easy;
    totals.Medium += row.Medium;
    totals.Hard += row.Hard;
    lines.push(`  ${category.padEnd(13)}${String(row.Easy).padStart(6)}${String(row.Medium).padStart(8)}${String(row.Hard).padStart(6)}${String(total).padStart(7)}`);
  }
  lines.push(`  ${"Total".padEnd(13)}${String(totals.Easy).padStart(6)}${String(totals.Medium).padStart(8)}${String(totals.Hard).padStart(6)}${String(playable).padStart(7)}`);

  const describe = (issue: ReviewIssue) => `  #${issue.index} ${issue.pairId ?? "(no id)"}  ${issue.pair}  [${issue.rule}] ${issue.message}`;
  if (report.errors.length > 0) lines.push("", "Errors (the pair cannot ship until fixed)", ...report.errors.map(describe));
  if (report.warnings.length > 0) {
    lines.push("", "Warnings (fix the pair, or record why it is fine in acknowledgedWarnings)", ...report.warnings.map(describe));
  }
  if (report.acknowledged.length > 0) {
    lines.push("", "Acknowledged after human review", ...report.acknowledged.map((issue) => `${describe(issue)}\n      Reviewer: ${issue.acknowledgement}`));
  }
  lines.push("", report.passed ? "Result: PASSED" : "Result: FAILED");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultModeration(entries: readonly unknown[]): ModerationLike {
  const bankWords = entries.flatMap((entry) => {
    const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return [raw.wordA, raw.wordB].filter((word): word is string => typeof word === "string");
  });
  return createModerationEngine({ bankWords });
}

function coverageOf(entries: readonly unknown[]): WordBankReport["coverage"] {
  const coverage = Object.fromEntries(
    categorySchema.options.map((category) => [category, { Easy: 0, Medium: 0, Hard: 0 }])
  ) as WordBankReport["coverage"];
  for (const entry of entries) if (isPlayableWordPair(entry)) coverage[entry.category][entry.difficulty] += 1;
  return coverage;
}

function display(value: unknown): string {
  return typeof value === "string" ? (value.trim() ? value : `"${value}"`) : value === undefined ? "?" : JSON.stringify(value);
}

function unorderedKey(first: string, second: string): string {
  return [normalizeWord(first), normalizeWord(second)].sort().join("|");
}

function indexByPair<T extends { words: readonly [string, string] }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [unorderedKey(item.words[0], item.words[1]), item]));
}

/** Forms a word can take in a synonym lookup: itself and its singular. */
function lookupForms(word: string): string[] {
  const forms = [word];
  if (word.length > 3 && word.endsWith("es")) forms.push(word.slice(0, -2));
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) forms.push(word.slice(0, -1));
  return forms;
}

type SynonymLookup = { groups: readonly (readonly string[])[]; groupIndexesByWord: Map<string, number[]> };

function buildSynonymLookup(groups: readonly (readonly string[])[]): SynonymLookup {
  const groupIndexesByWord = new Map<string, number[]>();
  groups.forEach((group, groupIndex) => {
    for (const word of group) {
      const key = normalizeWord(word);
      groupIndexesByWord.set(key, [...(groupIndexesByWord.get(key) ?? []), groupIndex]);
    }
  });
  return { groups, groupIndexesByWord };
}

/** The first synonym group containing both words (in any listed form), or null. */
function sharedSynonymGroup(a: string, b: string, lookup: SynonymLookup): readonly string[] | null {
  const groupsOf = (word: string) => new Set(lookupForms(word).flatMap((form) => lookup.groupIndexesByWord.get(form) ?? []));
  const groupsOfB = groupsOf(b);
  const shared = [...groupsOf(a)].find((group) => groupsOfB.has(group));
  return shared === undefined ? null : lookup.groups[shared];
}

function isInflection(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long === `${short}s` || long === `${short}es` || (short.endsWith("y") && long === `${short.slice(0, -1)}ies`);
}

/** A meaningful shared prefix (4+ letters), ending (3+ letters beyond grammar endings) or inner chunk (5+ letters). */
function sharedStem(a: string, b: string): string | null {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  if (prefix >= 4) return a.slice(0, prefix);

  let suffix = 0;
  while (suffix < a.length && suffix < b.length && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  if (suffix >= 4) {
    const ending = a.slice(a.length - suffix);
    const grammatical = GRAMMATICAL_SUFFIXES.find((candidate) => ending.endsWith(candidate)) ?? "";
    if (ending.length - grammatical.length >= 3) return ending;
  }

  const common = longestCommonSubstring(a, b);
  return common.length >= 5 ? common : null;
}

function longestCommonSubstring(a: string, b: string): string {
  let best = "";
  const lengths: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = b.length; j >= 1; j -= 1) {
      lengths[j] = a[i - 1] === b[j - 1] ? lengths[j - 1] + 1 : 0;
      if (lengths[j] > best.length) best = a.slice(i - lengths[j], i);
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
