import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Server, Socket } from "socket.io";
import {
  defaultSettings,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type BasicAck,
  type CreateRoomAck,
  type GamePhase,
  type GameSettings,
  type PrivateRole,
  type PublicClue,
  type PublicPlayer,
  type PublicRoomState,
  type RoundResult,
  type ServerToClientEvents,
  type ClientToServerEvents,
  type VoteOutcome
} from "@imposter/shared";
import { fallbackWordBank, type WordPair } from "../data/wordBank.js";
import { validateClue } from "./clues.js";
import { selectImposter } from "./imposter.js";
import { calculateScores } from "./scoring.js";
import { resolveVotes, validateVote } from "./voting.js";
import { selectWordPair } from "./words.js";

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;

type Player = {
  id: string;
  name: string;
  socketId: string | null;
  reconnectToken: string;
  connected: boolean;
  ready: boolean;
  host: boolean;
  score: number;
  disconnectedAt: number | null;
  roleAcked: boolean;
};

type RoundState = {
  number: number;
  imposterId: string;
  pair: WordPair;
  normalWord: string;
  imposterWord: string;
  clues: Map<string, string>;
  votes: Map<string, string>;
  runoffVotes: Map<string, string>;
  runoffCandidateIds: string[];
  result: RoundResult | null;
};

type Room = {
  code: string;
  phase: GamePhase;
  players: Map<string, Player>;
  settings: GameSettings;
  roundNumber: number;
  usedWordPairIds: Set<string>;
  imposterCounts: Record<string, number>;
  round: RoundState | null;
  roundHistory: RoundResult[];
  deadline: number | null;
  timer: NodeJS.Timeout | null;
  phaseNonce: number;
  cancelledReason: string | null;
  createdAt: number;
  lastEntryAtByIp: Map<string, number>;
};

