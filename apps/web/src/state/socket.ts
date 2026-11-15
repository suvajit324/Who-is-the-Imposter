import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@imposter/shared";
import { serverUrl } from "./api.js";
import { getToken } from "./session.js";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  // Read on every (re)connection, so signing in or out takes effect on the next connect.
  auth: (callback) => {
    const token = getToken();
    callback(token ? { token } : {});
  }
});

/** connect_error messages sent by the server's handshake check. */
export const SESSION_INVALID = "SESSION_INVALID";
export const ACCOUNTS_UNAVAILABLE = "ACCOUNTS_UNAVAILABLE";

/** Reconnects with the current identity. Only used outside a room (after signing in or out). */
export function reconnectSocket(): void {
  socket.disconnect();
  socket.connect();
}
