import {
  accountSchema,
  authResponseSchema,
  healthResponseSchema,
  leaderboardResponseSchema,
  matchHistoryResponseSchema,
  profileResponseSchema,
  type Account,
  type AuthResponse,
  type AvatarId,
  type LeaderboardResponse,
  type MatchHistoryResponse,
  type ProfileResponse,
  type StorageMode
} from "@imposter/shared";
import { getToken } from "./session.js";

/** Structural stand-in for a zod schema, so the web app does not import zod directly. */
type Schema<T> = { safeParse(data: unknown): { success: true; data: T } | { success: false } };

/** The game server (the same host as the Socket.IO connection). */
export const serverUrl = (import.meta.env.VITE_PUBLIC_SOCKET_URL as string | undefined) ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, schema: Schema<T> | null, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = options.auth ? getToken() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${serverUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "omit",
      cache: "no-store"
    });
  } catch {
    throw new ApiError(0, "Could not reach the game server. It may be waking up; try again in a moment.");
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = typeof (data as { error?: unknown } | null)?.error === "string" ? (data as { error: string }).error : "Something went wrong. Please try again.";
    throw new ApiError(response.status, message);
  }
  if (!schema) return undefined as T;
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ApiError(response.status, "The server sent an unexpected response.");
  return parsed.data;
}

export const api = {
  register: (username: string, password: string, avatar: AvatarId): Promise<AuthResponse> =>
    request("/api/auth/register", authResponseSchema, { method: "POST", body: { username, password, avatar } }),
  login: (username: string, password: string): Promise<AuthResponse> =>
    request("/api/auth/login", authResponseSchema, { method: "POST", body: { username, password } }),
  logout: (): Promise<void> => request("/api/auth/logout", null, { method: "POST", auth: true }),
  me: (): Promise<Account> => request("/api/auth/me", accountSchema, { auth: true }),
  updateAvatar: (avatar: AvatarId): Promise<Account> => request("/api/me", accountSchema, { method: "PATCH", body: { avatar }, auth: true }),
  profile: (username: string): Promise<ProfileResponse> => request(`/api/players/${encodeURIComponent(username)}`, profileResponseSchema),
  leaderboard: (): Promise<LeaderboardResponse> => request("/api/leaderboard", leaderboardResponseSchema),
  /** The signed-in player's own completed matches (the server decides whose, from the token). */
  matchHistory: (page: number): Promise<MatchHistoryResponse> =>
    request(`/api/me/matches?page=${encodeURIComponent(String(page))}`, matchHistoryResponseSchema, { auth: true }),
  /** Where the server keeps accounts right now, or null when it cannot be reached. */
  storageMode: async (): Promise<StorageMode | null> => {
    const health = await request("/health", healthResponseSchema).catch(() => null);
    return health?.storage ?? null;
  }
};
