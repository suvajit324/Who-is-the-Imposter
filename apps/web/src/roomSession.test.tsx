import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings, type PublicPlayer, type PublicRoomState } from "@imposter/shared";
import { App } from "./App.js";

type Handler = (...args: unknown[]) => void;

// A fake socket: tests trigger server events and decide how each emitted event is answered.
const fake = vi.hoisted(() => ({
  handlers: new Map<string, Set<(...args: unknown[]) => void>>(),
  answers: new Map<string, unknown>()
}));

vi.mock("./state/socket.js", () => ({
  socket: {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      if (!fake.handlers.has(event)) fake.handlers.set(event, new Set());
      fake.handlers.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Handler) => fake.handlers.get(event)?.delete(handler)),
    emit: vi.fn((event: string, _payload: unknown, ack?: (response: unknown) => void) => {
      if (ack && fake.answers.has(event)) ack(fake.answers.get(event));
    })
  },
  SESSION_INVALID: "SESSION_INVALID",
  ACCOUNTS_UNAVAILABLE: "ACCOUNTS_UNAVAILABLE",
  reconnectSocket: vi.fn()
}));

const serverSends = (event: string, ...args: unknown[]) =>
  act(() => {
    for (const handler of [...(fake.handlers.get(event) ?? [])]) handler(...args);
  });

const player = (id: string, name: string, overrides: Partial<PublicPlayer> = {}): PublicPlayer => ({
  id,
  name,
  initials: name.slice(0, 2).toUpperCase(),
  connected: true,
  ready: true,
  host: false,
  score: 0,
  submittedClue: false,
  submittedVote: false,
  profile: null,
  ...overrides
});

const lobby = (players: PublicPlayer[]): PublicRoomState => ({
  roomCode: "ABC234",
  phase: "LOBBY",
  players,
  hostId: players.find((candidate) => candidate.host)?.id ?? null,
  settings: defaultSettings,
  roundNumber: 0,
  totalRounds: defaultSettings.rounds,
  deadline: null,
  clues: [],
  voteSubmittedCount: 0,
  voteEligibleCount: 0,
  runoffCandidateIds: [],
  latestResult: null,
  roundHistory: [],
  cancelledReason: null,
  persistenceEnabled: true
});

const credentials = { roomCode: "ABC234", playerId: "p-host-0001", reconnectToken: "r".repeat(43) };
const resumed = (state: PublicRoomState) => ({ ok: true, ...credentials, state });

beforeEach(() => {
  fake.handlers.clear();
  fake.answers.clear();
  window.location.hash = "";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, storage: "mongodb" }), { status: 200 })));
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function enterRoomAsHost(state: PublicRoomState) {
  localStorage.setItem("imposter.credentials", JSON.stringify(credentials));
  fake.answers.set("room:reconnect-player", resumed(state));
  render(<App />);
  serverSends("connect");
  expect(await screen.findByRole("heading", { name: "ABC234" })).toBeInTheDocument();
}

describe("leaving a room the server no longer has", () => {
  it("returns to the start page with an explanation when the seat cannot be resumed", async () => {
    await enterRoomAsHost(lobby([player(credentials.playerId, "Ana", { host: true })]));

    // The server restarted while the player was offline: resuming the seat now fails.
    fake.answers.set("room:reconnect-player", { ok: false, message: "Reconnect failed. Please rejoin from the lobby if the game has not started." });
    serverSends("disconnect", "transport close");
    serverSends("connect");

    expect(await screen.findByText(/You are no longer in room ABC234/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ABC234" })).toBeNull();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(localStorage.getItem("imposter.credentials")).toBeNull();
  });

  it("quietly forgets an old seat on page load", async () => {
    localStorage.setItem("imposter.credentials", JSON.stringify(credentials));
    fake.answers.set("room:reconnect-player", { ok: false, message: "Reconnect failed." });
    render(<App />);
    serverSends("connect");
    await act(async () => undefined);
    expect(localStorage.getItem("imposter.credentials")).toBeNull();
    expect(screen.queryByText(/You are no longer in room/)).toBeNull();
  });

  it("leaves the room view when the host removes this player", async () => {
    await enterRoomAsHost(lobby([player(credentials.playerId, "Ana", { host: true })]));
    serverSends("room:error", "You were removed from the room.");
    expect(await screen.findByText("You were removed from the room.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ABC234" })).toBeNull();
    expect(localStorage.getItem("imposter.credentials")).toBeNull();
  });
});

describe("entering a room", () => {
  it("sends one request even if Create Room is clicked twice, and allows a retry after a refusal", async () => {
    const { socket } = await import("./state/socket.js");
    render(<App />);
    await act(async () => undefined);
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ana" } });
    const create = screen.getByRole("button", { name: /Create Room/ });
    fireEvent.click(create);
    fireEvent.click(create);
    const creates = () => vi.mocked(socket.emit).mock.calls.filter(([event]) => event === "room:create");
    expect(creates()).toHaveLength(1);
    expect(create).toBeDisabled();

    // The server answers with a refusal: the button is usable again.
    const ack = creates()[0][2] as (response: unknown) => void;
    act(() => ack({ ok: false, message: "Room not found. Check the code and try again." }));
    expect(screen.getByRole("alert")).toHaveTextContent("Room not found.");
    expect(create).toBeEnabled();
  });
});

describe("lobby start rule", () => {
  it("lets the host start when every connected player is ready, even if someone who left still holds a seat", async () => {
    await enterRoomAsHost(
      lobby([
        player(credentials.playerId, "Ana", { host: true }),
        player("p-ben-000001", "Ben"),
        player("p-cy-0000001", "Cy"),
        player("p-dee-000001", "Dee", { connected: false, ready: false })
      ])
    );
    expect(screen.getByText("3/3 ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Game/ })).toBeEnabled();
  });

  it("keeps Start disabled while a connected player is not ready or fewer than three are connected", async () => {
    await enterRoomAsHost(
      lobby([
        player(credentials.playerId, "Ana", { host: true }),
        player("p-ben-000001", "Ben", { ready: false }),
        player("p-cy-0000001", "Cy")
      ])
    );
    expect(screen.getByText("2/3 ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Game/ })).toBeDisabled();

    serverSends("room:state", lobby([player(credentials.playerId, "Ana", { host: true }), player("p-ben-000001", "Ben"), player("p-cy-0000001", "Cy", { connected: false })]));
    expect(screen.getByText("2/2 ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start Game/ })).toBeDisabled();
  });
});
