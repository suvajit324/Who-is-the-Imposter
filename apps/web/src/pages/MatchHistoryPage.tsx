import { useEffect, useState } from "react";
import { BadgeCheck, ChevronLeft, ChevronRight, LogIn, Play } from "lucide-react";
import type { MatchHistoryEntry, MatchHistoryResponse, MatchOutcome } from "@imposter/shared";
import { Avatar } from "../components/Avatar.js";
import { Button, Panel } from "../components/ui.js";
import { api, ApiError } from "../state/api.js";
import { hrefFor } from "../state/router.js";
import { useSession } from "../state/session.js";

const OUTCOME_LABEL: Record<MatchOutcome, string> = { win: "Win", draw: "Draw", loss: "Loss" };

function ordinal(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return `${rank}th`;
  return `${rank}${{ 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th"}`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds}s` : `${minutes} min ${String(seconds % 60).padStart(2, "0")}s`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Your own completed games, newest first. The server decides whose matches these are from your sign-in. */
export function MatchHistoryPage() {
  const session = useSession();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<MatchHistoryResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const username = session?.account.username ?? null;

  useEffect(() => {
    if (!username) return;
    let active = true;
    setLoading(true);
    setError("");
    api
      .matchHistory(page)
      .then((next) => active && setData(next))
      .catch((caught) => active && setError(caught instanceof ApiError ? caught.message : "Could not load your match history."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [page, username, attempt]);

  if (!session) {
    return (
      <section className="auth-page">
        <Panel className="auth-card">
          <h1>Match history</h1>
          <p className="muted">Sign in to see the games you have played. Guest games are not saved to any account.</p>
          <a className="btn" href={hrefFor({ name: "login" })}><LogIn size={18} />Sign in</a>
        </Panel>
      </section>
    );
  }

  return (
    <section className="profile-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Your games</p>
          <h1>Match history</h1>
        </div>
        <a className="btn btn-secondary" href={hrefFor({ name: "profile" })}>Back to profile</a>
      </div>

      {error && (
        <Panel>
          <p className="form-error" role="alert">{error}</p>
          <Button className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}>Try again</Button>
        </Panel>
      )}
      {!error && !data && <Panel><p className="muted" role="status">Loading your matches...</p></Panel>}
      {data && data.totalMatches === 0 && (
        <Panel className="empty-state">
          <h2>No completed games yet</h2>
          <p className="muted">Games you finish while signed in appear here. Cancelled games are not recorded.</p>
          <a className="btn" href={hrefFor({ name: "home" })}><Play size={18} />Play a game</a>
        </Panel>
      )}
      {data && data.matches.length > 0 && (
        <>
          <ol className="history-list" aria-busy={loading}>
            {data.matches.map((match, index) => <MatchCard match={match} key={`${match.endedAt}-${index}`} />)}
          </ol>
          {data.totalPages > 1 && (
            <nav className="pager" aria-label="Match history pages">
              <Button className="btn-secondary" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} />Newer</Button>
              <span className="muted">Page {data.page} of {data.totalPages}</span>
              <Button className="btn-secondary" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Older<ChevronRight size={18} /></Button>
            </nav>
          )}
        </>
      )}
      {data && data.totalMatches > 0 && data.matches.length === 0 && (
        <Panel>
          <p className="muted">There are no matches on this page.</p>
          <Button className="btn-secondary" onClick={() => setPage(1)}>Back to the newest</Button>
        </Panel>
      )}
    </section>
  );
}

function MatchCard({ match }: { match: MatchHistoryEntry }) {
  return (
    <li className={`history-card outcome-${match.outcome}`}>
      <div className="history-head">
        <span className={`outcome-pill outcome-${match.outcome}`}>{OUTCOME_LABEL[match.outcome]}</span>
        <div className="history-meta">
          <strong>{ordinal(match.finalRank)} place · {match.finalScore} pts</strong>
          <span className="muted">
            {formatWhen(match.endedAt)} · {match.roundsPlayed} {match.roundsPlayed === 1 ? "round" : "rounds"} · {formatDuration(match.durationSeconds)}
            {!match.counted && " · not counted"}
          </span>
        </div>
      </div>
      <ul className="history-players" aria-label="Final standings">
        {match.participants.map((participant, index) => (
          <li className={participant.you ? "history-player you" : "history-player"} key={`${participant.name}-${index}`}>
            <span className="history-rank">#{participant.finalRank}</span>
            <Avatar avatar={participant.avatar} initials={participant.name.slice(0, 2).toUpperCase()} size="sm" />
            {participant.username && !participant.you ? (
              <a href={hrefFor({ name: "player", username: participant.username })}>{participant.name}</a>
            ) : (
              <span>{participant.name}{participant.you && " (you)"}</span>
            )}
            {participant.username && <BadgeCheck size={14} className="verified" aria-label="Signed-in account" />}
            <span className="history-score">{participant.finalScore} pts</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
