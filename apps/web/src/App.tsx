import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Check,
  Clipboard,
  Crown,
  Eye,
  LogIn,
  LogOut,
  Play,
  RefreshCw,
  Send,
  Timer,
  UserRoundX,
  Vote
} from "lucide-react";
import {
  categorySchema,
  type BasicAck,
  type GameSettings,
  type PrivateRole,
  type PublicPlayer,
  type PublicRoomState,
  type RoundResult,
  type StorageMode,
  type WordCategory
} from "@imposter/shared";
import { ACCOUNTS_UNAVAILABLE, SESSION_INVALID, socket } from "./state/socket.js";
import { api, ApiError } from "./state/api.js";
import { hrefFor, inviteLinkFor, useRoute, type Route } from "./state/router.js";
import { clearSession, getSession, updateSessionAccount, useSession } from "./state/session.js";
import { Badge, Button, IconButton, Input, Panel } from "./components/ui.js";
import { Avatar } from "./components/Avatar.js";
import { ChatBox } from "./components/chat/ChatBox.js";
import { Dashboard, type EnterRoomResponse } from "./pages/Dashboard.js";
import { AuthPage } from "./pages/AuthPage.js";
import { PlayerPage, ProfilePage } from "./pages/ProfilePage.js";
import { MatchHistoryPage } from "./pages/MatchHistoryPage.js";
import { LeaderboardPage } from "./pages/LeaderboardPage.js";

type Credentials = { roomCode: string; playerId: string; reconnectToken: string };

const credentialKey = "imposter.credentials";
const categories: WordCategory[] = [...categorySchema.options];

