import { useSyncExternalStore } from "react";

/*
 * Minimal hash router (no dependency). Hash URLs work on GitHub Pages, which cannot
 * rewrite unknown paths to index.html.
 *   #/                    dashboard
 *   #/login, #/register   sign in / create account
 *   #/profile             your own profile
 *   #/players/<username>  someone's public profile
 *   #/leaderboard         all-time points leaderboard
 */

export type Route =
  | { name: "home" }
  | { name: "login" }
  | { name: "register" }
  | { name: "profile" }
  | { name: "player"; username: string }
  | { name: "leaderboard" };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/\/+$/, "") || "/";
  if (path === "/login") return { name: "login" };
  if (path === "/register") return { name: "register" };
  if (path === "/profile") return { name: "profile" };
  if (path === "/leaderboard") return { name: "leaderboard" };
  const player = path.match(/^\/players\/([A-Za-z0-9_]{1,20})$/);
  if (player) return { name: "player", username: player[1] };
  return { name: "home" };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "home":
      return "#/";
    case "player":
      return `#/players/${encodeURIComponent(route.username)}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  const target = hrefFor(route);
  if (window.location.hash !== target) window.location.hash = target;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}

const snapshot = () => window.location.hash;

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, snapshot, () => ""));
}

/** Room code from an invite link (`?room=ABC123`), if it is well-formed. */
export function inviteRoomCode(search = window.location.search): string {
  const code = new URLSearchParams(search).get("room")?.trim().toUpperCase() ?? "";
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : "";
}

/** The shareable link for a room: this page's own address (path included) plus `?room=`. */
export function inviteLinkFor(roomCode: string, location: Pick<Location, "origin" | "pathname"> = window.location): string {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(roomCode)}`;
}
