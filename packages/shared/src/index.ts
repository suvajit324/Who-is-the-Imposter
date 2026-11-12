import { z } from "zod";

export const ROOM_CODE_LENGTH = 6;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

export const gamePhaseSchema = z.enum([
  "LOBBY",
  "ROLE_ASSIGNMENT",
  "CLUE_PHASE",
  "DISCUSSION",
  "VOTING",
  "RUNOFF_VOTING",
  "VOTE_RESULT",
  "GAME_END",
  "CANCELLED"
]);
export type GamePhase = z.infer<typeof gamePhaseSchema>;

export const categorySchema = z.enum([
  "Food",
  "Animals",
  "Sports",
  "Movies",
  "Places",
  "Objects",
  "Technology",
  "Professions",
  "College"
]);
export type WordCategory = z.infer<typeof categorySchema>;

export const difficultySchema = z.enum(["Easy", "Medium", "Hard"]);
export type Difficulty = z.infer<typeof difficultySchema>;

export const settingsSchema = z.object({
  rounds: z.number().int().min(1).max(10),
  clueSeconds: z.number().int().min(10).max(180),
  discussionSeconds: z.number().int().min(0).max(300),
  votingSeconds: z.number().int().min(10).max(180),
  discussionEnabled: z.boolean(),
  categories: z.array(categorySchema).min(1),
  difficulty: z.union([difficultySchema, z.literal("Any")])
});
export type GameSettings = z.infer<typeof settingsSchema>;

export const defaultSettings: GameSettings = {
  rounds: 3,
  clueSeconds: 45,
  discussionSeconds: 30,
  votingSeconds: 30,
  discussionEnabled: true,
  categories: [
    "Food",
    "Animals",
    "Sports",
    "Movies",
    "Places",
    "Objects",
    "Technology",
    "Professions",
    "College"
  ],
  difficulty: "Any"
};

export type PublicPlayer = {
  id: string;
  name: string;
  initials: string;
  connected: boolean;
  ready: boolean;
  host: boolean;
  score: number;
  submittedClue: boolean;
  submittedVote: boolean;
};

export type PublicClue = {
  playerId: string;
  playerName: string;
  clue: string | null;
  missed: boolean;
};

export type VoteOutcome = {
  selectedPlayerId: string | null;
  tiedPlayerIds: string[];
  runoff: boolean;
  unresolvedTie: boolean;
  totalVotes: number;
  abstentions: number;
  counts: Record<string, number>;
};

export type RoundResult = {
  roundNumber: number;
  imposterId: string;
  imposterName: string;
  mainWord: string;
  imposterWord: string;
  selectedPlayerId: string | null;
  selectedPlayerName: string | null;
  correct: boolean;
  imposterGuess: string | null;
  imposterGuessCorrect: boolean;
  voteOutcome: VoteOutcome;
  clues: PublicClue[];
  pointsAwarded: Record<string, number>;
  scores: Record<string, number>;
};

export type PublicRoomState = {
  roomCode: string;
  phase: GamePhase;
  players: PublicPlayer[];
  hostId: string | null;
  settings: GameSettings;
  roundNumber: number;
  totalRounds: number;
  deadline: number | null;
  clues: PublicClue[];
  voteSubmittedCount: number;
  voteEligibleCount: number;
  runoffCandidateIds: string[];
  latestResult: RoundResult | null;
  roundHistory: RoundResult[];
  cancelledReason: string | null;
  persistenceEnabled: boolean;
};

export type PrivateRole = {
  playerId: string;
  roomCode: string;
  roundNumber: number;
  role: "Imposter" | "Normal";
  word: string;
  instruction: string;
};

export type CreateRoomAck = {
  ok: true;
  roomCode: string;
  playerId: string;
  reconnectToken: string;
  state: PublicRoomState;
} | { ok: false; message: string };

export type JoinRoomAck = CreateRoomAck;

export type BasicAck = { ok: true } | { ok: false; message: string };

// ---------------------------------------------------------------------------
// Room discussion chat
// ---------------------------------------------------------------------------

export const CHAT_MAX_LENGTH = 300;
export const CHAT_HISTORY_LIMIT = 200;

export type ChatMessageKind = "player" | "system";