type Persistence = {
  enabled: boolean;
  saveCompletedGame: (state: PublicRoomState) => Promise<void>;
};

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROLE_REVEAL_SECONDS = 12;
const RECONNECT_GRACE_MS = 60_000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly io: GameServer,
    private readonly persistence: Persistence,
    private readonly wordBank = fallbackWordBank
  ) {}

  createRoom(socket: GameSocket, playerName: string, ip = "unknown"): CreateRoomAck {
    if (this.tooSoon(ip)) return { ok: false, message: "Please wait a moment before creating another room." };
    const code = this.generateUniqueCode();
    const player = this.createPlayer(playerName, socket.id, true);
    const room: Room = {
      code,
      phase: "LOBBY",
      players: new Map([[player.id, player]]),
      settings: structuredClone(defaultSettings),
      roundNumber: 0,
      usedWordPairIds: new Set(),
      imposterCounts: {},
      round: null,
      roundHistory: [],
      deadline: null,
      timer: null,
      phaseNonce: 0,
      cancelledReason: null,
      createdAt: Date.now(),
      lastEntryAtByIp: new Map([[ip, Date.now()]])
    };
    this.rooms.set(code, room);
    this.attachSocket(socket, room, player);
    return { ok: true, roomCode: code, playerId: player.id, reconnectToken: player.reconnectToken, state: this.publicState(room) };
  }

  joinRoom(socket: GameSocket, roomCode: string, playerName: string, ip = "unknown"): CreateRoomAck {
    const room = this.rooms.get(roomCode.toUpperCase());
    if (!room) return { ok: false, message: "Room not found. Check the code and try again." };
    if (room.phase !== "LOBBY") return { ok: false, message: "This game has already started." };
    if (room.players.size >= MAX_PLAYERS) return { ok: false, message: "This room is full." };
    const duplicate = [...room.players.values()].some((player) => player.name.toLowerCase() === playerName.trim().toLowerCase());
    if (duplicate) return { ok: false, message: "That player name is already taken in this room." };

    const player = this.createPlayer(playerName, socket.id, false);
    room.players.set(player.id, player);
    room.lastEntryAtByIp.set(ip, Date.now());
    this.attachSocket(socket, room, player);
    this.broadcast(room);
    return { ok: true, roomCode: room.code, playerId: player.id, reconnectToken: player.reconnectToken, state: this.publicState(room) };
  }

  reconnect(socket: GameSocket, roomCode: string, playerId: string, token: string): CreateRoomAck {
    const room = this.rooms.get(roomCode.toUpperCase());
    const player = room?.players.get(playerId);
    if (!room || !player || !this.tokenMatches(player.reconnectToken, token)) {
      return { ok: false, message: "Reconnect failed. Please rejoin from the lobby if the game has not started." };
    }
    player.socketId = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    this.attachSocket(socket, room, player);
    this.broadcast(room);
    this.sendSecretIfActive(room, player);
    return { ok: true, roomCode: room.code, playerId: player.id, reconnectToken: player.reconnectToken, state: this.publicState(room) };
  }

  setReady(socket: GameSocket, ready: boolean): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (context.room.phase !== "LOBBY") return { ok: false, message: "Readiness can only change in the lobby." };
    context.player.ready = context.player.host ? true : ready;
    this.broadcast(context.room);
    return { ok: true };
  }

  updateSettings(socket: GameSocket, patch: Partial<GameSettings>): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (!context.player.host) return { ok: false, message: "Only the host can update settings." };
    if (context.room.phase !== "LOBBY") return { ok: false, message: "Settings are locked after the game starts." };
    context.room.settings = { ...context.room.settings, ...patch };
    context.room.settings.rounds = Math.min(10, Math.max(1, Math.trunc(context.room.settings.rounds)));
    context.room.settings.clueSeconds = Math.min(180, Math.max(10, Math.trunc(context.room.settings.clueSeconds)));
    context.room.settings.discussionSeconds = Math.min(300, Math.max(0, Math.trunc(context.room.settings.discussionSeconds)));
    context.room.settings.votingSeconds = Math.min(180, Math.max(10, Math.trunc(context.room.settings.votingSeconds)));
    if (context.room.settings.categories.length === 0) context.room.settings.categories = defaultSettings.categories;
    this.broadcast(context.room);
    return { ok: true };
  }

  kick(socket: GameSocket, targetPlayerId: string): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (!context.player.host) return { ok: false, message: "Only the host can kick players." };
    if (targetPlayerId === context.player.id) return { ok: false, message: "The host cannot kick themselves." };
    const target = context.room.players.get(targetPlayerId);
    if (!target) return { ok: false, message: "Player not found." };
    context.room.players.delete(target.id);
    if (target.socketId) this.io.to(target.socketId).emit("room:error", "You were removed from the room.");
    this.broadcast(context.room);
    return { ok: true };
  }

  startGame(socket: GameSocket): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    const { room, player } = context;
    if (!player.host) return { ok: false, message: "Only the host can start the game." };
    if (room.phase !== "LOBBY") return { ok: false, message: "The game is already running." };
    const connected = this.connectedPlayers(room);
    if (connected.length < MIN_PLAYERS) return { ok: false, message: "At least three players are required." };
    if (!connected.every((candidate) => candidate.host || candidate.ready)) return { ok: false, message: "All connected players must be ready." };
    this.beginRound(room);
    return { ok: true };
  }

  acknowledgeRole(socket: GameSocket): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (context.room.phase !== "ROLE_ASSIGNMENT") return { ok: false, message: "There is no role reveal to acknowledge." };
    context.player.roleAcked = true;
    const allAcked = this.connectedPlayers(context.room).every((player) => player.roleAcked);
    if (allAcked) this.startClues(context.room);
    else this.broadcast(context.room);
    return { ok: true };
  }

  submitClue(socket: GameSocket, clue: string): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    const { room, player } = context;
    if (room.phase !== "CLUE_PHASE" || !room.round) return { ok: false, message: "Clues are not open right now." };
    if (Date.now() > (room.deadline ?? 0)) return { ok: false, message: "The clue deadline has passed." };
    if (room.round.clues.has(player.id)) return { ok: false, message: "You already submitted a clue." };
    const error = validateClue(clue, [...room.round.clues.values()], [room.round.normalWord, room.round.imposterWord]);
    if (error) return { ok: false, message: error };
    room.round.clues.set(player.id, clue.trim());
    if (this.connectedPlayers(room).every((candidate) => room.round?.clues.has(candidate.id))) {
      this.advanceAfterClues(room);
    } else {
      this.broadcast(room);
    }
    return { ok: true };
  }

  submitVote(socket: GameSocket, targetPlayerId: string): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    const { room, player } = context;
    if (!room.round || !["VOTING", "RUNOFF_VOTING"].includes(room.phase)) return { ok: false, message: "Voting is not open." };
    if (Date.now() > (room.deadline ?? 0)) return { ok: false, message: "The voting deadline has passed." };
    const eligible = this.eligiblePlayerIds(room);
    const candidates = room.phase === "RUNOFF_VOTING" ? room.round.runoffCandidateIds : eligible;
    const error = validateVote(player.id, targetPlayerId, eligible, candidates);
    if (error) return { ok: false, message: error };
    const voteMap = room.phase === "RUNOFF_VOTING" ? room.round.runoffVotes : room.round.votes;
    if (voteMap.has(player.id)) return { ok: false, message: "Your vote is already locked." };
    voteMap.set(player.id, targetPlayerId);
    if (eligible.every((id) => voteMap.has(id))) {
      this.finishVoting(room);
    } else {
      this.broadcast(room);
    }
    return { ok: true };
  }

  submitImposterGuess(socket: GameSocket, guess: string): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    const { room, player } = context;
    const result = room.round?.result;
    if (room.phase !== "VOTE_RESULT" || !room.round || !result) return { ok: false, message: "Guessing is not open." };
    if (player.id !== room.round.imposterId) return { ok: false, message: "Only the Imposter can guess the main word." };
    if (!result.correct) return { ok: false, message: "The Imposter only guesses when caught." };
    if (result.imposterGuess) return { ok: false, message: "The guess has already been submitted." };

    result.imposterGuess = guess.trim();
    result.imposterGuessCorrect = guess.trim().toLowerCase() === room.round.normalWord.toLowerCase();
    if (result.imposterGuessCorrect) {
      result.pointsAwarded[player.id] = (result.pointsAwarded[player.id] ?? 0) + 2;
      result.scores[player.id] = (result.scores[player.id] ?? 0) + 2;
      player.score += 2;
    }
    this.broadcast(room);
    this.io.to(room.code).emit("round:result", result);
    return { ok: true };
  }

  nextRound(socket: GameSocket): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (!context.player.host) return { ok: false, message: "Only the host can continue." };
    if (context.room.phase !== "VOTE_RESULT") return { ok: false, message: "The current round is not complete." };
    if (context.room.roundNumber >= context.room.settings.rounds) this.endGame(context.room);
    else this.beginRound(context.room);
    return { ok: true };
  }

  rematch(socket: GameSocket): BasicAck {
    const context = this.context(socket);
    if (!context) return { ok: false, message: "Join a room first." };
    if (!context.player.host) return { ok: false, message: "Only the host can start a rematch." };
    const room = context.room;
    this.clearTimer(room);
    room.phase = "LOBBY";
    room.roundNumber = 0;
    room.round = null;
    room.roundHistory = [];
    room.usedWordPairIds.clear();
    room.imposterCounts = {};
    room.deadline = null;
    room.cancelledReason = null;
    for (const player of room.players.values()) {
      player.score = 0;
      player.ready = player.host;
      player.roleAcked = false;
    }
    this.broadcast(room);
    return { ok: true };
  }

  disconnect(socket: GameSocket): void {
    const context = this.context(socket);
    if (!context) return;
    const { room, player } = context;
    player.connected = false;
    player.socketId = null;
    player.disconnectedAt = Date.now();
    socket.leave(room.code);
    if (room.phase === "LOBBY") {
      this.scheduleLobbyRemoval(room, player.id);
    } else {
      this.scheduleGameDisconnectCheck(room, player.id);
      if (this.connectedPlayers(room).length < MIN_PLAYERS) {
        this.cancelRoom(room, "Too few connected players remain to continue.");
      }
    }
    this.transferHostIfNeeded(room);
    this.broadcast(room);
  }

  private beginRound(room: Room): void {
    this.clearTimer(room);
    const players = this.connectedPlayers(room);
    if (players.length < MIN_PLAYERS) {
      this.cancelRoom(room, "At least three connected players are required.");
      return;
    }
    room.roundNumber += 1;
    const imposterId = selectImposter(players.map((player) => player.id), room.imposterCounts);
    room.imposterCounts[imposterId] = (room.imposterCounts[imposterId] ?? 0) + 1;
    const pair = selectWordPair(this.wordBank, room.settings, room.usedWordPairIds);
    room.usedWordPairIds.add(pair.id);
    const flip = Math.random() >= 0.5;
    room.round = {
      number: room.roundNumber,
      imposterId,
      pair,
      normalWord: flip ? pair.wordA : pair.wordB,
      imposterWord: flip ? pair.wordB : pair.wordA,
      clues: new Map(),
      votes: new Map(),
      runoffVotes: new Map(),
      runoffCandidateIds: [],
      result: null
    };
    for (const player of room.players.values()) player.roleAcked = false;
    room.phase = "ROLE_ASSIGNMENT";
    this.setDeadline(room, ROLE_REVEAL_SECONDS, () => this.startClues(room));
    this.broadcast(room);
    for (const player of players) this.sendSecretIfActive(room, player);
  }

  private startClues(room: Room): void {
    if (room.phase !== "ROLE_ASSIGNMENT") return;
    room.phase = "CLUE_PHASE";
    this.setDeadline(room, room.settings.clueSeconds, () => this.advanceAfterClues(room));
    this.broadcast(room);
  }

  private advanceAfterClues(room: Room): void {
    if (room.phase !== "CLUE_PHASE") return;
    if (room.settings.discussionEnabled && room.settings.discussionSeconds > 0) {
      room.phase = "DISCUSSION";
      this.setDeadline(room, room.settings.discussionSeconds, () => this.startVoting(room));
    } else {
      this.startVoting(room);
    }
    this.broadcast(room);
  }

  private startVoting(room: Room): void {
    if (!["CLUE_PHASE", "DISCUSSION"].includes(room.phase)) return;
    room.phase = "VOTING";
    room.round?.votes.clear();
    this.setDeadline(room, room.settings.votingSeconds, () => this.finishVoting(room));
    this.broadcast(room);
  }

  private finishVoting(room: Room): void {
    if (!room.round) return;
    if (room.phase === "VOTING") {
      const outcome = resolveVotes(room.round.votes, this.eligiblePlayerIds(room));
      if (outcome.tiedPlayerIds.length > 1) {
        room.phase = "RUNOFF_VOTING";
        room.round.runoffCandidateIds = outcome.tiedPlayerIds;
        room.round.runoffVotes.clear();
        this.setDeadline(room, room.settings.votingSeconds, () => this.finishVoting(room));
        this.broadcast(room);
        return;
      }
      this.revealResult(room, outcome);
      return;
    }

    if (room.phase === "RUNOFF_VOTING") {
      const outcome = resolveVotes(room.round.runoffVotes, this.eligiblePlayerIds(room), room.round.runoffCandidateIds, true);
      this.revealResult(room, outcome);
    }
  }

  private revealResult(room: Room, voteOutcome: VoteOutcome): void {
    if (!room.round) return;
    room.phase = "VOTE_RESULT";
    this.clearTimer(room);
    const playerIds = [...room.players.keys()];
    const imposter = room.players.get(room.round.imposterId);
    const selected = voteOutcome.selectedPlayerId ? room.players.get(voteOutcome.selectedPlayerId) : null;
    const pointsAwarded = calculateScores({
      playerIds,
      imposterId: room.round.imposterId,
      votes: room.round.votes,
      selectedPlayerId: voteOutcome.selectedPlayerId,
      imposterGuessCorrect: false
    });
    for (const [id, points] of Object.entries(pointsAwarded)) {
      const player = room.players.get(id);
      if (player) player.score += points;
    }
    const scores = Object.fromEntries([...room.players.values()].map((player) => [player.id, player.score]));
    const result: RoundResult = {
      roundNumber: room.round.number,
      imposterId: room.round.imposterId,
      imposterName: imposter?.name ?? "Unknown",
      mainWord: room.round.normalWord,
      imposterWord: room.round.imposterWord,
      selectedPlayerId: selected?.id ?? null,
      selectedPlayerName: selected?.name ?? null,
      correct: selected?.id === room.round.imposterId,
      imposterGuess: null,
      imposterGuessCorrect: false,
      voteOutcome,
      clues: this.publicClues(room),
      pointsAwarded,
      scores
    };
    room.round.result = result;
    room.roundHistory.push(result);
    this.broadcast(room);
    this.io.to(room.code).emit("round:result", result);
  }

  private endGame(room: Room): void {
    room.phase = "GAME_END";
    this.clearTimer(room);
    this.broadcast(room);
    void this.persistence.saveCompletedGame(this.publicState(room));
  }

  private cancelRoom(room: Room, reason: string): void {
    room.phase = "CANCELLED";
    room.cancelledReason = reason;
    this.clearTimer(room);
    this.broadcast(room);
  }

  private setDeadline(room: Room, seconds: number, callback: () => void): void {
    this.clearTimer(room);
    room.deadline = Date.now() + seconds * 1000;
    const nonce = ++room.phaseNonce;
    room.timer = setTimeout(() => {
      if (room.phaseNonce === nonce) callback();
    }, seconds * 1000);
  }

  private clearTimer(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    room.deadline = null;
  }

  private publicState(room: Room): PublicRoomState {
    return {
      roomCode: room.code,
      phase: room.phase,
      players: [...room.players.values()].map((player): PublicPlayer => ({
        id: player.id,
        name: player.name,
        initials: initials(player.name),
        connected: player.connected,
        ready: player.ready,
        host: player.host,
        score: player.score,
        submittedClue: Boolean(room.round?.clues.has(player.id)),
        submittedVote: this.hasSubmittedCurrentVote(room, player.id)
      })),
      hostId: [...room.players.values()].find((player) => player.host)?.id ?? null,
      settings: room.settings,
      roundNumber: room.roundNumber,
      totalRounds: room.settings.rounds,
      deadline: room.deadline,
      clues: this.publicClues(room),
      voteSubmittedCount: this.currentVoteMap(room).size,
      voteEligibleCount: this.eligiblePlayerIds(room).length,
      runoffCandidateIds: room.round?.runoffCandidateIds ?? [],
      latestResult: room.round?.result ?? null,
      roundHistory: room.roundHistory,
      cancelledReason: room.cancelledReason,
      persistenceEnabled: this.persistence.enabled
    };
  }

  private publicClues(room: Room): PublicClue[] {
    const round = room.round;
    if (!round) return [];
    return [...room.players.values()].map((player) => ({
      playerId: player.id,
      playerName: player.name,
      clue: round.clues.get(player.id) ?? null,
      missed: ["DISCUSSION", "VOTING", "RUNOFF_VOTING", "VOTE_RESULT", "GAME_END"].includes(room.phase) && !round.clues.has(player.id)
    }));
  }

  private sendSecretIfActive(room: Room, player: Player): void {
    if (!room.round || !player.socketId || !["ROLE_ASSIGNMENT", "CLUE_PHASE", "DISCUSSION", "VOTING", "RUNOFF_VOTING"].includes(room.phase)) return;
    const isImposter = player.id === room.round.imposterId;
    const secret: PrivateRole = {
      playerId: player.id,
      roomCode: room.code,
      roundNumber: room.round.number,
      role: isImposter ? "Imposter" : "Normal",
      word: isImposter ? room.round.imposterWord : room.round.normalWord,
      instruction: isImposter
        ? "Blend in, infer the main word, and avoid being identified."
        : "Give a subtle one-word clue and find the player who sounds off."
    };
    this.io.to(player.socketId).emit("player:secret", secret);
  }

  private broadcast(room: Room): void {
    this.io.to(room.code).emit("room:state", this.publicState(room));
  }

  private attachSocket(socket: GameSocket, room: Room, player: Player): void {
    socket.data.roomCode = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);
  }

  private context(socket: GameSocket): { room: Room; player: Player } | null {
    const roomCode = socket.data.roomCode as string | undefined;
    const playerId = socket.data.playerId as string | undefined;
    if (!roomCode || !playerId) return null;
    const room = this.rooms.get(roomCode);
    const player = room?.players.get(playerId);
    return room && player ? { room, player } : null;
  }

  private currentVoteMap(room: Room): Map<string, string> {
    if (!room.round) return new Map();
    return room.phase === "RUNOFF_VOTING" ? room.round.runoffVotes : room.round.votes;
  }

  private hasSubmittedCurrentVote(room: Room, playerId: string): boolean {
    return this.currentVoteMap(room).has(playerId);
  }

  private eligiblePlayerIds(room: Room): string[] {
    return [...room.players.values()].filter((player) => player.connected || room.phase !== "LOBBY").map((player) => player.id);
  }

  private connectedPlayers(room: Room): Player[] {
    return [...room.players.values()].filter((player) => player.connected);
  }

  private transferHostIfNeeded(room: Room): void {
    const host = [...room.players.values()].find((player) => player.host);
    if (host?.connected) return;
    const nextHost = this.connectedPlayers(room).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (!nextHost) return;
    for (const player of room.players.values()) player.host = false;
    nextHost.host = true;
    nextHost.ready = true;
  }

  private scheduleLobbyRemoval(room: Room, playerId: string): void {
    setTimeout(() => {
      const player = room.players.get(playerId);
      if (!player || player.connected || room.phase !== "LOBBY") return;
      room.players.delete(playerId);
      this.transferHostIfNeeded(room);
      this.broadcast(room);
      if (room.players.size === 0) this.destroyRoom(room);
    }, RECONNECT_GRACE_MS);
  }

  private scheduleGameDisconnectCheck(room: Room, playerId: string): void {
    setTimeout(() => {
      const player = room.players.get(playerId);
      if (!player || player.connected || room.phase === "GAME_END" || room.phase === "CANCELLED") return;
      this.broadcast(room);
      if (this.connectedPlayers(room).length < MIN_PLAYERS) this.cancelRoom(room, "Too few players reconnected before the grace period ended.");
    }, RECONNECT_GRACE_MS);
  }

  private destroyRoom(room: Room): void {
    this.clearTimer(room);
    this.rooms.delete(room.code);
  }

  private createPlayer(name: string, socketId: string, host: boolean): Player {
    return {
      id: randomUUID(),
      name: name.trim(),
      socketId,
      reconnectToken: randomBytes(32).toString("base64url"),
      connected: true,
      ready: host,
      host,
      score: 0,
      disconnectedAt: null,
      roleAcked: false
    };
  }

  private generateUniqueCode(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const bytes = randomBytes(6);
      const code = [...bytes].map((byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
      if (!this.rooms.has(code)) return code;
    }
    throw new Error("Unable to allocate a room code.");
  }

  private tokenMatches(actual: string, provided: string): boolean {
    const left = Buffer.from(actual);
    const right = Buffer.from(provided);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private tooSoon(ip: string, room?: Room): boolean {
    const now = Date.now();
    const source = room?.lastEntryAtByIp;
    const previous = source?.get(ip);
    if (previous && now - previous < 300) return true;
    return false;
  }
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
