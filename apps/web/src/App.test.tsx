import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

vi.mock("./state/socket.js", () => ({
  socket: {
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn()
  }
}));

describe("App", () => {
  it("renders the landing experience", () => {
    render(<App />);
    expect(screen.getByText("Who's the Imposter?")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(screen.getByText("Create Room")).toBeInTheDocument();
  });
});
