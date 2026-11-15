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

export const matchOutcomeSchema = z.enum(["win", "draw", "loss"]);
export type MatchOutcome = z.infer<typeof matchOutcomeSchema>;

export const playerStatsSchema = z
  .object({
    gamesPlayed: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    draws: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    /** wins / gamesPlayed as a percentage with one decimal; null before the first counted game. */
    winRatePercent: z.number().nullable(),
    totalPoints: z.number().int()
  })
  .strict();
export type PlayerStats = z.infer<typeof playerStatsSchema>;

/** A finished game as it appears on a profile: the player's own result, never words, clues or roles. */
export const recentMatchSchema = z
  .object({
    endedAt: z.string(),
    playerCount: z.number().int().positive(),
    rounds: z.number().int().positive(),
    finalScore: z.number().int(),
    finalRank: z.number().int().positive(),
    outcome: matchOutcomeSchema,
    /** False for games that do not count towards statistics (for example custom word lists). */
    counted: z.boolean()
  })
  .strict();
export type RecentMatch = z.infer<typeof recentMatchSchema>;

export const profileResponseSchema = z
  .object({
    profile: accountSchema,
    stats: playerStatsSchema,
    recentMatches: z.array(recentMatchSchema)
  })
  .strict();
export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const leaderboardEntrySchema = z
  .object({
    rank: z.number().int().positive(),
    username: z.string(),
    avatar: avatarSchema,
    totalPoints: z.number().int(),
    gamesPlayed: z.number().int().positive(),
    wins: z.number().int().nonnegative()
  })
  .strict();
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

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
