import { describe, expect, it } from "vitest";
import { hrefFor, inviteLinkFor, inviteRoomCode, parseRoute } from "./router.js";

describe("hash routes", () => {
  it.each([
    ["", { name: "home" }],
    ["#/", { name: "home" }],
    ["#/login", { name: "login" }],
    ["#/register/", { name: "register" }],
    ["#/profile", { name: "profile" }],
    ["#/leaderboard", { name: "leaderboard" }],
    ["#/players/Nova_7", { name: "player", username: "Nova_7" }],
    ["#/players/<script>", { name: "home" }],
    ["#/unknown", { name: "home" }]
  ])("parses %s", (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it("builds links that parse back to the same route", () => {
    for (const route of [{ name: "home" }, { name: "login" }, { name: "profile" }, { name: "player", username: "Nova_7" }] as const) {
      expect(parseRoute(hrefFor(route))).toEqual(route);
    }
  });
});

describe("invite links", () => {
  it("keeps the app's path so GitHub Pages links open the game", () => {
    expect(inviteLinkFor("ABC234", { origin: "https://someone.github.io", pathname: "/Who-is-the-Imposter/" })).toBe(
      "https://someone.github.io/Who-is-the-Imposter/?room=ABC234"
    );
    expect(inviteLinkFor("ABC234", { origin: "http://localhost:5173", pathname: "/" })).toBe("http://localhost:5173/?room=ABC234");
  });

  it("reads only well-formed room codes from the link", () => {
    expect(inviteRoomCode("?room=abc234")).toBe("ABC234");
    expect(inviteRoomCode("?room=ABC23")).toBe("");
    expect(inviteRoomCode("?room=ABC10O")).toBe("");
    expect(inviteRoomCode("?room=%3Cscript%3E")).toBe("");
    expect(inviteRoomCode("")).toBe("");
  });
});
