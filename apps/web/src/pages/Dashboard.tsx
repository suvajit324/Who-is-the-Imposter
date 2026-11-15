import { useState } from "react";
import { BadgeCheck, History, LogIn, Play, Trophy, UserPlus, Users } from "lucide-react";
import type { CreateRoomAck } from "@imposter/shared";
import { Avatar } from "../components/Avatar.js";
import { Button, Input, Panel } from "../components/ui.js";
import { hrefFor, inviteRoomCode } from "../state/router.js";
import { useSession } from "../state/session.js";
import { socket } from "../state/socket.js";

export type EnterRoomResponse = Extract<CreateRoomAck, { ok: true }>;

const STEPS = ["Get a secret word", "Submit one clue", "Discuss the clues", "Vote anonymously", "Score across rounds"];

export function Dashboard({ onEnter, setError }: { onEnter: (response: EnterRoomResponse) => void; setError: (message: string) => void }) {
  const session = useSession();
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState(() => inviteRoomCode());
  const invited = roomCode !== "" && roomCode === inviteRoomCode();
  // Signed-in players always play under their username; the server enforces this too.
  const playerName = session ? session.account.username : name;
  // One request at a time: a double click must not try to take a second seat.
  const [pending, setPending] = useState(false);
  const canSubmitName = playerName.trim().length >= 2 && !pending;

  const enter = (response: CreateRoomAck) => {
    setPending(false);
    if (response.ok) onEnter(response);
    else setError(response.message);
  };
  const createRoom = () => {
    if (pending) return;
    setError("");
    setPending(true);
    socket.emit("room:create", { playerName }, enter);
  };
  const joinRoom = () => {
    if (pending) return;
    setError("");
    setPending(true);
    socket.emit("room:join", { playerName, roomCode }, enter);
  };

  return (
    <div className="dashboard">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{session ? `Welcome back, ${session.account.username}` : "No install. Play as a guest or sign in."}</p>
          <h1>Find the friend whose word does not fit.</h1>
          <p>Give a clever one-word clue, read the table, and vote before the Imposter talks their way out.</p>
        </div>
        <Panel className="entry-panel play-card">
          <div className="section-title">
            <h2>Play</h2>
            {invited && <span className="invite-note"><Users size={16} />Invited to {roomCode}</span>}
          </div>
          {session ? (
            <div className="playing-as">
              <Avatar avatar={session.account.avatar} />
              <div>
                <span className="muted">Playing as</span>
                <strong>
                  {session.account.username}
                  <BadgeCheck size={16} className="verified" aria-label="Signed-in account" />
                </strong>
              </div>
            </div>
          ) : (
            <Input label="Your name" value={name} maxLength={24} onChange={(event) => setName(event.target.value)} placeholder="Aarav" />
          )}
          <Input label="Room code" value={roomCode} maxLength={6} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ABC123" />
          <div className="button-row">
            <Button disabled={!canSubmitName} onClick={createRoom}><Play size={18} />Create Room</Button>
            <Button className="btn-secondary" disabled={!canSubmitName || roomCode.trim().length !== 6} onClick={joinRoom}>Join Room</Button>
          </div>
        </Panel>
      </section>

      <section className="dash-grid">
        <Panel className="account-card">
          {session ? (
            <>
              <div className="account-head">
                <Avatar avatar={session.account.avatar} size="lg" />
                <div>
                  <p className="eyebrow">Your profile</p>
                  <h2>{session.account.username}</h2>
                </div>
              </div>
              <p className="muted">Games you finish while signed in count towards your statistics and the leaderboard.</p>
              <div className="button-row">
                <a className="btn btn-secondary" href={hrefFor({ name: "profile" })}>View profile</a>
                <a className="btn btn-secondary" href={hrefFor({ name: "history" })}><History size={18} />Match history</a>
              </div>
            </>
          ) : (
            <>
              <p className="eyebrow">Guest mode</p>
              <h2>Want a profile?</h2>
              <p className="muted">Guests can play everything. An account reserves your username, shows a verified badge in rooms, and records your games for statistics and the leaderboard.</p>
              <div className="button-row">
                <a className="btn" href={hrefFor({ name: "register" })}><UserPlus size={18} />Create account</a>
                <a className="btn btn-secondary" href={hrefFor({ name: "login" })}><LogIn size={18} />Sign in</a>
              </div>
              <a className="text-link" href={hrefFor({ name: "leaderboard" })}><Trophy size={16} />See the leaderboard</a>
            </>
          )}
        </Panel>
        <Panel className="how-card">
          <p className="eyebrow">How to play</p>
          <ol className="how">
            {STEPS.map((step, index) => (
              <li className="step" key={step}>
                <span>{index + 1}</span>
                <p>{step}</p>
              </li>
            ))}
          </ol>
        </Panel>
      </section>
    </div>
  );
}
