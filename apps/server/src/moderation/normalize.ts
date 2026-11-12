/**
 * Message normalisation for moderation.
 *
 * Everything here is pure and word-agnostic: it turns raw chat text into
 * comparable "letter forms" so that obfuscations such as `F U N N Y`,
 * `f.u.n.n.y`, `fu_nny`, `fuuunnny`, `FUNNY`, `fünny` or `f0nny` collapse to
 * the same shape as the word they hide.
 */

/** Look-alike letters from other scripts (Cyrillic, Greek) folded to Latin. Keyed by code point to keep the source ASCII. */
const CONFUSABLES = new Map<number, string>([
  [0x0430, "a"], [0x0435, "e"], [0x043e, "o"], [0x0440, "p"], [0x0441, "c"], [0x0445, "x"], [0x0443, "y"],
  [0x043a, "k"], [0x043c, "m"], [0x0442, "t"], [0x0432, "b"], [0x043d, "h"], [0x0456, "i"], [0x0458, "j"],
  [0x0455, "s"], [0x0501, "d"], [0x0261, "g"], [0x04cf, "l"], [0x0457, "i"], [0x0451, "e"],
  [0x03bf, "o"], [0x03b1, "a"], [0x03b5, "e"], [0x03b9, "i"], [0x03ba, "k"], [0x03bd, "v"], [0x03c1, "p"],
  [0x03c4, "t"], [0x03c5, "u"], [0x03c7, "x"], [0x03b2, "b"], [0x03b7, "n"], [0x03c9, "w"], [0x03bc, "u"]
]);

/** Leetspeak substitutions. Ambiguous symbols map to several letters and produce variants. */
const LEET: Record<string, string[]> = {
  "0": ["o"], "1": ["i", "l"], "3": ["e"], "4": ["a"], "5": ["s"], "6": ["g"], "7": ["t"], "8": ["b"], "9": ["g"],
  "@": ["a"], "$": ["s"], "!": ["i", "l"], "|": ["i", "l"], "+": ["t"]
};
const MAX_VARIANTS = 8;

/** NATO / ICAO spelling alphabet, used to detect words spelled out letter by letter. */
export const NATO_ALPHABET: Record<string, string> = {
  alpha: "a", alfa: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f", golf: "g", hotel: "h",
  india: "i", juliet: "j", juliett: "j", kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o", papa: "p",
  quebec: "q", romeo: "r", sierra: "s", tango: "t", uniform: "u", victor: "v", whiskey: "w", whisky: "w",
  xray: "x", yankee: "y", zulu: "z"
};

export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
};

/** Unicode-normalises, strips accents, lowercases and folds look-alike letters. Punctuation and spacing are kept. */
export function foldText(raw: string): string {
  const decomposed = raw.normalize("NFKC").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
  let out = "";
  for (const char of decomposed) out += CONFUSABLES.get(char.codePointAt(0) ?? 0) ?? char;
  return out;
}

/** Collapses runs of the same character: "fuuunnny" -> "funy". */
export function collapseRepeats(value: string): string {
  return value.replace(/(.)\1+/g, "$1");
}

/**
 * Comparable spelling skeleton: a few spelling-equivalent digraphs are unified and
 * repeated letters collapsed. Applied identically to secrets and to message text.
 */
export function skeleton(letters: string): string {
  return collapseRepeats(letters.replace(/ph/g, "f").replace(/ck/g, "k"));
}

/** Letters only (a-z), after folding. Used for secret words and dictionary terms. */
export function lettersOf(value: string): string {
  return foldText(value).replace(/[^a-z]/g, "");
}

export type Unit = {
  /** The whitespace-separated chunk after folding, with leading/trailing punctuation removed. */
  text: string;
  /** Letter-only spellings after leet substitution (several when a symbol is ambiguous). */
  variants: string[];
  /** Pattern with `*` wildcards for masked words such as `f**k`, or null. */
  mask: string | null;
  /** Numeric value when the chunk is a number (digits or a number word). */
  number: number | null;
};

/** Splits folded text into units, resolving leetspeak and in-word separators ("fu_nny", "f.u.n.n.y"). */
export function tokenize(folded: string): Unit[] {
  const units: Unit[] = [];
  for (const chunk of folded.split(/\s+/)) {
    // Leading "@" is a mention, not leetspeak; trailing "!"/"?" etc. are sentence punctuation.
    const text = chunk.replace(/^[^\p{L}\p{N}$*#]+|[^\p{L}\p{N}*#]+$/gu, "");
    if (!text) continue;
    const hasLetter = /[a-z]/.test(text);
    if (!hasLetter) {
      const digits = text.replace(/[^0-9]/g, "");
      // A lone leet character ("l 1 o n") may stand for a letter in a spelled-out word; it keeps its number value too.
      const leet = text.length === 1 ? (LEET[text] ?? []) : [];
      units.push({ text, variants: [...leet], mask: null, number: digits ? Number(digits) : null });
      continue;
    }
    let variants = [""];
    let mask = "";
    let masked = false;
    for (const char of text) {
      if (char >= "a" && char <= "z") {
        variants = variants.map((variant) => variant + char);
        mask += char;
      } else if (LEET[char]) {
        const options = LEET[char];
        variants = variants.flatMap((variant) => options.map((option) => variant + option)).slice(0, MAX_VARIANTS);
        mask += options[0];
      } else if (char === "*" || char === "#") {
        masked = true;
        mask += "*";
      }
      // Any other symbol (., _, -, ', etc.) is treated as an in-word separator and dropped.
    }
    const letters = variants.filter(Boolean);
    units.push({
      text,
      variants: [...new Set(letters)],
      mask: masked ? mask : null,
      number: NUMBER_WORDS[text] ?? null
    });
  }
  return units;
}

/** Text with punctuation turned into single spaces, for phrase patterns. Keeps apostrophes inside words. */
export function phraseText(folded: string): string {
  return ` ${folded.replace(/[^a-z0-9'\s]/g, " ").replace(/'(?![a-z])|(?<![a-z])'/g, " ").replace(/\s+/g, " ").trim()} `;
}
