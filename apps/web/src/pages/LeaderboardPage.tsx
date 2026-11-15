import { useCallback, useEffect, useState } from "react";
import { Play, RefreshCw, Trophy } from "lucide-react";
import type { LeaderboardResponse } from "@imposter/shared";
import { Avatar } from "../components/Avatar.js";
import { formatWinRate } from "../components/StatsPanel.js";
import { Button, Panel } from "../components/ui.js";
import { api, ApiError } from "../state/api.js";
import { hrefFor } from "../state/router.js";
import { useSession } from "../state/session.js";

export function LeaderboardPage() {
  const session = useSession();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError("");
    api
      .leaderboard()
      .then((next) => active && setData(next))
      .catch((caught) => active && setError(caught instanceof ApiError ? caught.message : "Could not load the leaderboard."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => load(), [load]);

  const me = session?.account.username.toLowerCase() ?? null;

  return (
    <section className="profile-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">All time</p>
          <h1>Leaderboard</h1>
        </div>
        <Button className="btn-secondary" onClick={load} disabled={loading}><RefreshCw size={18} />Refresh</Button>
      </div>

      <Panel>
        <p className="muted fine-print">
          Signed-in players only, from completed games. Ranked by wins, then win rate, then total points; players level on all three share a rank.
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!error && loading && !data && <p className="muted" role="status">Loading the leaderboard...</p>}
        {data && data.entries.length === 0 && (
          <div className="empty-state">
            <Trophy size={34} />
            <h2>No ranked players yet</h2>
            <p className="muted">Finish a game while signed in to claim the first spot.</p>
            <a className="btn" href={hrefFor({ name: "home" })}><Play size={18} />Play a game</a>
          </div>
        )}
        {data && data.entries.length > 0 && (
          <div className="table-scroll">
            <table className="leaderboard-table">
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col">Games</th>
                  <th scope="col">Wins</th>
                  <th scope="col">Win rate</th>
                  <th scope="col" className="optional-col">Points</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.username} className={entry.username.toLowerCase() === me ? "is-me" : undefined}>
                    <td className="rank-cell">#{entry.rank}</td>
                    <td>
                      <a className="player-link" href={hrefFor({ name: "player", username: entry.username })}>
                        <Avatar avatar={entry.avatar} size="sm" />
                        <span>{entry.username}</span>
                      </a>
                    </td>
                    <td>{entry.gamesPlayed}</td>
                    <td>{entry.wins}</td>
                    <td>{formatWinRate(entry.winRatePercent)}</td>
                    <td className="optional-col">{entry.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}