export type ChatMessage = {
  /** Server-generated unique id; used by clients to de-duplicate. */
  id: string;
  /** Identifies one game's chat log. Changes when a brand-new game (rematch) starts. */
  epoch: string;
  /** Monotonic per-room sequence number; defines display order. */
  seq: number;
  kind: ChatMessageKind;
  /** Null for system messages. Always taken from the server-side session, never the payload. */
  playerId: string | null;
  playerName: string | null;
  text: string;
  /** Server timestamp in epoch milliseconds. */
  sentAt: number;
};

export type ChatHistory = {
  roomCode: string;
  epoch: string;
  messages: ChatMessage[];
};

export type ChatSendAck = { ok: true; chatMessage: ChatMessage } | { ok: false; message: string };
export type ChatHistoryAck = ({ ok: true } & ChatHistory) | { ok: false; message: string };

export type ChatTextValidation = { ok: true; text: string } | { ok: false; message: string };

/** Control characters, zero-width characters and bidi overrides (used to spoof or hide text). */
function isInvisibleOrControl(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    code === 0xfeff
  );
}

/**
 * MessageValidator shared by client (instant feedback) and server (authoritative).
 * Normalises whitespace and strips control characters before length checks.
 */
export function validateChatText(raw: unknown): ChatTextValidation {
  if (typeof raw !== "string") return { ok: false, message: "Type a message before sending." };
  const text = raw
    .replace(/./gsu, (char) => (isInvisibleOrControl(char.codePointAt(0) ?? 0) ? " " : char))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { ok: false, message: "Type a message before sending." };
  if (text.length > CHAT_MAX_LENGTH) {
    return { ok: false, message: `Messages can be at most ${CHAT_MAX_LENGTH} characters.` };
  }
  return { ok: true, text };
}

export const chatSendSchema = z.object({
  // Generous raw cap so whitespace-heavy input reaches the validator, but huge payloads are dropped early.
  text: z.string().max(CHAT_MAX_LENGTH * 4),
  clientMessageId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/)
});

export type ServerToClientEvents = {
  "room:state": (state: PublicRoomState) => void;
  "room:error": (message: string) => void;
  "player:secret": (secret: PrivateRole) => void;
  "round:result": (result: RoundResult) => void;
  "chat:message": (message: ChatMessage) => void;
  /** Full chat log replacement (e.g. when a new game resets the chat). */
  "chat:history": (history: ChatHistory) => void;
};

export type ClientToServerEvents = {
  "room:create": (payload: { playerName: string }, ack: (response: CreateRoomAck) => void) => void;
  "room:join": (
    payload: { roomCode: string; playerName: string },
    ack: (response: JoinRoomAck) => void
  ) => void;
  "room:reconnect-player": (
    payload: { roomCode: string; playerId: string; reconnectToken: string },
    ack: (response: JoinRoomAck) => void
  ) => void;
  "player:ready": (payload: { ready: boolean }, ack: (response: BasicAck) => void) => void;
  "settings:update": (payload: Partial<GameSettings>, ack: (response: BasicAck) => void) => void;
  "player:kick": (payload: { playerId: string }, ack: (response: BasicAck) => void) => void;
  "game:start": (_payload: Record<string, never>, ack: (response: BasicAck) => void) => void;
  "role:ack": (_payload: Record<string, never>, ack: (response: BasicAck) => void) => void;
  "clue:submit": (payload: { clue: string }, ack: (response: BasicAck) => void) => void;
  "vote:submit": (payload: { targetPlayerId: string }, ack: (response: BasicAck) => void) => void;
  "imposter:guess": (payload: { guess: string }, ack: (response: BasicAck) => void) => void;
  "game:next-round": (_payload: Record<string, never>, ack: (response: BasicAck) => void) => void;
  "game:rematch": (_payload: Record<string, never>, ack: (response: BasicAck) => void) => void;
  "chat:send": (payload: { text: string; clientMessageId: string }, ack: (response: ChatSendAck) => void) => void;
  "chat:history": (_payload: Record<string, never>, ack: (response: ChatHistoryAck) => void) => void;
};

export const createRoomSchema = z.object({
  playerName: z.string().trim().min(2).max(24)
});

export const joinRoomSchema = z.object({
  roomCode: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/i),
  playerName: z.string().trim().min(2).max(24)
});

export const reconnectSchema = z.object({
  roomCode: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/i),
  playerId: z.string().min(8),
  reconnectToken: z.string().min(24)
});

export const clueSchema = z.object({
  clue: z.string().trim().min(1).max(24)
});

export const voteSchema = z.object({
  targetPlayerId: z.string().min(8)
});

export const imposterGuessSchema = z.object({
  guess: z.string().trim().min(1).max(40)
});
