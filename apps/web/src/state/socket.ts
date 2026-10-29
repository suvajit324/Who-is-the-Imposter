import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@imposter/shared";

const socketUrl = import.meta.env.VITE_PUBLIC_SOCKET_URL ?? "http://localhost:4000";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl, {
  autoConnect: false,
  transports: ["websocket", "polling"]
});
