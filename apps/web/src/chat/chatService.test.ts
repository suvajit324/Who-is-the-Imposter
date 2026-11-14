import { describe, expect, it, vi } from "vitest";
import { defaultSettings, type ChatMessage } from "@imposter/shared";
import { applyHistory, applyLive, chatAvailability, createClientMessageId, emptyChatLog } from "./chatService.js";

vi.mock("../state/socket.js", () => ({ socket: {} }));

const msg = (seq: number, epoch = "e1", text = `m${seq}`): ChatMessage => ({
  id: `${epoch}-${seq}`,
  epoch,
  seq,
  kind: "player",
  playerId: "p1",
  playerName: "Asha",
  text,
  sentAt: 1_700_000_000_000 + seq
});

describe("chat log merging", () => {
  it("ignores duplicate deliveries of the same message", () => {
    let log = applyHistory(emptyChatLog, { roomCode: "ABCDEF", epoch: "e1", messages: [msg(1), msg(2)] });
    const again = applyLive(log, msg(2));
    expect(again.log).toBe(log);
    expect(again.needsResync).toBe(false);
    log = applyLive(log, msg(3)).log;
    log = applyHistory(log, { roomCode: "ABCDEF", epoch: "e1", messages: [msg(1), msg(2), msg(3)] });
    expect(log.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
  });

  it("orders by server sequence regardless of arrival order", () => {
    let log = applyHistory(emptyChatLog, { roomCode: "ABCDEF", epoch: "e1", messages: [msg(1)] });
    log = applyLive(log, msg(3)).log;
    log = applyLive(log, msg(2)).log;
    expect(log.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
  });

  it("requests a resync when a gap reveals missed messages", () => {
    const log = applyHistory(emptyChatLog, { roomCode: "ABCDEF", epoch: "e1", messages: [msg(1)] });
    expect(applyLive(log, msg(2)).needsResync).toBe(false);
    expect(applyLive(log, msg(5)).needsResync).toBe(true);
  });

  it("replaces the log when a new game (epoch) starts", () => {
    const log = applyHistory(emptyChatLog, { roomCode: "ABCDEF", epoch: "e1", messages: [msg(1), msg(2)] });
    const reset = applyHistory(log, { roomCode: "ABCDEF", epoch: "e2", messages: [] });
    expect(reset).toEqual({ epoch: "e2", messages: [] });
    const live = applyLive(log, msg(1, "e2"));
    expect(live.log.messages.map((message) => message.id)).toEqual(["e2-1"]);
    expect(live.needsResync).toBe(true);
  });
});

describe("chat availability", () => {
  it("is only open during discussion", () => {
    expect(chatAvailability("DISCUSSION", defaultSettings).open).toBe(true);
    for (const phase of ["LOBBY", "ROLE_ASSIGNMENT", "CLUE_PHASE", "VOTING", "RUNOFF_VOTING", "VOTE_RESULT", "GAME_END", "CANCELLED"] as const) {
      expect(chatAvailability(phase, defaultSettings).open).toBe(false);
    }
    expect(chatAvailability("VOTING", defaultSettings).notice).toBe("Voting has started. Chat is now closed.");
    expect(chatAvailability("LOBBY", { ...defaultSettings, discussionEnabled: false }).notice).toMatch(/turned off/);
  });
});

describe("client message ids", () => {
  it("are unique and match the server's accepted format", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createClientMessageId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[a-f0-9]{32}$/);
  });
});
