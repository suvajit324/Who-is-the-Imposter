import { randomUUID } from "node:crypto";
import { CHAT_HISTORY_LIMIT, validateChatText, type ChatHistory, type ChatMessage } from "@imposter/shared";

/** Minimum gap between two messages from the same player. */
export const CHAT_MIN_INTERVAL_MS = 400;
/** Burst limit: at most CHAT_BURST_LIMIT messages per CHAT_BURST_WINDOW_MS per player. */
export const CHAT_BURST_LIMIT = 5;
export const CHAT_BURST_WINDOW_MS = 5_000;
/** The same text from the same player is rejected within this window. */
export const CHAT_REPEAT_WINDOW_MS = 5_000;
/** How many recent client message ids are remembered per player for idempotent retries. */
const CLIENT_ID_MEMORY = 50;

type Sender = { id: string; name: string };

type SenderState = {
  recentSends: number[];
  lastText: string | null;
  lastTextAt: number;
  /** clientMessageId -> stored outcome, for idempotent retries after a lost ack. */
  seenClientIds: Map<string, ChatPostResult>;
};

export type ChatPostResult =
  | { ok: true; message: ChatMessage; duplicate: boolean }
  | { ok: false; message: string };

/**
 * Optional final check before a message is accepted (used for moderation). Runs after
 * validation and rate limiting, and before the message is stored or broadcast.
 * `cacheable` rejections are replayed for a retried clientMessageId instead of re-running.
 */
export type ChatScreen = (text: string) => { allow: true } | { allow: false; message: string; cacheable: boolean };

/**
 * ChatService for a single room. Holds an ordered, capped message log and
 * enforces validation, rate limiting and duplicate protection. It knows nothing
 * about game phases or sockets: the RoomManager decides *whether* a player may
 * chat and supplies the verified sender identity.
 */
export class RoomChat {
  private messages: ChatMessage[] = [];
  private seq = 0;
  private epoch = randomUUID();
  private senders = new Map<string, SenderState>();

  constructor(
    readonly roomCode: string,
    private readonly now: () => number = Date.now
  ) {}

  history(): ChatHistory {
    return { roomCode: this.roomCode, epoch: this.epoch, messages: [...this.messages] };
  }

  /** Starts a fresh chat log for a brand-new game. */
  reset(): void {
    this.messages = [];
    this.seq = 0;
    this.epoch = randomUUID();
    this.senders.clear();
  }

  postPlayer(sender: Sender, rawText: unknown, clientMessageId: string, screen?: ChatScreen): ChatPostResult {
    const state = this.senderState(sender.id);

    // Idempotency: a retry of an already-handled submission returns the original outcome
    // (the stored message, or the same moderation rejection without counting it twice).
    const previous = state.seenClientIds.get(clientMessageId);
    if (previous) return previous.ok ? { ...previous, duplicate: true } : previous;

    const validation = validateChatText(rawText);
    if (!validation.ok) return validation;

    const now = this.now();
    state.recentSends = state.recentSends.filter((at) => now - at < CHAT_BURST_WINDOW_MS);
    const last = state.recentSends.at(-1);
    if (last !== undefined && now - last < CHAT_MIN_INTERVAL_MS) {
      return { ok: false, message: "You're sending messages too quickly. Slow down a little." };
    }
    if (state.recentSends.length >= CHAT_BURST_LIMIT) {
      return { ok: false, message: "Too many messages. Wait a few seconds before sending more." };
    }
    if (state.lastText !== null && state.lastText.toLowerCase() === validation.text.toLowerCase() && now - state.lastTextAt < CHAT_REPEAT_WINDOW_MS) {
      return { ok: false, message: "You just sent that message." };
    }

    // Every screened attempt counts toward the rate limit, so rejected messages cannot be
    // used to hammer the moderation path any faster than ordinary chat.
    state.recentSends.push(now);
    if (screen) {
      const verdict = screen(validation.text);
      if (!verdict.allow) {
        const rejected: ChatPostResult = { ok: false, message: verdict.message };
        if (verdict.cacheable) this.remember(state, clientMessageId, rejected);
        return rejected;
      }
    }

    const message = this.append("player", sender, validation.text);
    state.lastText = validation.text;
    state.lastTextAt = now;
    this.remember(state, clientMessageId, { ok: true, message, duplicate: false });
    return { ok: true, message, duplicate: false };
  }

  private remember(state: SenderState, clientMessageId: string, result: ChatPostResult): void {
    state.seenClientIds.set(clientMessageId, result);
    if (state.seenClientIds.size > CLIENT_ID_MEMORY) {
      const oldest = state.seenClientIds.keys().next().value;
      if (oldest !== undefined) state.seenClientIds.delete(oldest);
    }
  }

  postSystem(text: string): ChatMessage {
    return this.append("system", null, text);
  }

  private append(kind: ChatMessage["kind"], sender: Sender | null, text: string): ChatMessage {
    this.seq += 1;
    const message: ChatMessage = {
      id: randomUUID(),
      epoch: this.epoch,
      seq: this.seq,
      kind,
      playerId: sender?.id ?? null,
      playerName: sender?.name ?? null,
      text,
      sentAt: this.now()
    };
    this.messages.push(message);
    if (this.messages.length > CHAT_HISTORY_LIMIT) this.messages.splice(0, this.messages.length - CHAT_HISTORY_LIMIT);
    return message;
  }

  private senderState(playerId: string): SenderState {
    let state = this.senders.get(playerId);
    if (!state) {
      state = { recentSends: [], lastText: null, lastTextAt: 0, seenClientIds: new Map() };
      this.senders.set(playerId, state);
    }
    return state;
  }
}
