# Who's the Imposter?

A real-time private-room social deduction game built with React, Vite, TypeScript, Express, Socket.IO, Zod, and optional MongoDB persistence.

## Features

- Secure server-generated room codes, player IDs, and reconnect tokens.
- Live lobby with host controls, readiness, kicks, invite links, and configurable round settings.
- Server-authoritative game phases: lobby, private role reveal, clues, discussion, voting, runoff voting, results, game end, and cancellation.
- Private Socket.IO role messages so players receive only their own word and role.
- One-word clue validation, duplicate clue rejection, deadline handling, anonymous voting, no self-votes, deterministic runoff tie rules, and abstentions.
- Backend-only scoring with cumulative leaderboard, shared final ranks, rematch support, and optional Imposter word guess bonus.
- Curated fallback word bank with 60+ related word pairs across the requested categories.
- Optional MongoDB seed script and completed-game persistence.
- Unit tests for domain rules and integration tests for critical Socket.IO behavior.

## Architecture

```text
apps/web       React/Vite client, Socket.IO client, responsive game UI
apps/server    Express health API, Socket.IO server, room/game engine, persistence
packages/shared Shared TypeScript contracts, Zod schemas, constants
```

Active multiplayer room state is stored in memory on the Node.js server. MongoDB is used only for seedable word pairs and completed game summaries in this MVP. If the backend process restarts, active rooms are lost.

## Prerequisites

- Node.js 20 or newer.
- npm 10 or newer.
- Optional: MongoDB Atlas or a local MongoDB instance.

## Install

```bash
npm install
```

## Environment

Copy the examples and edit values as needed:

```bash
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

For local development without MongoDB, leave `MONGODB_URI` blank. The server will use the fallback word bank and clearly report that persistence is disabled.

## Run Locally

Start both apps:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev -w @imposter/server
npm run dev -w @imposter/web
```

Open the web app at `http://localhost:5173`. The backend health check is `http://localhost:4000/health`.

## Seed Word Pairs

With `MONGODB_URI` configured:

```bash
npm run seed
```

Without MongoDB, the seed command prints the fallback word-bank count and exits successfully.

## Checks

```bash
npm run typecheck
npm test
npm run build
```

## Gameplay Notes

- Minimum players: 3. Maximum players: 12.
- Late joins are disabled after the game starts.
- The host is ready automatically.
- The host may start only when at least three connected players are present and all non-host players are ready.
- Missing clues and votes are treated as missed submissions or abstentions.
- A tied top vote triggers one runoff among tied candidates. If the runoff ties, no one is identified.
- The Imposter gets +2 points for escaping. Normal players get +2 for voting for the Imposter. If the Imposter is caught, a normal-player majority bonus and optional Imposter word-guess bonus can apply.

## Production Deployment

1. Build the shared package and both apps with `npm run build`.
2. Deploy `apps/web/dist` to a static host such as Vercel, Netlify, or Cloudflare Pages.
3. Deploy `apps/server` to a Node.js host that supports persistent WebSocket connections, such as Render, Fly.io, or Railway.
4. Set server environment variables:
   - `NODE_ENV=production`
   - `PORT=<host provided port>`
   - `CLIENT_ORIGIN=https://your-frontend-domain.example`
   - `MONGODB_URI=<mongodb atlas connection string>`
5. Set frontend environment variables before building:
   - `VITE_PUBLIC_SOCKET_URL=https://your-backend-domain.example`
6. Run `npm run seed` against the production MongoDB database.
7. Verify `/health` returns `ok: true`.
8. Open the deployed frontend in two browser profiles and confirm room creation, joining, ready state, and Socket.IO gameplay updates.

Use one backend instance for this MVP. Horizontal scaling requires a Socket.IO adapter plus shared active-game state, which is not implemented here.

### Render Backend

This repo includes `render.yaml` for a Render Blueprint web service. After pushing to GitHub:

1. In Render, choose **New > Blueprint** and select this repository.
2. Set `CLIENT_ORIGIN` to your GitHub Pages origin, for example `https://your-user.github.io`.
3. Optionally set `MONGODB_URI` for persistence. Leave it blank to use the fallback word bank.
4. Deploy the service and copy the public backend URL.
5. In GitHub repository settings, add an Actions variable named `VITE_PUBLIC_SOCKET_URL` with the Render backend URL.

## Troubleshooting

- If the web app cannot connect, confirm `VITE_PUBLIC_SOCKET_URL` matches the backend URL.
- If CORS blocks connections, set `CLIENT_ORIGIN` to the exact frontend origin.
- If MongoDB fails, leave `MONGODB_URI` blank for local fallback mode or verify Atlas network access and credentials.
- If a reconnect creates confusion during development, clear browser local storage for the site.

## Known Limitations

- Active rooms are in memory and disappear on backend restart.
- Voice chat, public matchmaking, authentication, multiple Imposters, and AI-generated words are intentionally out of scope.
- Completed-game persistence is available only when MongoDB is configured.
- The Imposter guess opportunity is available during the round-result screen when the Imposter was correctly identified.
