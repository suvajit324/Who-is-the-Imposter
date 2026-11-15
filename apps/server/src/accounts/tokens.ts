import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url encoded (43 characters). Shown to the client once; never stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The form a token is stored and looked up in. A database leak does not reveal usable tokens. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check so malformed tokens are rejected without touching the database. */
export function looksLikeSessionToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
