# Who's the Imposter?

A real-time social deduction game for private rooms of 3 to 12 players. Everyone gets a secret word, except one player (the Imposter) gets a different but related word. Players give one-word clues, discuss, and vote to find the Imposter.

Players can join as guests or sign in with an account. Signed-in players get a public profile, match history, statistics and a place on the leaderboard.

- **Frontend:** React + Vite, deployed to GitHub Pages.
- **Backend:** Express + Socket.IO, deployed to Render.
- **Storage:** MongoDB Atlas, with an in-memory demo mode when no database is configured.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Prerequisites](#prerequisites)
- [Install](#install)
- [Environment variables](#environment-variables)
- [MongoDB Atlas setup](#mongodb-atlas-setup)
- [Run locally](#run-locally)
- [Scripts](#scripts)
- [Tests and checks](#tests-and-checks)
- [Architecture](#architecture)
- [HTTP API](#http-api)
- [Socket.IO events](#socketio-events)
- [Game rules](#game-rules)
- [Word pairs](#word-pairs)
- [Deployment overview](#deployment-overview)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

## Features

**Gameplay**
- Private rooms with server-generated room codes, invite links (`?room=CODE`), a ready check, host settings and host kick.
- The server runs every phase: lobby, role reveal, clues, discussion (optional), voting, runoff voting, round result, game end, and cancellation.
- Each player receives only their own word, in a private message. Clue text stays hidden until the clue phase ends. Votes are anonymous.
- Clue validation: one word, no duplicates, not your own word, with a cap on rejected attempts per round.
- Scoring is server-side only, with ranks that can be shared, rematches, and a bonus for a caught Imposter who guesses the main word.
- Room chat during the discussion phase, with server-side moderation. It blocks abuse and messages that would reveal the secret word.
- Reconnecting: a player who drops out can resume their seat within 60 seconds.

**Accounts and statistics**
- Accounts need only a username and password, with no email. Usernames are 3–20 characters (letters, numbers, `_`). Reserved and abusive names are refused.
- Passwords are hashed with scrypt.
- Sessions are random bearer tokens. The server stores only their SHA-256 hash, and they expire after 12 hours. The browser keeps the token in `sessionStorage` for that tab only (never `localStorage`, never cookies).
- Sign-in attempts are limited per username, and new accounts are limited across the whole server.
- Signed-in players appear in rooms under their username with a verified badge and their avatar. One seat per account per room.
- Match history (your own games only), public profiles with statistics, and an all-time leaderboard of the top 50 players.
- Statistics come only from match records the server wrote itself. Clients never submit scores.

## Tech stack

| Area | Tools |
| --- | --- |
| Language | TypeScript (strict), npm workspaces monorepo |
| Frontend | React 18, Vite 5, Socket.IO client, lucide-react icons |
| Backend | Node.js, Express 4, Socket.IO 4, Mongoose 8, dotenv |
| Validation | Zod schemas shared by client and server (`packages/shared`) |
| Tests | Vitest (server: real HTTP and Socket.IO against an in-memory store; web: jsdom + Testing Library) |
| Hosting | GitHub Pages (frontend), Render (backend), MongoDB Atlas (database) |

## Repository structure

```text
.
├── apps/
│   ├── server/                 Express + Socket.IO backend
│   │   ├── src/
│   │   │   ├── index.ts        Entry point: loads .env, connects storage, starts listening
│   │   │   ├── app.ts          createGameServer(): HTTP app, Socket.IO, services (shared with tests)
│   │   │   ├── accounts/       Passwords, session tokens, usernames, rate limits, AccountService
│   │   │   ├── http/api.ts     JSON API under /api
│   │   │   ├── socket/         Socket handshake identity and event handlers
│   │   │   ├── domain/         Room/game engine (RoomManager), clues, voting, scoring, chat, match records
│   │   │   ├── moderation/     Chat moderation engine
│   │   │   ├── stats/          Statistics, leaderboard, match history, MatchRecorder
│   │   │   ├── store/          Store interface: MongoStore (Atlas) and MemoryStore (demo mode)
│   │   │   ├── persistence/    MongoDB connection, completed-game summaries, word-pair model
│   │   │   ├── data/           Curated word bank and its review tool
│   │   │   ├── seed.ts         Copies the reviewed word bank into MongoDB
│   │   │   └── reviewWords.ts  Word bank review report
│   │   ├── test/               Server tests (+ helpers/harness.ts)
│   │   └── .env.example
│   └── web/                    React + Vite frontend
│       ├── src/
│       │   ├── App.tsx         App shell, room/game screens, socket wiring
│       │   ├── pages/          Dashboard, sign-in/registration, profiles, match history, leaderboard
│       │   ├── components/     UI primitives, avatars, statistics, chat
│       │   ├── chat/           Chat client logic
│       │   ├── state/          API client, session, hash router, socket
│       │   └── styles/app.css
│       └── .env.example
├── packages/shared/            Types, constants and Zod schemas used by both apps
├── .github/workflows/deploy-pages.yml   CI + GitHub Pages deployment
├── render.yaml                 Render Blueprint for the backend
└── package.json                Workspace scripts
```

## Prerequisites

- **Node.js 20 or newer** (CI uses Node 20) and **npm 10 or newer**.
- Optional: a **MongoDB Atlas** cluster (the free M0 tier is enough) or a local MongoDB server. Without one, the server runs in demo mode.

## Install

```bash
npm install
```

This installs all three workspaces (`@imposter/shared`, `@imposter/server`, `@imposter/web`).

## Environment variables

Each app reads its own `.env` file from its own folder. `.env` files are git-ignored: never commit them.

### Server: `apps/server/.env`

```bash
cp apps/server/.env.example apps/server/.env
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | *(empty)* | MongoDB connection string. **Empty or missing: demo mode** (accounts and match records are kept in memory and erased when the server restarts). **Set: MongoDB is required.** If the connection fails, the server exits instead of silently falling back to memory. |
| `PORT` | `4000` | HTTP and Socket.IO port. Render sets this itself. |
| `CLIENT_ORIGIN` | `http://localhost:5173` | The exact origin of the web app allowed by CORS (HTTP and Socket.IO): scheme and host, no path, no trailing slash. |

`NODE_ENV=production` is set on Render; the code does not otherwise depend on it.

### Web: `apps/web/.env` (optional)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_PUBLIC_SOCKET_URL` | `http://localhost:4000` | Backend URL for the API and Socket.IO. It is built into the bundle, so it is public. |

For local development you do not need `apps/web/.env`: the default already points at the local server. `apps/web/.env.example` contains the production Render URL. Copy it only if you want your local frontend to talk to the deployed backend.

The root `.env.example` is not read by either app; it only points to these two files.

## MongoDB Atlas setup

1. Create a free **M0** cluster in MongoDB Atlas.
2. **Database Access:** create a database user with a strong, generated password and the *Read and write to any database* role (or a role limited to your database).
3. **Network Access:** allow your current IP for local development. Render's free plan has no fixed outbound IPs, so the deployed backend needs `0.0.0.0/0` (access from anywhere). The database password is then the only thing protecting the data, so keep it strong and private.
4. **Connect → Drivers:** copy the `mongodb+srv://…` connection string.
5. Put the string in `apps/server/.env` as `MONGODB_URI`, with your password and a **database name** after the host, for example `…mongodb.net/imposter?retryWrites=true&w=majority`. Without a database name, the driver uses a database called `test`.
   - If the password contains special characters (`@ : / ? # [ ] %`), URL-encode them.
6. Start the server and open `http://localhost:4000/health`. You should see `"storage":"mongodb"` and `"persistenceEnabled":true`.
7. Optional: run `npm run seed` to copy the reviewed word bank into a `wordpairs` collection. The game itself reads the word bank from the code, so seeding is not required to play.

The server creates these collections:

| Collection | Contents |
| --- | --- |
| `users` | Username, a lower-case key (unique index), scrypt password hash, avatar, creation date |
| `sessions` | SHA-256 hash of each session token, user id, expiry (TTL index: MongoDB deletes expired sessions) |
| `matches` | One record per completed game that had at least one signed-in player: timing, settings, rounds played, and each participant's display name, account id (or none for guests), avatar, final score, rank and outcome. No words, clues, votes, room codes or chat. |
| `completedgames` | Older end-of-game summary (room code, player names and scores, round history). Server-side only; never returned by the API. |
| `wordpairs` | Only written by `npm run seed`. |

Never paste a real connection string into an issue, a chat, a commit or a log.

## Run locally

```bash
npm run dev
```

This starts both apps:

- Web app: `http://localhost:5173`
- Server: `http://localhost:4000`, with a health check at `http://localhost:4000/health`

To run them separately:

```bash
npm run dev -w @imposter/server
npm run dev -w @imposter/web
```

To play locally with several players, open the web app in separate browser profiles or private windows. Each tab keeps its own sign-in.

The health check returns:

```json
{ "ok": true, "service": "whos-the-imposter-server", "persistenceEnabled": true, "storage": "mongodb" }
```

`storage` is `memory` in demo mode, `mongodb` when connected, and `mongodb-unavailable` if the connection drops while running. In that last state, account features answer `503` and guest play keeps working. The web app shows a banner for the `memory` and `mongodb-unavailable` states.

## Scripts

Run these from the repository root:

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (`tsx watch`) and web (Vite) together |
| `npm run build` | Builds shared, then server (`tsc` into `apps/server/dist`), then web (`tsc` + Vite into `apps/web/dist`) |
| `npm run typecheck` | Builds shared, then type-checks server and web |
| `npm test` | Server tests, then web tests (Vitest) |
| `npm run words:review` | Reviews the word bank and prints a report (fails on errors or open warnings) |
| `npm run seed` | Reviews the word bank, then upserts it into MongoDB (`MONGODB_URI` required; without it, prints the pair count and exits) |

Workspace-only scripts:

- `npm run start -w @imposter/server`: runs the built server (`node dist/index.js`). This is what Render uses.
- `npm run preview -w @imposter/web`: serves the built frontend.

`packages/shared` has no tests of its own. It is type-checked by its build and covered through the server and web tests.

## Tests and checks

Before opening a pull request, run all four checks. CI runs the first two:

```bash
npm run typecheck
npm test
npm run build
npm run words:review
```

- **Server tests** (`apps/server/test`) start the real server on a random port through `createGameServer()`, with an in-memory store. They use real Socket.IO clients and real HTTP requests, so no database is needed. They cover game rules, secrecy of roles and words, moderation, accounts and sessions, match recording, statistics, the leaderboard, and reconnect and cleanup edge cases.
- **Web tests** (`apps/web/src/**/*.test.ts(x)`) render the app in jsdom with a mocked socket and mocked `fetch`.

## Architecture

```text
Browser (GitHub Pages)                         Node.js server (Render)
┌──────────────────────────┐   HTTPS /api   ┌──────────────────────────────────────┐
│ React app                 │──────────────▶│ Express: accounts, profiles, history,│
│  - hash routes (#/…)      │                │          leaderboard (Zod-validated) │
│  - session token in       │   WebSocket    │ Socket.IO: handshake identity →      │
│    sessionStorage         │◀─────────────▶│   RoomManager (all rooms in memory)  │
│  - seat token in          │                │   → MatchRecorder → Store            │
│    localStorage           │                └───────────────┬──────────────────────┘
└──────────────────────────┘                                 │
                                                MongoStore (Atlas) or MemoryStore (demo)
```

- **Server-authoritative.** The server alone validates every action, advances phases on its timers, counts votes and computes scores. The client renders state and sends intentions.
- **Rooms are in memory.** Active rooms live in a single server process (`RoomManager`). A server restart ends all active games. Only one backend instance is supported.
- **Identity.** The Socket.IO handshake sends the session token (if any). An invalid or expired token is refused with `SESSION_INVALID`; the client then drops it and reconnects as a guest. Signed-in players always play under their username. A seat that belongs to an account can only be resumed by that same account.
- **Seats.** Creating or joining a room returns a random seat token. The client keeps it in `localStorage` so a page reload can resume the seat (`room:reconnect-player`). A connection holds at most one seat. A seat in a lobby is freed 60 seconds after its player disconnects. A room is removed 60 seconds after its last connected player leaves.
- **Match recording.** When the host presses Start, the server gives the game a random id and records the players dealt in. When the game ends normally, the server builds a match record from its own state and saves it once (retries with back-off; the id makes saves idempotent). Cancelled games, games with fewer than three remaining players, games without any signed-in player, and games with no completed round are not recorded. Players the host removed are left out. A player who disconnected but did not leave keeps their result.
- **Statistics** (games, wins, draws, losses, win rate, total points, best score) and the **leaderboard** are computed from stored match records. Ranking: wins, then win rate, then total points; players level on all three share a rank.

## HTTP API

All endpoints are under the backend URL. Responses are JSON with `Cache-Control: no-store`; errors are `{ "error": "message" }`. Authenticated endpoints need `Authorization: Bearer <token>`. Request bodies are limited to 10 KB.

| Method and path | Auth | Description |
| --- | --- | --- |
| `GET /health` | – | Service status and storage mode |
| `POST /api/auth/register` | – | `{ username, password, avatar }` → `201 { token, expiresAt, account }` |
| `POST /api/auth/login` | – | `{ username, password }` → `{ token, expiresAt, account }`. Wrong password and unknown user give the same `401`; too many attempts give `429` |
| `POST /api/auth/logout` | Bearer | Revokes the session and disconnects its sockets → `204` |
| `GET /api/auth/me` | Bearer | The signed-in account `{ username, avatar, joinedAt }` |
| `PATCH /api/me` | Bearer | `{ avatar }`: change your avatar |
| `GET /api/me/matches?page=N` | Bearer | Your own match history, 10 per page, newest first (`page` 1–1000) |
| `GET /api/players/:username` | – | Public profile and statistics |
| `GET /api/leaderboard` | – | Top 50 players |

Public responses never contain password hashes, session data, account ids, room codes, words, clues or votes. While MongoDB is unreachable, `/api` answers `503` and guest play continues.

## Socket.IO events

Every client event carries an acknowledgement callback, and every payload is validated with Zod.

- **Client → server:** `room:create`, `room:join`, `room:reconnect-player`, `player:ready`, `settings:update` (host), `player:kick` (host), `game:start` (host), `role:ack`, `clue:submit`, `vote:submit`, `imposter:guess`, `game:next-round` (host), `game:rematch` (host), `chat:send`, `chat:history`.
- **Server → client:** `room:state` (public room state), `player:secret` (your role and word, sent only to you), `round:result`, `chat:message`, `chat:history`, `room:error` (sent when you are removed from the room).

The event and payload types live in `packages/shared/src/index.ts`.

## Game rules

- 3 to 12 players. Nobody can join after the game starts. The host is always ready.
- The host can start when at least three connected players are present and every connected player is ready.
- Settings (host, in the lobby): 1–10 rounds, clue timer 10–180 s, discussion 0–300 s (or off), voting 10–180 s, categories and difficulty.
- Each round: role reveal → one clue each → discussion (if enabled) → anonymous vote → result. Missing clues count as missed, and missing votes as abstentions.
- A tie for the most votes triggers one runoff between the tied players. If the runoff also ties, nobody is identified.
- Scoring per round:
  - +2 to each normal player who voted for the Imposter.
  - +2 to the Imposter if not caught.
  - If the Imposter is caught, +1 to every normal player when most normal players voted correctly.
  - A caught Imposter may guess the main word once, for +2.
- If a disconnect or a host removal leaves fewer than three connected players during a game, the game is cancelled. A finished game stays finished when players leave the results screen.
- For statistics, a game is a **win** for players who finish rank 1, a **draw** if every player finishes rank 1, and otherwise a **loss**.

## Word pairs

Word pairs live in `apps/server/src/data/wordBank.ts`. They are curated and human-reviewed, spanning 14 categories and three difficulties. Each round the server picks a pair that matches the room's categories and difficulty. It randomly decides which word is the main word and sends each player only their own word. Pairs are not repeated in a room while unused matching pairs remain, including across rematches.

A good pair names two clearly different things that share at least one trait. Synonyms and variants (Mountain / Hill, Sofa / Couch) are rejected. The *Mixed* category holds cross-category pairs that share one trait, such as Zebra / Piano.

After any change to the bank, run `npm run words:review`. It reports:

- malformed entries and duplicates (including reversed pairs);
- identical words;
- invalid categories, difficulties or tags;
- previously rejected pairs and conflicts with chat moderation;
- possible near-synonyms.

Accept a flagged pair by recording the reason in `acknowledgedWarnings` in `apps/server/src/data/wordPairReview.ts`. The test suite runs the same review.

## Deployment overview

The frontend and backend deploy separately. The configuration below is what is in the repository; the Render service itself is managed in Render's dashboard.

### Frontend: GitHub Pages

`.github/workflows/deploy-pages.yml` runs on every push to `main` (and manually). It runs `npm ci`, `npm run typecheck` and `npm test`. It then builds the web app with `VITE_PUBLIC_SOCKET_URL` from the repository **Actions variable** of the same name, and publishes `apps/web/dist` to GitHub Pages.

- Vite's `base: "./"` and hash routes (`#/profile`, `#/leaderboard`, …) make the app work under a project path such as `https://<user>.github.io/Who-is-the-Imposter/`, including page refreshes.
- Set the `VITE_PUBLIC_SOCKET_URL` variable (Settings → Secrets and variables → Actions → Variables) to the Render backend URL.

### Backend: Render

`render.yaml` describes one free web service:

- **Build:** `npm ci && npm run build -w @imposter/shared && npm run build -w @imposter/server`
- **Start:** `npm run start -w @imposter/server`
- **Health check:** `/health`
- **Environment:**
  - `NODE_ENV=production`
  - `CLIENT_ORIGIN`: the GitHub Pages origin, e.g. `https://<user>.github.io`, with no path.
  - `MONGODB_URI`: set as secrets in the Render dashboard, never in the file.

On Render's free plan the service sleeps when idle, so the first request after a pause can take a while. A restart ends every active room, but accounts and match records in MongoDB are kept.

### Release checklist

1. All checks pass locally (`typecheck`, `test`, `build`, `words:review`).
2. Atlas network access allows the backend, and `MONGODB_URI` and `CLIENT_ORIGIN` are set on Render.
3. After deploying, `GET /health` reports `"storage":"mongodb"`.
4. With two or three browser profiles, check the full flow:
   - register and sign in;
   - create and join a room;
   - play a full game to the end;
   - confirm the match appears in each signed-in player's history, profile statistics and the leaderboard.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Web app shows "Reconnecting" forever | `VITE_PUBLIC_SOCKET_URL` must match the backend URL; the backend may be waking up on Render |
| CORS errors in the browser console | `CLIENT_ORIGIN` must be the exact frontend origin: no path, no trailing slash |
| Shows "Connected" but sign-in says "Could not reach the game server" | The socket is up but HTTP requests are blocked by CORS (WebSockets are not subject to CORS). Check the `access-control-allow-origin` header on `/health`: it must equal the frontend origin, e.g. `https://<user>.github.io`. A path or trailing slash in `CLIENT_ORIGIN` is now ignored, with a warning in the server log |
| Server exits at startup with a MongoDB error | Atlas IP access list, database user and password (URL-encoded), and cluster host. Leave `MONGODB_URI` empty to use demo mode instead |
| "Demo storage" banner | The server has no `MONGODB_URI`; accounts and records reset on restart |
| "Accounts are temporarily unavailable" | The server lost its MongoDB connection; guest play still works |
| "Your sign-in has expired" | Sessions last 12 hours; sign in again |
| Stuck on an old room during development | Clear the site's local storage (the seat token is under `imposter.credentials`) |

## Known limitations

- **Single instance, in-memory rooms.** Active games are lost on a server restart or redeploy, and the backend cannot be scaled horizontally without a Socket.IO adapter and shared room state.
- **Rate limits are in memory and not per IP.** On Render every client appears to come from the proxy's address, so IP limits would block everyone. The limits are:
  - sign-in attempts per username, which also means someone can temporarily lock a username by failing on purpose;
  - new accounts per server.

  They reset on restart.
- **No password reset or email.** A forgotten password cannot be recovered.
- **Session expiry during a game.** If a signed-in player's 12-hour session expires and their connection drops, they cannot resume that account seat.
- **Statistics can be inflated** by playing with guest players or friendly accounts. Records are never edited by clients, but there is no anti-farming check. A player removed by the host is left out of that game's record.
- **Match saves can be lost.** If MongoDB stays unreachable through all retries (about 42 seconds), or the server restarts before saving, that game is not recorded.
- **Leaderboard scale.** The leaderboard is computed from all match records on each request, which is fine for a small community. There is no "your rank" outside the top 50.
- **Multiple tabs on one seat.** The seat token is shared by tabs of the same browser. The newest tab receives the private word, and leaving from one tab clears the saved seat for both.
- The older `completedgames` summaries include round history (words and clues). They are stored server-side only and never served by the API.
- Voice chat, public matchmaking, multiple Imposters, custom word lists and social sign-in are not implemented.
