import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_LIMIT, CHAT_MAX_LENGTH, validateChatText } from "@imposter/shared";
import { CHAT_BURST_LIMIT, CHAT_BURST_WINDOW_MS, CHAT_MIN_INTERVAL_MS, CHAT_REPEAT_WINDOW_MS, RoomChat } from "../src/domain/chat.js";

const asha = { id: "player-asha", name: "Asha" };

function clockedChat() {
  let now = 1_000_000;
  const chat = new RoomChat("ABCDEF", () => now);
  return { chat, advance: (ms: number) => { now += ms; } };
}

describe("validateChatText (MessageValidator)", () => {
  it("rejects empty and whitespace-only messages", () => {
    expect(validateChatText("")).toMatchObject({ ok: false });
    expect(validateChatText("   \n\t ")).toMatchObject({ ok: false });
    expect(validateChatText(undefined)).toMatchObject({ ok: false });
    expect(validateChatText(42)).toMatchObject({ ok: false });
  });

  it("trims and collapses whitespace and strips control/invisible characters", () => {
    expect(validateChatText("  hello \n\n  there  ")).toEqual({ ok: true, text: "hello there" });
    const zeroWidth = String.fromCodePoint(0x200b);
    const bidiOverride = String.fromCodePoint(0x202e);
    expect(validateChatText(`a${String.fromCodePoint(0)}b${zeroWidth}c${bidiOverride}d`)).toEqual({ ok: true, text: "a b c d" });
    expect(validateChatText(zeroWidth + zeroWidth)).toMatchObject({ ok: false });
  });

  it("enforces the maximum length after normalisation", () => {
    expect(validateChatText("x".repeat(CHAT_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(validateChatText("x".repeat(CHAT_MAX_LENGTH + 1))).toMatchObject({ ok: false, message: expect.stringMatching(/300/) });
    expect(validateChatText(`  ${"x".repeat(CHAT_MAX_LENGTH)}   `)).toMatchObject({ ok: true });
  });

  it("keeps emoji and non-latin text intact", () => {
    expect(validateChatText("Bala sounds sus 🤔 नमस्ते")).toEqual({ ok: true, text: "Bala sounds sus 🤔 नमस्ते" });
  });
});

describe("RoomChat (ChatService)", () => {
  it("assigns increasing sequence numbers and keeps order", () => {
    const { chat, advance } = clockedChat();
    chat.postSystem("Discussion has started.");
    advance(1_000);
    const first = chat.postPlayer(asha, "one", "client-id-0001");
    advance(1_000);
    const second = chat.postPlayer(asha, "two", "client-id-0002");
    expect(first.ok && second.ok).toBe(true);
    expect(chat.history().messages.map((message) => [message.seq, message.text])).toEqual([[1, "Discussion has started."], [2, "one"], [3, "two"]]);
  });

  it("treats a repeated clientMessageId as the same message (idempotent retry)", () => {
    const { chat } = clockedChat();
    const first = chat.postPlayer(asha, "hello", "client-id-0001");
    const retry = chat.postPlayer(asha, "hello", "client-id-0001");
    expect(first.ok && retry.ok).toBe(true);
    if (!first.ok || !retry.ok) return;
    expect(retry.duplicate).toBe(true);
    expect(retry.message.id).toBe(first.message.id);
    expect(chat.history().messages).toHaveLength(1);
  });

  it("rate limits fast and bursty senders", () => {
    const { chat, advance } = clockedChat();
    expect(chat.postPlayer(asha, "m0", "client-id-1000").ok).toBe(true);
    expect(chat.postPlayer(asha, "m1", "client-id-1001")).toMatchObject({ ok: false, message: expect.stringMatching(/too quickly/) });
    for (let index = 1; index < CHAT_BURST_LIMIT; index += 1) {
      advance(CHAT_MIN_INTERVAL_MS);
      expect(chat.postPlayer(asha, `m${index}`, `client-id-200${index}`).ok).toBe(true);
    }
    advance(CHAT_MIN_INTERVAL_MS);
    expect(chat.postPlayer(asha, "burst", "client-id-3000")).toMatchObject({ ok: false, message: expect.stringMatching(/Too many/) });
    advance(CHAT_BURST_WINDOW_MS);
    expect(chat.postPlayer(asha, "later", "client-id-3001").ok).toBe(true);
  });

  it("rejects the same text sent twice in a short window", () => {
    const { chat, advance } = clockedChat();
    expect(chat.postPlayer(asha, "Bala is sus", "client-id-0001").ok).toBe(true);
    advance(CHAT_MIN_INTERVAL_MS);
    expect(chat.postPlayer(asha, "bala is SUS", "client-id-0002")).toMatchObject({ ok: false, message: expect.stringMatching(/just sent/) });
    advance(CHAT_REPEAT_WINDOW_MS);
    expect(chat.postPlayer(asha, "Bala is sus", "client-id-0003").ok).toBe(true);
  });

  it("does not let one player's limits affect another", () => {
    const { chat } = clockedChat();
    expect(chat.postPlayer(asha, "hi", "client-id-0001").ok).toBe(true);
    expect(chat.postPlayer({ id: "player-bala", name: "Bala" }, "hi", "client-id-0001").ok).toBe(true);
  });

  it("caps history and resets with a fresh epoch for a new game", () => {
    const { chat } = clockedChat();
    for (let index = 0; index < CHAT_HISTORY_LIMIT + 25; index += 1) chat.postSystem(`event ${index}`);
    const before = chat.history();
    expect(before.messages).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(before.messages.at(-1)?.seq).toBe(CHAT_HISTORY_LIMIT + 25);
    chat.reset();
    const after = chat.history();
    expect(after.messages).toHaveLength(0);
    expect(after.epoch).not.toBe(before.epoch);
    expect(chat.postSystem("fresh").seq).toBe(1);
  });
});
