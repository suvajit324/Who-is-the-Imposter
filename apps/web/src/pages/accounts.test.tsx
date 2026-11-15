import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { clearSession, getSession, setSession } from "../state/session.js";

const socketMock = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn()
}));

vi.mock("../state/socket.js", () => ({
  socket: socketMock,
  SESSION_INVALID: "SESSION_INVALID",
  ACCOUNTS_UNAVAILABLE: "ACCOUNTS_UNAVAILABLE",
  reconnectSocket: () => {
    socketMock.disconnect();
    socketMock.connect();
  }
}));

const account = { username: "Nova_7", avatar: "cat" as const, joinedAt: "2026-01-01T00:00:00.000Z" };
const authResponse = { token: "t".repeat(43), expiresAt: new Date(Date.now() + 3600_000).toISOString(), account };

function respond(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    const route = routes[`${init?.method ?? "GET"} ${path}`] ?? { status: 404, body: { error: "Not found." } };
    return new Response(route.body === null ? null : JSON.stringify(route.body), { status: route.status });
  });
}

beforeEach(() => {
  window.location.hash = "";
  vi.clearAllMocks();
});

afterEach(() => {
  clearSession();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("guest and demo storage", () => {
  it("shows the demo storage banner when the server keeps data in memory", async () => {
    vi.stubGlobal("fetch", respond({ "GET /health": { status: 200, body: { ok: true, storage: "memory", service: "x", persistenceEnabled: false } } }));
    render(<App />);
    expect(await screen.findByText(/erased whenever the server restarts/)).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Sign in/ }).length).toBeGreaterThan(0);
  });

  it("shows no demo banner once MongoDB is connected", async () => {
    const fetchMock = respond({ "GET /health": { status: 200, body: { ok: true, storage: "mongodb" } } });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/erased whenever the server restarts/)).toBeNull();
  });
});

describe("sign in", () => {
  it("signs in, stores the session for this tab and reconnects the game socket", async () => {
    const fetchMock = respond({
      "GET /health": { status: 200, body: { ok: true, storage: "memory" } },
      "POST /api/auth/login": { status: 200, body: authResponse }
    });
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/login";
    render(<App />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nova_7" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse 42" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));

    await waitFor(() => expect(getSession()?.account.username).toBe("Nova_7"));
    expect(socketMock.disconnect).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/");
    const login = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/api/auth/login"))!;
    expect(login[1]?.credentials).toBe("omit");
    expect(JSON.parse(String(login[1]?.body))).toEqual({ username: "nova_7", password: "correct horse 42" });
  });

  it("shows the server's message for a failed sign-in and stays signed out", async () => {
    vi.stubGlobal(
      "fetch",
      respond({
        "GET /health": { status: 200, body: { ok: true, storage: "memory" } },
        "POST /api/auth/login": { status: 401, body: { error: "Incorrect username or password." } }
      })
    );
    window.location.hash = "#/login";
    render(<App />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "nova_7" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");
    expect(getSession()).toBeNull();
  });

  it("checks registration input before contacting the server", async () => {
    const fetchMock = respond({ "GET /health": { status: 200, body: { ok: true, storage: "memory" } } });
    vi.stubGlobal("fetch", fetchMock);
    window.location.hash = "#/register";
    render(<App />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Nova 7" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse 42" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "correct horse 42" } });
    fireEvent.click(screen.getByRole("button", { name: /Create account/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use only letters, numbers and underscores.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/register"))).toBe(false);
  });
});

describe("signed-in dashboard", () => {
  it("plays under the account's username instead of asking for a name", async () => {
    setSession(authResponse);
    vi.stubGlobal(
      "fetch",
      respond({
        "GET /health": { status: 200, body: { ok: true, storage: "mongodb" } },
        "GET /api/auth/me": { status: 200, body: account }
      })
    );
    render(<App />);
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.getAllByText("Nova_7").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Create Room"));
    expect(socketMock.emit).toHaveBeenCalledWith("room:create", { playerName: "Nova_7" }, expect.any(Function));
  });

  it("drops a session the server no longer accepts", async () => {
    setSession(authResponse);
    vi.stubGlobal(
      "fetch",
      respond({
        "GET /health": { status: 200, body: { ok: true, storage: "mongodb" } },
        "GET /api/auth/me": { status: 401, body: { error: "Please sign in again." } }
      })
    );
    render(<App />);
    expect(await screen.findByText(/Your sign-in has expired/)).toBeInTheDocument();
    expect(getSession()).toBeNull();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
  });

  it("prefills the room code from an invite link", async () => {
    vi.stubGlobal("fetch", respond({}));
    window.history.replaceState(null, "", "/?room=abc234");
    render(<App />);
    expect(screen.getByLabelText("Room code")).toHaveValue("ABC234");
    expect(screen.getByText(/Invited to ABC234/)).toBeInTheDocument();
    await act(async () => undefined);
    window.history.replaceState(null, "", "/");
  });
});
