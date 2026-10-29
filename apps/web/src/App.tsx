import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Crown,
  Eye,
  LogOut,
  Play,
  RefreshCw,
  Send,
  Shield,
  Timer,
  UserRoundX,
  Vote
} from "lucide-react";
import {
  defaultSettings,
  type BasicAck,
  type GameSettings,
  type PrivateRole,
  type PublicPlayer,
  type PublicRoomState,
  type RoundResult,
  type WordCategory
} from "@imposter/shared";
import { socket } from "./state/socket.js";
import { Badge, Button, IconButton, Input, Panel } from "./components/ui.js";

type Credentials = { roomCode: string; playerId: string; reconnectToken: string };
type EnterRoomResponse = { ok: true; roomCode: string; playerId: string; reconnectToken: string; state: PublicRoomState };

const credentialKey = "imposter.credentials";
const categories: WordCategory[] = ["Food", "Animals", "Sports", "Movies", "Places", "Objects", "Technology", "Professions", "College"];

export function App() {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [secret, setSecret] = useState<PrivateRole | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(() => readCredentials());
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");
  const me = state?.players.find((player) => player.id === credentials?.playerId) ?? null;
  const host = Boolean(me?.host);

  useEffect(() => {
    socket.connect();
    const onConnect = () => {
      setConnected(true);
      const stored = readCredentials();
      if (stored) {
        socket.emit("room:reconnect-player", stored, (response) => {
          if (response.ok) {
            setCredentials({ roomCode: response.roomCode, playerId: response.playerId, reconnectToken: response.reconnectToken });
            saveCredentials(response);
            setState(response.state);
          }
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onState = (next: PublicRoomState) => setState(next);
    const onSecret = (next: PrivateRole) => setSecret(next);
    const onResult = (result: RoundResult) => setState((current) => (current ? { ...current, latestResult: result } : current));
    const onError = (message: string) => setError(message);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onState);
    socket.on("player:secret", onSecret);
    socket.on("round:result", onResult);
    socket.on("room:error", onError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onState);
      socket.off("player:secret", onSecret);
      socket.off("round:result", onResult);
      socket.off("room:error", onError);
    };
  }, []);

  const send = <T,>(event: string, payload: T, onOk?: () => void) => {
    setError("");
    (socket.emit as (event: string, payload: T, ack: (response: BasicAck) => void) => void)(event, payload, (response) => {
      if (!response.ok) setError(response.message);
      else onOk?.();
    });
  };

  const enterRoom = (response: EnterRoomResponse) => {
    const next = { roomCode: response.roomCode, playerId: response.playerId, reconnectToken: response.reconnectToken };
    setCredentials(next);
    localStorage.setItem(credentialKey, JSON.stringify(next));
    setState(response.state);
    setSecret(null);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo-mark">?</span>
          <span>Who's the Imposter?</span>
        </div>
        <Badge tone={connected ? "green" : "amber"}>{connected ? "Connected" : "Reconnecting"}</Badge>
      </header>

      {error && <div className="toast" role="alert">{error}</div>}

      {!state ? (
        <Landing onEnter={enterRoom} setError={setError} />
      ) : (
        <GameRoom
          state={state}
          me={me}
          host={host}
          secret={secret}
          setSecret={setSecret}
          send={send}
          leave={() => {
            localStorage.removeItem(credentialKey);
            setCredentials(null);
            setState(null);
            setSecret(null);
            socket.disconnect();
            socket.connect();
          }}
        />
      )}
    </main>
  );
}

function Landing({ onEnter, setError }: { onEnter: (response: EnterRoomResponse) => void; setError: (message: string) => void }) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const canSubmitName = name.trim().length >= 2;

  const createRoom = () => {
    setError("");
    socket.emit("room:create", { playerName: name }, (response) => {
      if (response.ok) onEnter(response);
      else setError(response.message);
    });
  };
  const joinRoom = () => {
    setError("");
    socket.emit("room:join", { playerName: name, roomCode }, (response) => {
      if (response.ok) onEnter(response);
      else setError(response.message);
    });
  };

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">No account. No install. Just a room code.</p>
          <h1>Find the friend whose word does not fit.</h1>
          <p>Give a clever one-word clue, read the table, and vote before the Imposter talks their way out.</p>
        </div>
        <Panel className="entry-panel">
          <Input label="Your name" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Aarav" />
          <Input label="Room code" value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ABC123" />
          <div className="button-row">
            <Button disabled={!canSubmitName} onClick={createRoom}><Play size={18} />Create Room</Button>
            <Button className="btn-secondary" disabled={!canSubmitName || roomCode.trim().length !== 6} onClick={joinRoom}>Join Room</Button>
          </div>
        </Panel>
      </section>
      <section className="how">
        {["Get a secret word", "Submit one clue", "Discuss the clues", "Vote anonymously", "Score across rounds"].map((step, index) => (
          <div className="step" key={step}>
            <span>{index + 1}</span>
            <p>{step}</p>
          </div>
        ))}
      </section>
    </>
  );
}

