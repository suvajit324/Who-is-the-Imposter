import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { clearSession, setSession } from "../state/session.js";

vi.mock("../state/socket.js", () => ({
  socket: { connected: false, connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  SESSION_INVALID: "SESSION_INVALID",
  ACCOUNTS_UNAVAILABLE: "ACCOUNTS_UNAVAILABLE",
  reconnectSocket: vi.fn()
}));

const account = { username: "Nova_7", avatar: "cat" as const, joinedAt: "2026-01-01T00:00:00.000Z" };
const signIn = () => setSession({ token: "t".repeat(43), expiresAt: new Date(Date.now() + 3600_000).toISOString(), account });

type Route = { status: number; body: unknown };
function mockServer(routes: Record<string, Route | ((url: URL, init?: RequestInit) => Route)>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const handler = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    const route = typeof handler === "function" ? handler(url, init) : handler ?? { status: 404, body: { error: "Not found." } };
    return new Response(JSON.stringify(route.body), { status: route.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const base = {
  "GET /health": { status: 200, body: { ok: true, storage: "mongodb" } },
  "GET /api/auth/me": { status: 200, body: account }
};

const emptyStats = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0, winRatePercent: null, totalPoints: 0, bestScore: null };

const historyEntry = (overrides: Record<string, unknown> = {}) => ({
  endedAt: "2026-03-01T10:07:30.000Z",
  durationSeconds: 450,
  roundsPlayed: 3,
  finalScore: 7,
  finalRank: 1,
  outcome: "win",
  counted: true,
  participants: [
    { name: "Nova_7", username: "Nova_7", avatar: "cat", finalScore: 7, finalRank: 1, you: true },
    { name: "Rival", username: "Rival", avatar: "bot", finalScore: 4, finalRank: 2, you: false },
    { name: "Guesty", username: null, avatar: null, finalScore: 1, finalRank: 3, you: false }
  ],
  ...overrides
});

beforeEach(() => {
  window.location.hash = "";
});

afterEach(() => {
  clearSession();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("leaderboard page", () => {
  it("lists ranked players with games, wins and win rate, highlighting you", async () => {
    signIn();
    mockServer({
      ...base,
      "GET /api/leaderboard": {
        status: 200,
        body: {
          generatedAt: "2026-03-01T10:00:00.000Z",
          entries: [
            { rank: 1, username: "Rival", avatar: "bot", gamesPlayed: 4, wins: 3, draws: 0, losses: 1, winRatePercent: 75, totalPoints: 20 },
            { rank: 2, username: "Nova_7", avatar: "cat", gamesPlayed: 3, wins: 2, draws: 0, losses: 1, winRatePercent: 66.7, totalPoints: 15 },
            { rank: 2, username: "Tied", avatar: "moon", gamesPlayed: 3, wins: 2, draws: 0, losses: 1, winRatePercent: 66.7, totalPoints: 15 }
          ]
        }
      }
    });
    window.location.hash = "#/leaderboard";
    render(<App />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["#1Rival4375%20", "#2Nova_73266.7%15", "#2Tied3266.7%15"]);
    expect(rows[1]).toHaveClass("is-me");
    expect(within(rows[0]).getByRole("link", { name: /Rival/ })).toHaveAttribute("href", "#/players/Rival");
  });

  it("shows an empty state and an error state", async () => {
    mockServer({ ...base, "GET /api/leaderboard": { status: 200, body: { generatedAt: "2026-03-01T10:00:00.000Z", entries: [] } } });
    window.location.hash = "#/leaderboard";
    const { unmount } = render(<App />);
    expect(await screen.findByText("No ranked players yet")).toBeInTheDocument();
    unmount();

    mockServer({ ...base, "GET /api/leaderboard": { status: 503, body: { error: "Accounts are temporarily unavailable. Guest play still works." } } });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Accounts are temporarily unavailable.");
  });
});

describe("match history page", () => {
  it("asks guests to sign in instead of loading anything", async () => {
    const fetchMock = mockServer(base);
    window.location.hash = "#/history";
    render(<App />);
    expect(await screen.findByText(/Sign in to see the games you have played/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/me/matches"))).toBe(false);
  });

  it("shows an empty state for a player with no completed games", async () => {
    signIn();
    mockServer({ ...base, "GET /api/me/matches": { status: 200, body: { matches: [], page: 1, pageSize: 10, totalMatches: 0, totalPages: 0 } } });
    window.location.hash = "#/history";
    render(<App />);
    expect(await screen.findByText("No completed games yet")).toBeInTheDocument();
  });

  it("shows outcome, placing and final standings, sends the session token and pages through results", async () => {
    signIn();
    const fetchMock = mockServer({
      ...base,
      "GET /api/me/matches": (url) => ({
        status: 200,
        body: {
          matches: [url.searchParams.get("page") === "2" ? historyEntry({ outcome: "loss", finalRank: 2, finalScore: 3 }) : historyEntry()],
          page: Number(url.searchParams.get("page")),
          pageSize: 10,
          totalMatches: 11,
          totalPages: 2
        }
      })
    });
    window.location.hash = "#/history";
    render(<App />);

    expect(await screen.findByText("1st place · 7 pts")).toBeInTheDocument();
    expect(screen.getByText("Win")).toBeInTheDocument();
    expect(screen.getByText(/Nova_7 \(you\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rival" })).toHaveAttribute("href", "#/players/Rival");
    expect(screen.getByText("Guesty")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Guesty" })).toBeNull();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    const historyCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/me/matches"))!;
    expect((historyCall[1]?.headers as Record<string, string>).Authorization).toBe(`Bearer ${"t".repeat(43)}`);

    fireEvent.click(screen.getByRole("button", { name: /Older/ }));
    expect(await screen.findByText("2nd place · 3 pts")).toBeInTheDocument();
    expect(screen.getByText("Loss")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Older/ })).toBeDisabled();
  });
});

describe("profile statistics", () => {
  it("shows a public player's statistics", async () => {
    mockServer({
      ...base,
      "GET /api/players/Rival": {
        status: 200,
        body: {
          profile: { username: "Rival", avatar: "bot", joinedAt: "2026-01-01T00:00:00.000Z" },
          stats: { gamesPlayed: 3, wins: 2, draws: 0, losses: 1, winRatePercent: 66.7, totalPoints: 15, bestScore: 8 }
        }
      }
    });
    window.location.hash = "#/players/Rival";
    render(<App />);
    expect(await screen.findByText("66.7%")).toBeInTheDocument();
    const tile = (label: string) => screen.getByText(label).closest(".stat-tile");
    expect(tile("Games played")).toHaveTextContent("3");
    expect(tile("Wins")).toHaveTextContent("2");
    expect(tile("Losses")).toHaveTextContent("1");
    expect(tile("Best score")).toHaveTextContent("8");
  });

  it("explains that a new player has no completed games, and links to the match history", async () => {
    signIn();
    mockServer({ ...base, "GET /api/players/Nova_7": { status: 200, body: { profile: account, stats: emptyStats } } });
    window.location.hash = "#/profile";
    render(<App />);
    expect(await screen.findByText(/No completed games yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View match history/ })).toHaveAttribute("href", "#/history");
  });

  it("reports a missing player", async () => {
    mockServer({ ...base, "GET /api/players/Nobody": { status: 404, body: { error: "No player with that username." } } });
    window.location.hash = "#/players/Nobody";
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No player with that username."));
  });
});
