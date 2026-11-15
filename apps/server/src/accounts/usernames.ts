import { createModerationEngine } from "../moderation/index.js";

/** Names that could be mistaken for staff, the game itself or system messages. */
const RESERVED = new Set([
  "admin", "administrator", "mod", "moderator", "staff", "support", "official", "system", "server", "root", "owner",
  "host", "imposter", "impostor", "guest", "anonymous", "unknown", "null", "undefined", "everyone", "here"
]);

// The chat moderator's abuse dictionary, reused so usernames follow the same rules as chat.
const engine = createModerationEngine({ bankWords: [] });

export function usernameKey(username: string): string {
  return username.trim().toLowerCase();
}

/** Returns a player-facing reason when the (already well-formed) username is not allowed. */
export function usernameProblem(username: string): string | null {
  const key = usernameKey(username);
  const core = key.replace(/_/g, "").replace(/\d+$/, "");
  if (RESERVED.has(key) || RESERVED.has(core)) return "That username is reserved. Please choose another.";
  const spaced = username.replace(/_/g, " ");
  if (engine.moderate(spaced, []).outcome === "BLOCK_ABUSIVE_CONTENT" || engine.moderate(key.replace(/_/g, ""), []).outcome === "BLOCK_ABUSIVE_CONTENT") {
    return "That username is not allowed. Please choose another.";
  }
  return null;
}
