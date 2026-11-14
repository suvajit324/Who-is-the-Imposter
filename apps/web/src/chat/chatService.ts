import type { ChatHistory, ChatHistoryAck, ChatMessage, ChatSendAck, GamePhase, GameSettings } from "@imposter/shared";
import { socket } from "../state/socket.js";

const ACK_TIMEOUT_MS = 6_000;

/** The client's local copy of a room's chat log. */
export type ChatLog = { epoch: string | null; messages: ChatMessage[] };
export const emptyChatLog: ChatLog = { epoch: null, messages: [] };

/** Merges messages, dropping duplicates by id and ordering by server sequence. */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Applies a full history snapshot. A new epoch means a new game, so the log is replaced. */
export function applyHistory(log: ChatLog, history: ChatHistory): ChatLog {
  if (log.epoch !== history.epoch) return { epoch: history.epoch, messages: mergeMessages([], history.messages) };
  return { epoch: log.epoch, messages: mergeMessages(log.messages, history.messages) };
}

/**
 * Applies one live message. Reports `needsResync` when the message reveals that
 * the local log is stale (missed messages after a network blip, or a new game).
 */
export function applyLive(log: ChatLog, message: ChatMessage): { log: ChatLog; needsResync: boolean } {
  if (log.epoch !== null && log.epoch !== message.epoch) {
    return { log: { epoch: message.epoch, messages: [message] }, needsResync: true };
  }
  if (log.messages.some((existing) => existing.id === message.id)) return { log, needsResync: false };
  const lastSeq = log.messages.at(-1)?.seq ?? 0;
  const gap = log.epoch !== null && message.seq > lastSeq + 1;
  return { log: { epoch: message.epoch, messages: mergeMessages(log.messages, [message]) }, needsResync: gap };
}

export type ChatAvailability = { open: boolean; notice: string };

/** Mirrors the server's phase rule so the UI can explain why chat is locked. */
export function chatAvailability(phase: GamePhase, settings: GameSettings): ChatAvailability {
  switch (phase) {
    case "DISCUSSION":
      return { open: true, notice: "Discussion is live. Share your suspicions!" };
    case "VOTING":
    case "RUNOFF_VOTING":
      return { open: false, notice: "Voting has started. Chat is now closed." };
    case "VOTE_RESULT":
      return { open: false, notice: "Chat is closed until the next discussion." };
    case "GAME_END":
    case "CANCELLED":
      return { open: false, notice: "The game has ended. Chat is closed." };
    default:
      if (!settings.discussionEnabled || settings.discussionSeconds === 0) {
        return { open: false, notice: "Discussion is turned off for this game, so chat stays closed." };
      }
      return { open: false, notice: "Chat opens when the discussion phase starts." };
  }
}

/** Unique id per submission, reused on retry so the server can drop duplicates. Works on insecure origins too. */
export function createClientMessageId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function fetchChatHistory(): Promise<ChatHistoryAck> {
  try {
    return await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("chat:history", {});
  } catch {
    return { ok: false, message: "Could not load the chat history." };
  }
}

export async function sendChatMessage(text: string, clientMessageId: string): Promise<ChatSendAck> {
  try {
    return await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("chat:send", { text, clientMessageId });
  } catch {
    return { ok: false, message: "The message did not reach the server. Check your connection and try again." };
  }
}

export function formatChatTime(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