function GameRoom(props: {
  state: PublicRoomState;
  me: PublicPlayer | null;
  host: boolean;
  secret: PrivateRole | null;
  setSecret: (secret: PrivateRole | null) => void;
  send: <T>(event: string, payload: T, onOk?: () => void) => void;
  leave: () => void;
}) {
  const { state, me, host, secret, setSecret, send, leave } = props;
  const timeLeft = useCountdown(state.deadline);
  const inviteLink = `${window.location.origin}?room=${state.roomCode}`;

  return (
    <>
      <section className="room-header">
        <div>
          <p className="eyebrow">Private room</p>
          <h1>{state.roomCode}</h1>
        </div>
        <div className="room-actions">
          <IconButton label="Copy invite link" onClick={() => navigator.clipboard?.writeText(inviteLink)}><Clipboard size={18} /></IconButton>
          <IconButton label="Leave room" onClick={leave}><LogOut size={18} /></IconButton>
        </div>
      </section>

      <section className="game-grid">
        <PlayerRail players={state.players} host={host} me={me} send={send} />
        <div className="main-stage">
          <PhaseBanner state={state} timeLeft={timeLeft} />
          {state.phase === "LOBBY" && <Lobby state={state} me={me} host={host} send={send} />}
          {state.phase === "ROLE_ASSIGNMENT" && <RoleReveal secret={secret} send={send} />}
          {state.phase === "CLUE_PHASE" && <CluePhase state={state} me={me} secret={secret} send={send} />}
          {state.phase === "DISCUSSION" && <Discussion state={state} />}
          {["VOTING", "RUNOFF_VOTING"].includes(state.phase) && <Voting state={state} me={me} send={send} />}
          {state.phase === "VOTE_RESULT" && <RoundResultView state={state} secret={secret} host={host} send={send} />}
          {state.phase === "GAME_END" && <GameEnd state={state} host={host} send={send} />}
          {state.phase === "CANCELLED" && <Panel><h2>Game cancelled</h2><p>{state.cancelledReason}</p></Panel>}
        </div>
      </section>
    </>
  );
}

function PlayerRail({ players, host, me, send }: { players: PublicPlayer[]; host: boolean; me: PublicPlayer | null; send: <T>(event: string, payload: T) => void }) {
  return (
    <aside className="player-rail">
      <h2>Players</h2>
      {players.map((player) => (
        <div className="player-row" key={player.id}>
          <span className="avatar">{player.initials}</span>
          <div>
            <strong>{player.name}</strong>
            <p>{player.connected ? "Online" : "Disconnected"} · {player.score} pts</p>
          </div>
          {player.host && <Crown size={16} className="gold" />}
          {!player.host && player.ready && <Check size={16} className="green" />}
          {host && player.id !== me?.id && <IconButton label={`Kick ${player.name}`} onClick={() => send("player:kick", { playerId: player.id })}><UserRoundX size={16} /></IconButton>}
        </div>
      ))}
    </aside>
  );
}

function PhaseBanner({ state, timeLeft }: { state: PublicRoomState; timeLeft: number | null }) {
  return (
    <div className="phase-banner">
      <div>
        <Badge tone="pink">{state.phase.replaceAll("_", " ")}</Badge>
        <p>Round {Math.max(1, state.roundNumber)} of {state.totalRounds}</p>
      </div>
      {timeLeft !== null && <div className="timer"><Timer size={18} />{timeLeft}s</div>}
    </div>
  );
}

function Lobby({ state, me, host, send }: { state: PublicRoomState; me: PublicPlayer | null; host: boolean; send: <T>(event: string, payload: T) => void }) {
  const readyCount = state.players.filter((player) => player.host || player.ready).length;
  return (
    <Panel>
      <div className="section-title">
        <h2>Lobby</h2>
        <Badge tone={state.players.length >= 3 && readyCount === state.players.length ? "green" : "amber"}>{readyCount}/{state.players.length} ready</Badge>
      </div>
      <p className="muted">The host can start when at least three players are connected and everyone is ready.</p>
      <div className="button-row">
        {!me?.host && <Button onClick={() => send("player:ready", { ready: !me?.ready })}>{me?.ready ? "Not Ready" : "Ready"}</Button>}
        {host && <Button onClick={() => send("game:start", {})} disabled={state.players.length < 3 || readyCount !== state.players.length}><Play size={18} />Start Game</Button>}
      </div>
      {host && <SettingsForm settings={state.settings} send={send} />}
      {!state.persistenceEnabled && <p className="muted">Local mode: MongoDB is not configured, so completed games are not persisted.</p>}
    </Panel>
  );
}

