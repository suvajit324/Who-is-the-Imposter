import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type ChatMessage, type PublicRoomState } from "@imposter/shared";

type Handler = (...args: unknown[]) => void;

const mock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const emitWithAck = vi.fn();
  const socket = {
    connected: true,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => handlers.get(event)?.delete(handler)),
    timeout: vi.fn(() => ({ emitWithAck }))
  };
  return { handlers, emitWithAck, socket };
});

vi.mock("../../state/socket.js", () => ({ socket: mock.socket }));

import { ChatBox } from "./ChatBox.js";

const fire = (event: string, payload: unknown) => act(() => mock.handlers.get(event)?.forEach((handler: Handler) => handler(payload)));

const message = (seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `id-${seq}`,
  epoch: "e1",
  seq,
  kind: "player",
  playerId: "p-bala",
  playerName: "Bala",
  text: `message ${seq}`,
  sentAt: Date.UTC(2026, 0, 1, 12, seq),
  ...overrides
});

function roomState(phase: PublicRoomState["phase"]): PublicRoomState {
  return {
    roomCode: "QWERTY",
    phase,
    players: [],
    hostId: null,
    settings: defaultSettings,
    roundNumber: 1,
    totalRounds: 3,
    deadline: null,
    clues: [],
    voteSubmittedCount: 0,
    voteEligibleCount: 0,
    runoffCandidateIds: [],
    latestResult: null,
    roundHistory: [],
    cancelledReason: null,
    persistenceEnabled: false
  };
}

beforeEach(() => {
  mock.handlers.clear();
  mock.emitWithAck.mockReset();
});

describe("ChatBox", () => {
  it("shows the header, room code, empty state, and locks input outside discussion", async () => {
    mock.emitWithAck.mockResolvedValue({ ok: true, roomCode: "QWERTY", epoch: "e1", messages: [] });
    render(<ChatBox state={roomState("LOBBY")} meId="p-asha" sessionKey={1} />);
    expect(screen.getByRole("heading", { name: "Room Discussion" })).toBeInTheDocument();
    expect(screen.getByText("QWERTY")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No messages yet.")).toBeInTheDocument());
    expect(screen.getByText("Chat opens when the discussion phase starts.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });

  it("renders history and live messages once, with system messages distinguished", async () => {
    mock.emitWithAck.mockResolvedValue({
      ok: true,
      roomCode: "QWERTY",
      epoch: "e1",
      messages: [message(1, { kind: "system", playerId: null, playerName: null, text: "Discussion has started. Chat is open." }), message(2)]
    });
    render(<ChatBox state={roomState("DISCUSSION")} meId="p-asha" sessionKey={1} />);
    await waitFor(() => expect(screen.getByText("message 2")).toBeInTheDocument());
    fire("chat:message", message(3, { playerId: "p-asha", playerName: "Asha", text: "mine" }));
    fire("chat:message", message(3, { playerId: "p-asha", playerName: "Asha", text: "mine" }));
    expect(screen.getAllByText("mine")).toHaveLength(1);
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Discussion has started. Chat is open.").closest("li")).toHaveClass("chat-system");
    expect(screen.getByText("message 2").closest("li")).toHaveClass("chat-msg");
  });

  it("sends trimmed text, clears the input, and shows server errors", async () => {
    mock.emitWithAck.mockImplementation(async (event: string, payload: { text: string }) => {
      if (event === "chat:history") return { ok: true, roomCode: "QWERTY", epoch: "e1", messages: [] };
      if (payload.text === "spam") return { ok: false, message: "You're sending messages too quickly. Slow down a little." };
      return { ok: true, chatMessage: message(1, { playerId: "p-asha", playerName: "Asha", text: payload.text }) };
    });
    render(<ChatBox state={roomState("DISCUSSION")} meId="p-asha" sessionKey={1} />);
    const input = screen.getByLabelText("Message");
    await waitFor(() => expect(input).not.toBeDisabled());

    fireEvent.change(input, { target: { value: "   hello room   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByText("hello room")).toBeInTheDocument());
    expect(input).toHaveValue("");
    expect(mock.emitWithAck).toHaveBeenCalledWith("chat:send", expect.objectContaining({ text: "hello room" }));

    fireEvent.change(input, { target: { value: "spam" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/too quickly/));
    expect(input).toHaveValue("spam");
  });

  it("shows the voting lock notice and keeps earlier messages visible", async () => {
    mock.emitWithAck.mockResolvedValue({ ok: true, roomCode: "QWERTY", epoch: "e1", messages: [message(1)] });
    render(<ChatBox state={roomState("VOTING")} meId="p-asha" sessionKey={1} />);
    await waitFor(() => expect(screen.getByText("message 1")).toBeInTheDocument());
    expect(screen.getByText("Voting has started. Chat is now closed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeDisabled();
  });

  it("clears the log when the server announces a new game", async () => {
    mock.emitWithAck.mockResolvedValue({ ok: true, roomCode: "QWERTY", epoch: "e1", messages: [message(1)] });
    render(<ChatBox state={roomState("LOBBY")} meId="p-asha" sessionKey={1} />);
    await waitFor(() => expect(screen.getByText("message 1")).toBeInTheDocument());
    fire("chat:history", { roomCode: "QWERTY", epoch: "e2", messages: [] });
    expect(screen.queryByText("message 1")).not.toBeInTheDocument();
  });
});
