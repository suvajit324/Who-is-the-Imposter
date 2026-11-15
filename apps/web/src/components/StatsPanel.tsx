import type { PlayerStats } from "@imposter/shared";
import { Panel } from "./ui.js";

/** Formats a win rate for display ("—" before the first game). */
export function formatWinRate(value: number | null): string {
  return value === null ? "—" : `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function StatsPanel({ stats, title = "Statistics" }: { stats: PlayerStats; title?: string }) {
  const tiles: Array<[string, string]> = [
    ["Games played", String(stats.gamesPlayed)],
    ["Wins", String(stats.wins)],
    ["Losses", String(stats.losses)],
    ["Win rate", formatWinRate(stats.winRatePercent)],
    ["Draws", String(stats.draws)],
    ["Total points", String(stats.totalPoints)],
    ["Best score", stats.bestScore === null ? "—" : String(stats.bestScore)]
  ];
  return (
    <Panel className="stats-panel">
      <h2>{title}</h2>
      {stats.gamesPlayed === 0 ? (
        <p className="muted empty-note">No completed games yet. Finish a game while signed in and it will count here.</p>
      ) : (
        <>
          <dl className="stat-tiles">
            {tiles.map(([label, value]) => (
              <div className="stat-tile" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="muted fine-print">
            Counts completed games only; cancelled games never count. A win is finishing first (ties for first are wins for each tied player); when
            everyone finishes level it is a draw. Win rate = wins ÷ games played.
          </p>
        </>
      )}
    </Panel>
  );
}
