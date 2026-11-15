import { z } from "zod";

// ---------------------------------------------------------------------------
// Player accounts (username + password, no email). Shared by server and web.
// ---------------------------------------------------------------------------

/** Preset avatars. Players pick one; nothing is uploaded. */
export const AVATAR_IDS = ["rocket", "ghost", "cat", "crown", "flame", "gamepad", "bird", "fish", "star", "zap", "moon", "bot"] as const;
export const avatarSchema = z.enum(AVATAR_IDS);
export type AvatarId = z.infer<typeof avatarSchema>;
export const DEFAULT_AVATAR: AvatarId = "rocket";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Usernames need at least ${USERNAME_MIN_LENGTH} characters.`)
  .max(USERNAME_MAX_LENGTH, `Usernames can be at most ${USERNAME_MAX_LENGTH} characters.`)
  .regex(/^[A-Za-z0-9_]+$/, "Use only letters, numbers and underscores.");

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Passwords need at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`);

export const registerRequestSchema = z.object({ username: usernameSchema, password: passwordSchema, avatar: avatarSchema }).strict();
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(PASSWORD_MAX_LENGTH) })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const updateProfileRequestSchema = z.object({ avatar: avatarSchema }).strict();
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

// ---------------------------------------------------------------------------
// Response shapes. Every API response is built from one of these allow-lists
// and validated with .strict(), so an unexpected field can never be sent.
// ---------------------------------------------------------------------------

/** How a signed-in player appears inside a game room. */
export const playerProfileRefSchema = z.object({ username: z.string(), avatar: avatarSchema }).strict();
export type PlayerProfileRef = z.infer<typeof playerProfileRefSchema>;

export const accountSchema = z
  .object({
    username: z.string(),
    avatar: avatarSchema,
    /** ISO 8601 timestamp. */
    joinedAt: z.string()
  })
  .strict();
export type Account = z.infer<typeof accountSchema>;

export const authResponseSchema = z
  .object({
    token: z.string(),
    /** ISO 8601 timestamp after which the token stops working. */
    expiresAt: z.string(),
    account: accountSchema
  })
  .strict();
export type AuthResponse = z.infer<typeof authResponseSchema>;

/**
 * A completed game's result for one player, using the game's own rule that the highest
 * final score wins and players with equal top scores share first place:
 *  - "win":  finished in first place (alone or shared with some, but not all, players);
 *  - "draw": every player finished with the same score;
 *  - "loss": anything else.
 */
export const matchOutcomeSchema = z.enum(["win", "draw", "loss"]);
export type MatchOutcome = z.infer<typeof matchOutcomeSchema>;

export const playerStatsSchema = z
  .object({
    gamesPlayed: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    /** wins / gamesPlayed as a percentage with one decimal; null before the first counted game. */
    winRatePercent: z.number().min(0).max(100).nullable(),
    /** Sum of final scores across counted games. */
    totalPoints: z.number().int().nonnegative(),
    /** Highest final score in a single counted game; null before the first counted game. */
    bestScore: z.number().int().nonnegative().nullable()
  })
  .strict();
export type PlayerStats = z.infer<typeof playerStatsSchema>;

/** A public profile: account details and statistics. Match details are only shown to the player. */
export const profileResponseSchema = z
  .object({
    profile: accountSchema,
    stats: playerStatsSchema
  })
  .strict();
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

/** Another player in a past game, as shown in your own match history. */
export const matchParticipantSchema = z
  .object({
    /** Name shown in the room. */
    name: z.string(),
    /** Set for signed-in players (links to their profile); null for guests. */
    username: z.string().nullable(),
    avatar: avatarSchema.nullable(),
    finalScore: z.number().int().nonnegative(),
    finalRank: z.number().int().positive(),
    /** True for the player viewing their own history. */
    you: z.boolean()
  })
  .strict();
export type MatchParticipant = z.infer<typeof matchParticipantSchema>;

/**
 * One completed game in the signed-in player's history. Final scores and ranks only:
 * never words, clues, roles (who was the Imposter), votes or room codes.
 */
export const matchHistoryEntrySchema = z
  .object({
    endedAt: z.string(),
    durationSeconds: z.number().int().nonnegative(),
    roundsPlayed: z.number().int().positive(),
    finalScore: z.number().int().nonnegative(),
    finalRank: z.number().int().positive(),
    outcome: matchOutcomeSchema,
    /** False for games that do not count towards statistics. */
    counted: z.boolean(),
    participants: z.array(matchParticipantSchema)
  })
  .strict();
export type MatchHistoryEntry = z.infer<typeof matchHistoryEntrySchema>;

export const MATCH_HISTORY_PAGE_SIZE = 10;

export const matchHistoryResponseSchema = z
  .object({
    matches: z.array(matchHistoryEntrySchema),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalMatches: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative()
  })
  .strict();
export type MatchHistoryResponse = z.infer<typeof matchHistoryResponseSchema>;

export const leaderboardEntrySchema = z
  .object({
    rank: z.number().int().positive(),
    username: z.string(),
    avatar: avatarSchema,
    gamesPlayed: z.number().int().positive(),
    wins: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    winRatePercent: z.number().min(0).max(100),
    totalPoints: z.number().int().nonnegative()
  })
  .strict();
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const LEADERBOARD_SIZE = 50;

export const leaderboardResponseSchema = z
  .object({
    entries: z.array(leaderboardEntrySchema),
    generatedAt: z.string()
  })
  .strict();
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

export const apiErrorSchema = z.object({ error: z.string() }).strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Where the server keeps accounts and match records. Only "mongodb" survives a restart. */
export const storageModeSchema = z.enum(["mongodb", "memory", "mongodb-unavailable"]);
export type StorageMode = z.infer<typeof storageModeSchema>;

/** The fields of GET /health that the web client reads. */
export const healthResponseSchema = z.object({ ok: z.boolean(), storage: storageModeSchema });
export type HealthResponse = z.infer<typeof healthResponseSchema>;