export function App() {
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [secret, setSecret] = useState<PrivateRole | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(() => readCredentials());
  const [connected, setConnected] = useState(socket.connected);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageMode, setStorageMode] = useState<StorageMode | null>(null);
  const account = useSession()?.account ?? null;
  const route = useRoute();
  // Bumped whenever the server (re)binds this socket to a player, so the chat re-syncs its history.
  const [session, setSession] = useState(0);
  const me = state?.players.find((player) => player.id === credentials?.playerId) ?? null;
  const host = Boolean(me?.host);
  // Read by the socket listeners below, which are registered once.
  const inRoom = useRef(false);
  inRoom.current = state !== null;

  /** Leaves the room view and forgets the seat, e.g. after the seat was released by the server. */
  const exitRoom = (message?: string) => {
    localStorage.removeItem(credentialKey);
    setCredentials(null);
    setState(null);
    setSecret(null);
    // Keep an earlier explanation (e.g. an expired sign-in) next to this one.
    if (message) setNotice((current) => (current && current !== message ? `${current} ${message}` : message));
  };

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
            setSession((value) => value + 1);
            return;
          }
          // The seat no longer exists (the room ended or was emptied, the server restarted, or a
          // signed-in seat was resumed without that account). Don't leave a frozen room on screen.
          exitRoom(inRoom.current ? `You are no longer in room ${stored.roomCode}. The game may have ended or the server restarted.` : undefined);
        });
      }
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      // The server closes a socket whose session was signed out elsewhere; reconnect (as a guest if needed).
      if (reason === "io server disconnect") socket.connect();
    };
    const onConnectError = (connectError: Error) => {
      // The server refused this tab's session token: drop it and carry on as a guest.
      if (connectError.message !== SESSION_INVALID && connectError.message !== ACCOUNTS_UNAVAILABLE) return;
      clearSession();
      setNotice(
        connectError.message === SESSION_INVALID
          ? "Your sign-in has expired, so you are playing as a guest. Sign in again any time."
          : "Accounts are unavailable right now, so you are playing as a guest."
      );
      socket.connect();
    };
    const onState = (next: PublicRoomState) => setState(next);
    const onSecret = (next: PrivateRole) => setSecret(next);
    const onResult = (result: RoundResult) => setState((current) => (current ? { ...current, latestResult: result } : current));
    // The server sends room:error only when this player has been removed from the room.
    const onRemoved = (message: string) => exitRoom(message);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.on("room:state", onState);
    socket.on("player:secret", onSecret);
    socket.on("round:result", onResult);
    socket.on("room:error", onRemoved);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.off("room:state", onState);
      socket.off("player:secret", onSecret);
      socket.off("round:result", onResult);
      socket.off("room:error", onRemoved);
    };
  }, []);

  useEffect(() => {
    let active = true;
    api.storageMode().then((mode) => active && setStorageMode(mode));
    // Confirm a stored session is still valid and pick up profile changes made in another tab.
    if (getSession()) {
      api
        .me()
        .then((next) => active && updateSessionAccount(next))
        .catch((caught) => {
          if (active && caught instanceof ApiError && caught.status === 401) {
            clearSession();
            setNotice("Your sign-in has expired. Sign in again to use your account.");
          }
        });
    }
    return () => {
      active = false;
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
    setSession((value) => value + 1);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href={state ? undefined : hrefFor({ name: "home" })}>
          <span className="logo-mark">?</span>
          <span>Who's the Imposter?</span>
        </a>
        <nav className="topnav" aria-label="Main">
          {/* Signing in or out is only possible outside a room, so the account links are hidden during a game. */}
          {!state && (
            <>
              <NavLink route={{ name: "home" }} current={route}>Play</NavLink>
              <NavLink route={{ name: "leaderboard" }} current={route}>Leaderboard</NavLink>
              {account ? (
                <a className={route.name === "profile" ? "nav-account active" : "nav-account"} href={hrefFor({ name: "profile" })}>
                  <Avatar avatar={account.avatar} size="sm" />
                  <span>{account.username}</span>
                </a>
              ) : (
                <a className="btn btn-small" href={hrefFor({ name: "login" })}><LogIn size={16} />Sign in</a>
              )}
            </>
          )}
          <Badge tone={connected ? "green" : "amber"}>{connected ? "Connected" : "Reconnecting"}</Badge>
        </nav>
      </header>

      {storageMode === "memory" && (
        <div className="banner banner-demo" role="note">
          <strong>Demo storage.</strong> Accounts and game records are kept in server memory and are erased whenever the server restarts.
        </div>
      )}
      {storageMode === "mongodb-unavailable" && (
        <div className="banner banner-warn" role="note">Accounts are temporarily unavailable. Guest play still works.</div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice} <button type="button" className="link-btn" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}
      {error && <div className="toast" role="alert">{error}</div>}

      {!state ? (
        <Page route={route} onEnter={enterRoom} setError={setError} />
      ) : (
        <GameRoom
          state={state}
          me={me}
          host={host}
          secret={secret}
          setSecret={setSecret}
          send={send}
          session={session}
          leave={() => {
            exitRoom();
            socket.disconnect();
            socket.connect();
          }}
        />
      )}
    </main>
  );
}

function Page({ route, onEnter, setError }: { route: Route; onEnter: (response: EnterRoomResponse) => void; setError: (message: string) => void }) {
  switch (route.name) {
    case "login":
      return <AuthPage mode="login" key="login" />;
    case "register":
      return <AuthPage mode="register" key="register" />;
    case "profile":
      return <ProfilePage />;
    case "player":
      return <PlayerPage username={route.username} key={route.username} />;
    case "history":
      return <MatchHistoryPage />;
    case "leaderboard":
      return <LeaderboardPage />;
    default:
      return <Dashboard onEnter={onEnter} setError={setError} />;
  }
}

function NavLink({ route, current, children }: { route: Route; current: Route; children: string }) {
  const active = current.name === route.name;
  return <a className={active ? "nav-link active" : "nav-link"} href={hrefFor(route)} aria-current={active ? "page" : undefined}>{children}</a>;
}

function GameRoom(props: {
  state: PublicRoomState;
  me: PublicPlayer | null;
  host: boolean;
  secret: PrivateRole | null;
  setSecret: (secret: PrivateRole | null) => void;
  send: <T>(event: string, payload: T, onOk?: () => void) => void;
  session: number;
  leave: () => void;
}) {
  const { state, me, host, secret, setSecret, send, session, leave } = props;
  const timeLeft = useCountdown(state.deadline);
  // Keep the page's own path (e.g. /Who-is-the-Imposter/ on GitHub Pages) so the link opens this app.
  const inviteLink = inviteLinkFor(state.roomCode);

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
          <ChatBox state={state} meId={me?.id ?? null} sessionKey={session} />
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
          <Avatar avatar={player.profile?.avatar} initials={player.initials} />
          <div>
            <strong className="player-name">
              {player.name}
              {player.profile && <BadgeCheck size={15} className="verified" aria-label="Signed-in account" />}
            </strong>
            <p>{player.connected ? "Online" : "Disconnected"} · {player.score} pts{player.profile ? "" : " · Guest"}</p>
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
  // Same rule as the server: only connected players count (someone who left keeps their seat for a short while).
  const connectedPlayers = state.players.filter((player) => player.connected);
  const readyCount = connectedPlayers.filter((player) => player.host || player.ready).length;
  const canStart = connectedPlayers.length >= 3 && readyCount === connectedPlayers.length;
  return (
    <Panel>
      <div className="section-title">
        <h2>Lobby</h2>
        <Badge tone={canStart ? "green" : "amber"}>{readyCount}/{connectedPlayers.length} ready</Badge>
      </div>
      <p className="muted">The host can start when at least three players are connected and everyone is ready.</p>
      <div className="button-row">
        {!me?.host && <Button onClick={() => send("player:ready", { ready: !me?.ready })}>{me?.ready ? "Not Ready" : "Ready"}</Button>}
        {host && <Button onClick={() => send("game:start", {})} disabled={!canStart}><Play size={18} />Start Game</Button>}
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
      <div className="chips" aria-label="Word category">
  <button
    type="button"
    className={settings.categories.length === categories.length ? "chip active" : "chip"}
    aria-pressed={settings.categories.length === categories.length}
    onClick={() => update({ categories })}
  >
    All categories
  </button>

  {categories.map((category) => {
    const active =
      settings.categories.length === 1 &&
      settings.categories[0] === category;

    return (
      <button
        type="button"
        className={active ? "chip active" : "chip"}
        aria-pressed={active}
        key={category}
        onClick={() => update({ categories: [category] })}
      >
        {category}
      </button>
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
        <Input label="Clue" value={clue} disabled={submitted} maxLength={24} onChange={(event) => setClue(event.target.value)} placeholder="Type a one-word clue" />
        <Button disabled={submitted || !clue.trim()} onClick={() => send("clue:submit", { clue }, () => setClue(""))}><Send size={18} />Submit</Button>
      </div>
      <ClueList players={state.players} />
    </Panel>
  );
}

function Discussion({ state }: { state: PublicRoomState }) {
  return (
    <Panel>
      <h2>Discuss the clues</h2>
      <p className="muted">Talk it out in the room chat below or on your call. Watch for clues that fit the category but miss the exact target.</p>
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
        <Stat label="Main word" value={result.mainWord ?? "Hidden until the Imposter guesses"} />
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
        {state.roundHistory.map((round) => <p key={round.roundNumber}>Round {round.roundNumber}: {round.imposterName} was the Imposter, word pair {round.mainWord ?? "?"}/{round.imposterWord}.</p>)}
      </div>
      {host && <Button onClick={() => send("game:rematch", {})}><RefreshCw size={18} />Rematch</Button>}
    </Panel>
  );
}

function ClueList({ players }: { players: PublicPlayer[] }) {
  // Clue text stays hidden on the server until the clue phase ends, so only show who has submitted.
  return (
    <div className="status-list">
      {players.map((player) => <Badge key={player.id} tone={player.submittedClue ? "green" : "muted"}>{player.name}</Badge>)}
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
