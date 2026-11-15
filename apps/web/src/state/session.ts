import { useSyncExternalStore } from "react";
import { authResponseSchema, type Account, type AuthResponse } from "@imposter/shared";

/*
 * The signed-in session lives in sessionStorage, never localStorage: it is scoped to
 * this browser tab and is gone when the tab closes. The token also expires on the
 * server after 12 hours and is revoked on sign-out. No cookies are used.
 */

const SESSION_KEY = "imposter.session";

export type Session = AuthResponse;

type Listener = () => void;
const listeners = new Set<Listener>();
let cached: Session | null | undefined;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function read(): Session | null {
  try {
    const raw = storage()?.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = authResponseSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** The current session, or null when signed out or once the token's expiry has passed. */
export function getSession(): Session | null {
  if (cached === undefined) cached = read();
  if (cached && Date.parse(cached.expiresAt) <= Date.now()) {
    clearSession();
    return null;
  }
  return cached;
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

export function setSession(session: Session): void {
  cached = session;
  try {
    storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage blocked (private mode etc.): the session still works until the tab reloads.
  }
  emit();
}

/** Replaces the cached account details (e.g. after an avatar change) without touching the token. */
export function updateSessionAccount(account: Account): void {
  const current = getSession();
  if (current) setSession({ ...current, account });
}

export function clearSession(): void {
  const hadSession = cached !== null;
  cached = null;
  try {
    storage()?.removeItem(SESSION_KEY);
  } catch {
    // Nothing to remove.
  }
  if (hadSession) emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}
