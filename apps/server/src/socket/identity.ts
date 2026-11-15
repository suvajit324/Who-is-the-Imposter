import type { Server, Socket } from "socket.io";
import type { AccountService, AuthenticatedUser } from "../accounts/accountService.js";

/** connect_error messages the web client understands. */
export const SESSION_INVALID = "SESSION_INVALID";
export const ACCOUNTS_UNAVAILABLE = "ACCOUNTS_UNAVAILABLE";

type IdentityData = { identity?: AuthenticatedUser | null };

/** The signed-in account behind this socket, or null for a guest. Fixed for the socket's lifetime. */
export function socketIdentity(socket: Pick<Socket, "data">): AuthenticatedUser | null {
  return (socket.data as IdentityData).identity ?? null;
}

/**
 * Handshake middleware. A socket without a token connects as a guest. A socket that
 * sends a token must present a valid session: an unknown, expired or revoked token is
 * refused (the client then drops it and reconnects as a guest), so a player never
 * believes they are signed in while the server treats them as a guest.
 */
export function attachSocketIdentity(io: Server, accounts: AccountService): void {
  io.use((socket, next) => {
    const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    const data = socket.data as IdentityData;
    if (token === undefined || token === null || token === "") {
      data.identity = null;
      return next();
    }
    accounts
      .authenticate(token)
      .then((user) => {
        if (!user) return next(new Error(SESSION_INVALID));
        data.identity = user;
        next();
      })
      .catch((error: unknown) => {
        console.error("[socket] Could not verify a session:", error);
        next(new Error(ACCOUNTS_UNAVAILABLE));
      });
  });
}

/** Closes every open socket that was authenticated with the given (now revoked) session. */
export async function disconnectSession(io: Server, sessionHash: string): Promise<void> {
  const sockets = await io.fetchSockets();
  for (const socket of sockets) {
    if ((socket.data as IdentityData).identity?.sessionHash === sessionHash) socket.disconnect(true);
  }
}