function SettingsForm({ settings, send }: { settings: GameSettings; send: <T>(event: string, payload: T) => void }) {
  const update = (patch: Partial<GameSettings>) => send("settings:update", patch);
  return (
    <div className="settings-grid">
      <Input label="Rounds" type="number" min={1} max={10} value={settings.rounds} onChange={(event) => update({ rounds: Number(event.target.value) })} />
      <Input label="Clue timer" type="number" min={10} max={180} value={settings.clueSeconds} onChange={(event) => update({ clueSeconds: Number(event.target.value) })} />
      <Input label="Discussion timer" type="number" min={0} max={300} value={settings.discussionSeconds} onChange={(event) => update({ discussionSeconds: Number(event.target.value) })} />
      <Input label="Voting timer" type="number" min={10} max={180} value={settings.votingSeconds} onChange={(event) => update({ votingSeconds: Number(event.target.value) })} />
      <label className="field">
        <span>Difficulty</span>
        <select value={settings.difficulty} onChange={(event) => update({ difficulty: event.target.value as GameSettings["difficulty"] })}>
          {["Any", "Easy", "Medium", "Hard"].map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="toggle"><input type="checkbox" checked={settings.discussionEnabled} onChange={(event) => update({ discussionEnabled: event.target.checked })} /> Discussion enabled</label>
      <div className="chips">
        {categories.map((category) => {
          const active = settings.categories.includes(category);
          return (
            <button className={active ? "chip active" : "chip"} key={category} onClick={() => {
              const next = active ? settings.categories.filter((item) => item !== category) : [...settings.categories, category];
              if (next.length > 0) update({ categories: next });
            }}>{category}</button>
          );
        })}
      </div>
    </div>
  );
}

function RoleReveal({ secret, send }: { secret: PrivateRole | null; send: <T>(event: string, payload: T) => void }) {
  return (
    <Panel className="secret-panel">
      <Eye size={34} />
      <h2>{secret ? `You are ${secret.role}` : "Receiving your secret..."}</h2>
      <div className="secret-word">{secret?.word ?? "..."}</div>
      <p>{secret?.instruction}</p>
      <Button disabled={!secret} onClick={() => send("role:ack", {})}><Check size={18} />I understand</Button>
    </Panel>
  );
}

function CluePhase({ state, me, secret, send }: { state: PublicRoomState; me: PublicPlayer | null; secret: PrivateRole | null; send: <T>(event: string, payload: T, onOk?: () => void) => void }) {
  const [clue, setClue] = useState("");
  const submitted = Boolean(me?.submittedClue);
  return (
    <Panel>
      <h2>Submit one clue</h2>
      <p className="muted">Your word is <strong>{secret?.word ?? "hidden"}</strong>. Use one word, and do not type the secret word itself.</p>
      <div className="clue-form">
        <Input label="Clue" value={clue} disabled={submitted} maxLength={24} onChange={(event) => setClue(event.target.value)} placeholder="Crunchy" />
        <Button disabled={submitted || !clue.trim()} onClick={() => send("clue:submit", { clue }, () => setClue(""))}><Send size={18} />Submit</Button>
      </div>
      <ClueList clues={state.clues} players={state.players} />
    </Panel>
  );
}

function Discussion({ state }: { state: PublicRoomState }) {
  return (
    <Panel>
      <h2>Discuss the clues</h2>
      <p className="muted">Talk it out in your call. Watch for clues that fit the category but miss the exact target.</p>
      <ClueCards clues={state.clues} />
    </Panel>
  );
}

function Voting({ state, me, send }: { state: PublicRoomState; me: PublicPlayer | null; send: <T>(event: string, payload: T) => void }) {
  const [selected, setSelected] = useState("");
  const candidates = state.phase === "RUNOFF_VOTING" ? state.players.filter((player) => state.runoffCandidateIds.includes(player.id)) : state.players;
  return (
    <Panel>
      <h2>{state.phase === "RUNOFF_VOTING" ? "Runoff vote" : "Vote anonymously"}</h2>
      <p className="muted">{state.voteSubmittedCount}/{state.voteEligibleCount} votes locked. Self-voting is disabled and choices stay private.</p>
      <div className="vote-grid">
        {candidates.map((player) => {
          const clue = state.clues.find((item) => item.playerId === player.id)?.clue ?? "No clue";
          return (
            <button className={selected === player.id ? "vote-card selected" : "vote-card"} disabled={player.id === me?.id || me?.submittedVote} key={player.id} onClick={() => setSelected(player.id)}>
              <span className="avatar">{player.initials}</span>
              <strong>{player.name}</strong>
              <small>{clue}</small>
            </button>
          );
        })}
      </div>
      <Button disabled={!selected || me?.submittedVote} onClick={() => send("vote:submit", { targetPlayerId: selected })}><Vote size={18} />Lock Vote</Button>
    </Panel>
  );
}

function RoundResultView({ state, secret, host, send }: { state: PublicRoomState; secret: PrivateRole | null; host: boolean; send: <T>(event: string, payload: T) => void }) {
  const result = state.latestResult;
  const [guess, setGuess] = useState("");
  if (!result) return <Panel><h2>Counting votes...</h2></Panel>;
  const isImposter = secret?.role === "Imposter";
  return (
    <Panel>
      <h2>{result.correct ? "The group caught the Imposter" : "The Imposter escaped"}</h2>
      <div className="result-grid">
        <Stat label="Imposter" value={result.imposterName} />
        <Stat label="Main word" value={result.mainWord} />
        <Stat label="Imposter word" value={result.imposterWord} />
        <Stat label="Accused" value={result.selectedPlayerName ?? "No one"} />
      </div>
      {result.correct && isImposter && !result.imposterGuess && (
        <div className="clue-form">
          <Input label="Guess the main word" value={guess} onChange={(event) => setGuess(event.target.value)} />
          <Button onClick={() => send("imposter:guess", { guess })}>Guess</Button>
        </div>
      )}
      <ClueCards clues={result.clues} />
      <Leaderboard players={state.players} />
      {host && <Button onClick={() => send("game:next-round", {})}><RefreshCw size={18} />{state.roundNumber >= state.totalRounds ? "Finish Game" : "Next Round"}</Button>}
    </Panel>
  );
}

function GameEnd({ state, host, send }: { state: PublicRoomState; host: boolean; send: <T>(event: string, payload: T) => void }) {
  const highScore = Math.max(...state.players.map((player) => player.score));
  const winners = state.players.filter((player) => player.score === highScore).map((player) => player.name).join(", ");
  return (
    <Panel>
      <h2>Final leaderboard</h2>
      <p className="winner">{winners} {winners.includes(",") ? "share" : "wins"} rank 1.</p>
      <Leaderboard players={state.players} />
      <div className="history">
        {state.roundHistory.map((round) => <p key={round.roundNumber}>Round {round.roundNumber}: {round.imposterName} was the Imposter, word pair {round.mainWord}/{round.imposterWord}.</p>)}
      </div>
      {host && <Button onClick={() => send("game:rematch", {})}><RefreshCw size={18} />Rematch</Button>}
    </Panel>
  );
}

function ClueList({ clues, players }: { clues: PublicRoomState["clues"]; players: PublicPlayer[] }) {
  return (
    <div className="status-list">
      {players.map((player) => <Badge key={player.id} tone={clues.find((clue) => clue.playerId === player.id)?.clue ? "green" : "muted"}>{player.name}</Badge>)}
    </div>
  );
}

function ClueCards({ clues }: { clues: PublicRoomState["clues"] }) {
  return (
    <div className="clue-cards">
      {clues.map((clue) => (
        <div className="clue-card" key={clue.playerId}>
          <strong>{clue.playerName}</strong>
          <span>{clue.clue ?? "Missed"}</span>
        </div>
      ))}
    </div>
  );
}

function Leaderboard({ players }: { players: PublicPlayer[] }) {
  const ranked = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <div className="leaderboard">
      {ranked.map((player, index) => (
        <div className="leader-row" key={player.id}>
          <span>#{index + 1}</span>
          <strong>{player.name}</strong>
          <b>{player.score} pts</b>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function useCountdown(deadline: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);
  return useMemo(() => deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null, [deadline, now]);
}

function readCredentials(): Credentials | null {
  try {
    const raw = localStorage.getItem(credentialKey);
    return raw ? JSON.parse(raw) as Credentials : null;
  } catch {
    return null;
  }
}

function saveCredentials(response: { ok: true; roomCode: string; playerId: string; reconnectToken: string }) {
  localStorage.setItem(credentialKey, JSON.stringify({ roomCode: response.roomCode, playerId: response.playerId, reconnectToken: response.reconnectToken }));
}
