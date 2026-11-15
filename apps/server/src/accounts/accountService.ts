import { randomUUID } from "node:crypto";
import { accountSchema, authResponseSchema, type Account, type AuthResponse, type AvatarId, type LoginRequest, type RegisterRequest } from "@imposter/shared";
import type { Store, UserRecord } from "../store/index.js";
import { dummyPasswordHash, hashPassword, verifyPassword } from "./passwords.js";
import { FixedWindowLimiter } from "./rateLimiter.js";
import { hashSessionToken, looksLikeSessionToken, newSessionToken } from "./tokens.js";
import { usernameKey, usernameProblem } from "./usernames.js";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** The signed-in identity attached to an HTTP request or a socket. Server-side only. */
export type AuthenticatedUser = {
  userId: string;
  username: string;
  avatar: AvatarId;
  /** Hash of the session token in use, so a logout can close that session's sockets. */
  sessionHash: string;
};

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const INCORRECT_LOGIN = "Incorrect username or password.";

export type AccountServiceOptions = {
  now?: () => number;
  /** Failed logins allowed per username per window before further attempts are refused. */
  loginFailureLimit?: number;
  loginFailureWindowMs?: number;
  /** New accounts allowed across the whole server per window. */
  registrationLimit?: number;
  registrationWindowMs?: number;
};

export class AccountService {
  private readonly now: () => number;
  private readonly loginFailures: FixedWindowLimiter;
  private readonly registrations: FixedWindowLimiter;

  constructor(
    private readonly store: Store,
    options: AccountServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now;
    this.loginFailures = new FixedWindowLimiter(options.loginFailureLimit ?? 10, options.loginFailureWindowMs ?? 15 * 60_000, this.now);
    this.registrations = new FixedWindowLimiter(options.registrationLimit ?? 100, options.registrationWindowMs ?? 10 * 60_000, this.now);
  }

  available(): boolean {
    return this.store.storageMode() !== "mongodb-unavailable";
  }

  async register(input: RegisterRequest): Promise<ServiceResult<AuthResponse>> {
    const problem = usernameProblem(input.username);
    if (problem) return { ok: false, status: 400, error: problem };
    if (input.password.trim().toLowerCase() === usernameKey(input.username)) {
      return { ok: false, status: 400, error: "Your password must be different from your username." };
    }
    if (this.registrations.isLimited("global")) {
      return { ok: false, status: 429, error: "Too many new accounts right now. Please try again in a few minutes." };
    }
    const key = usernameKey(input.username);
    if (await this.store.findUserByUsernameKey(key)) return { ok: false, status: 409, error: "That username is taken." };

    const user: UserRecord = {
      id: randomUUID(),
      username: input.username.trim(),
      usernameKey: key,
      passwordHash: await hashPassword(input.password),
      avatar: input.avatar,
      createdAt: new Date(this.now())
    };
    if ((await this.store.createUser(user)) === "username-taken") return { ok: false, status: 409, error: "That username is taken." };
    this.registrations.record("global");
    return { ok: true, value: await this.startSession(user) };
  }

  async login(input: LoginRequest): Promise<ServiceResult<AuthResponse>> {
    const key = usernameKey(input.username);
    if (this.loginFailures.isLimited(key)) {
      return { ok: false, status: 429, error: "Too many failed sign-in attempts for this username. Please wait 15 minutes and try again." };
    }
    const user = await this.store.findUserByUsernameKey(key);
    // Unknown usernames are checked against a dummy hash so both cases take the same time.
    const valid = await verifyPassword(input.password, user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !valid) {
      this.loginFailures.record(key);
      return { ok: false, status: 401, error: INCORRECT_LOGIN };
    }
    this.loginFailures.reset(key);
    return { ok: true, value: await this.startSession(user) };
  }

  async logout(token: string): Promise<string | null> {
    if (!looksLikeSessionToken(token)) return null;
    const hash = hashSessionToken(token);
    await this.store.deleteSession(hash);
    return hash;
  }

  /** Resolves a bearer token to its user, or null when it is unknown, expired or revoked. */
  async authenticate(token: unknown): Promise<AuthenticatedUser | null> {
    if (!looksLikeSessionToken(token)) return null;
    const hash = hashSessionToken(token);
    const session = await this.store.findSession(hash);
    if (!session) return null;
    if (session.expiresAt.getTime() <= this.now()) {
      await this.store.deleteSession(hash);
      return null;
    }
    const user = await this.store.findUserById(session.userId);
    if (!user) return null;
    return { userId: user.id, username: user.username, avatar: user.avatar, sessionHash: hash };
  }

  async account(userId: string): Promise<Account | null> {
    const user = await this.store.findUserById(userId);
    return user ? toAccount(user) : null;
  }

  async updateAvatar(userId: string, avatar: AvatarId): Promise<Account | null> {
    await this.store.updateUserAvatar(userId, avatar);
    return this.account(userId);
  }

  private async startSession(user: UserRecord): Promise<AuthResponse> {
    const token = newSessionToken();
    const createdAt = new Date(this.now());
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
    await this.store.createSession({ tokenHash: hashSessionToken(token), userId: user.id, createdAt, expiresAt });
    return authResponseSchema.parse({ token, expiresAt: expiresAt.toISOString(), account: toAccount(user) });
  }
}

/** The public view of an account: an explicit allow-list, validated with a strict schema. */
export function toAccount(user: UserRecord): Account {
  return accountSchema.parse({ username: user.username, avatar: user.avatar, joinedAt: user.createdAt.toISOString() });
}
