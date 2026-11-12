/**
 * Configurable abuse dictionary (English + romanised Hindi/Hinglish, matching the
 * game's player base). This file necessarily contains offensive terms; it exists
 * only so the server can block them.
 *
 * Matching rules (see moderator.ts):
 *  - `token` entries match a whole word (after normalisation), never a substring,
 *    so "class", "pass", "assassin" or "Scunthorpe" are not affected.
 *  - `stem` entries also match words that start with them ("fucking", "bitches").
 *  - `targetedInsults` only count when aimed at a person ("you idiot", "u r dumb");
 *    "that clue is dumb" is allowed.
 *  - Elongated spellings ("fuuuck"), leetspeak ("sh1t"), separators ("f.u.c.k",
 *    "f u c k") and masks ("f**k") are handled by the normaliser.
 */

export type AbuseLexicon = {
  tokens: string[];
  stems: string[];
  /** Nouns like "idiot": blocked after you/u/ur/is/are ... */
  targetedNouns: string[];
  /** Adjectives like "stupid": blocked after you/u/ur/youre ... */
  targetedAdjectives: string[];
  /** Phrase patterns run against normalised text (threats, sexual harassment). */
  patterns: RegExp[];
  /** Words that would otherwise trip a stem (checked against the letter form). */
  allowlist: string[];
};

export const defaultAbuseLexicon: AbuseLexicon = {
  tokens: [
    // English profanity
    "shit", "shits", "shitty", "shithead", "bullshit", "dick", "dickhead", "prick", "twat", "wanker", "bastard",
    "asshole", "arsehole", "ass", "arse", "dumbass", "jackass", "stfu", "mofo", "fck", "fuk", "fcuk", "fvck", "phuck",
    // slurs
    "fag", "fags", "tranny", "chink", "spic", "kike", "paki", "chamar", "bhangi", "katua", "katwa",
    // sexual
    "nude", "nudes", "boobs", "tits", "pussy", "horny", "slut", "sluts", "whore", "whores", "dickpic", "blowjob",
    "randi", "chudai", "chodu", // not "chod": romanised "chhod do" ("leave it") is commonly spelled that way
    // Hindi / Hinglish abuse
    "gandu", "gaandu", "gaand", "lund", "lauda", "lavda", "lavde", "laude", "lodu", "harami", "haramkhor",
    "kamina", "kamine", "kutte", "kutti", "suar", "suvar", "jhaatu", "jhatu", "bsdk", "bkl", "mkc", "tatte"
  ],
  stems: [
    "fuck", "motherfuck", "bitch", "cunt", "nigg", "faggot", "retard", "rapist", "slutt",
    "madarchod", "maderchod", "madarchot", "behenchod", "bhenchod", "bhanchod", "behnchod", "chutiy", "chutia",
    "chootiy", "bhosd", "bhosad", "randwa"
  ],
  targetedNouns: [
    "idiot", "idiots", "moron", "morons", "loser", "losers", "jerk", "imbecile", "clown", "bewakoof", "bevakoof",
    "pagal", "gadha", "ullu", "nalayak", "kameena"
  ],
  targetedAdjectives: ["stupid", "dumb", "pathetic", "worthless", "useless", "ugly", "brainless", "retarded"],
  patterns: [
    // threats
    /\b(?:i ?'?ll|i will|ima|imma|gonna|going to|will|i'm going to|im going to)\s+(?:kill|murder|stab|shoot|hurt|beat|slap|punch|strangle)\s+(?:you|u|ya|ur|your)\b/,
    /\bkill\s+(?:yourself|urself|ur self|your self|yoself|ursel)\b/,
    /\bkys\b/,
    /\bgo\s+(?:and\s+)?die\b/,
    /\b(?:hope|wish)\s+(?:you|u)\s+(?:die|get hurt|get killed)\b/,
    /\b(?:i know|ill find|i will find|i'll find)\s+where\s+(?:you|u)\s+live\b/,
    /\bmar\s+ja\b/,
    /\bmaar\s+(?:dunga|dalunga|dalu|dena)\b/,
    // sexual harassment
    /\bsend\s+(?:me\s+)?(?:your\s+|ur\s+)?(?:nudes|nude|pics|photos|boobs)\b/,
    /\bshow\s+(?:me\s+)?(?:your|ur)\s+(?:boobs|body|tits|pussy|dick)\b/,
    /\b(?:suck|lick)\s+my\b/,
    /\b(?:sleep|have sex)\s+with\s+(?:me|you|u)\b/,
    /\bwanna\s+(?:fuck|bang|hook up)\b/,
    /\b(?:rape|raping)\s+(?:you|u|her|him)\b/
  ],
  allowlist: ["shiitake", "shitake", "retardant", "niggle", "niggles", "niggling", "niggled", "cockpit", "cocktail", "peacock", "scunthorpe", "assassin", "assassinate", "assam", "assamese"]
};
