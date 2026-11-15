import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/*
 * Password hashing with Node's built-in scrypt (no extra dependency).
 * Parameters follow OWASP's scrypt guidance for a memory-limited host:
 * N=2^15, r=8, p=3 uses about 32 MB per hash, which fits Render's free instance.
 * The parameters are stored with each hash so they can be raised later without
 * breaking existing accounts.
 */

const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, keyLength, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_LENGTH, { ...PARAMS, maxmem: MAX_MEMORY });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/** Constant-time comparison. Returns false (never throws) for a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  // Refuse parameters this server would never have written (protects against a tampered record).
  if (!Number.isInteger(N) || N < 2 ** 10 || N > 2 ** 17 || (N & (N - 1)) !== 0) return false;
  if (!Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 8) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || expected.length < 32) return false;
  const actual = await derive(password, salt, expected.length, { N, r, p, maxmem: MAX_MEMORY });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | null = null;

/**
 * A real hash of a random password. Login checks unknown usernames against it so the
 * response takes as long as for a real account and does not reveal which usernames exist.
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}
