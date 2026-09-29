# DNP — Definitely Not Pong

A browser survival arcade for **one human and 1–5 bots**, or **2–12 human players**. Canvas 2D, TypeScript, Vite, and Trystero/WebRTC. No dedicated game server, database, or accounts.

**Play:** https://savusavu.github.io/DNP/

## Run locally

Use Node.js 22.12+ (tested with 22.23).

```sh
npm install
npm run dev
```

Open the URL printed by Vite, including `/DNP/`. Create a room in one browser and join its code from another. Invite links preserve the project path, e.g. `https://savusavu.github.io/DNP/?room=K7P4XZ`. Localhost works for WebRTC; remote hosting requires HTTPS. Solo also works without signaling access.

```sh
npm test                 # deterministic simulation, protocol, and session tests
npm run check            # strict TypeScript checks
npm run build            # typecheck and production bundle in dist/
npm run preview          # serve the production bundle
npx playwright install chromium
npm run test:browser      # deterministic browser integration tests
RUN_REAL_WEBRTC=1 npm run test:browser -- --grep 'real Trystero'
```

The opt-in test uses actual public Nostr discovery and WebRTC; the regular browser tests inject a BroadcastChannel transport into the same room/session implementation. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an already installed Chromium executable. The transport injection hook is available only in Vite development builds.

## Playing

- Vertical paddles: **W/S** or **Up/Down**. Horizontal paddles: **A/D** or **Left/Right**. Touch buttons adapt to your assigned side.
- Each competitor starts with **five lives**. Missing your defensive region costs one life. Unassigned edges bounce the ball. A serve has a one-second countdown; layout changes have a two-second countdown.
- Solo offers 1–5 bots and easy/medium/hard difficulty. Bots have reaction delays, tracking error, and bounded speed.
- The room creator is the host and starts once at least two players join. Capacity is 12. New players cannot join active matches. Eliminated players can spectate and join the host's next lobby.
- Losing the last life eliminates a player. Survivors in that arena receive new positions in original slot order while retaining lives. The final survivor wins; a simultaneous total elimination is a draw.
- With 7–12 players, each arena has its own ball. A lone survivor waits for the arenas to merge.
- A disconnected non-host becomes a medium bot preserving lives. **When six or fewer living connected humans remain in split mode**, replacement bots are removed and the humans merge into one arena with their lives preserved. In single-arena mode, replacement bots remain.
- Host departure ends the session. The host can open the lobby again after a finished match; connected players are retained and lives reset on the next start.

| Players      | Layout                                             |
| ------------ | -------------------------------------------------- |
| One human    | Left human, right bot (default solo)               |
| 2            | Left, right                                        |
| 3            | Left, right, top                                   |
| 4            | Left, right, top, bottom                           |
| 5            | Left, right, two top sections, one bottom          |
| 6            | Left, right, two top sections, two bottom sections |
| 7 / 8 / 9    | Arenas of 4+3 / 4+4 / 5+4                          |
| 10 / 11 / 12 | Arenas of 5+5 / 6+5 / 6+6                          |

## Architecture

The engine operates in 800×600 logical coordinates per arena at 60 Hz. Rendering uses high-DPI canvas scaling and stacks split arenas on narrow displays. An accumulator bounds catch-up after stalls. Ball collisions use continuous time-of-impact tests against paddle faces and wall/goal planes. Impact offset changes the bounce angle; each paddle hit increases speed by 4.5%, capped at 760 logical units/second. Paddles move at up to 360 units/second within their defensive section.

| Module                         | Responsibility                                                           |
| ------------------------------ | ------------------------------------------------------------------------ |
| `src/types.ts`                 | Player, Paddle, Ball, ArenaState, GameSnapshot, and controller contracts |
| `src/layout.ts`                | `getArenaLayout(playerCount)`, region ownership, paddle spawning         |
| `src/physics.ts`               | Movement, swept collisions, bounce angles, wall/goal handling            |
| `src/engine.ts`                | Fixed loop, lives, serves, elimination, disconnects, merging             |
| `src/controllers.ts`           | Keyboard/touch, direction-only remote inputs, imperfect bots             |
| `src/protocol.ts`              | Room codes, invite URLs, slot allocation, versioned runtime validation   |
| `src/network.ts`               | Trystero adapter, admission, authoritative sessions, ping, timeouts      |
| `src/interpolation.ts`         | Snapshot buffering and interpolation with layout/serve resets            |
| `src/render.ts`                | Resolution-independent Canvas renderer                                   |
| `src/main.ts`, `src/style.css` | Menus, lobby, HUD, results, responsive controls                          |
| `tests/`                       | Unit tests and browser integration tests                                 |
| `.github/workflows/pages.yml`  | Test, build, and deploy Pages                                            |

The engine reads `Controller.read(context): -1 | 0 | 1`; it does not know whether input comes from a human, a bot, or another browser. `GameEngine.snapshot()` returns an independent serializable state copy. Each player has a stable ID and original slot, while paddle regions change after elimination.

## Multiplayer protocol

Trystero 0.25.4 uses Nostr relays for discovery. Game data travels on WebRTC DataChannels. Trystero may establish peer connections among room members, but gameplay messages follow host authority: client input targets the host; host snapshots broadcast to clients.

Messages have protocol version `v: 1` and a `type` discriminator:

- `hello`, `welcome`, `lobby`, `reject`, `host`: discovery/admission, host identity, bounded rosters, room errors.
- `input`: monotonically increasing sequence and direction only. Clients cannot supply trusted positions or outcomes.
- `snapshot`: complete host state, tick, simulation time, layout revision, lives, paddles, balls, countdowns, and result.
- `ping`, `pong`: bounded nonce for round-trip timing.

Host admissions assign the earliest free slot serially. Members alone can send input; replayed, malformed, nonfinite, oversized, and role-invalid messages are ignored. Input updates have an 8 ms minimum interval. Clients send changed direction immediately plus a 20 Hz heartbeat; inputs older than 500 ms are neutralized. Clients accept state only from the admitted host.

The host broadcasts at 25 Hz. Clients keep up to 12 snapshots and interpolate about 100 ms behind received simulation time. Underflow freezes at available state rather than inventing physics. Layout revisions and new serves prevent blending across teleports. Diagnostics expose roles, ticks, arena count, snapshot rate, and ping.

## GitHub Pages

The deployment base is `/DNP/`; change `vite.config.ts` if the repository path changes or a custom root domain is used. In GitHub **Settings → Pages → Build and deployment → Source**, select **GitHub Actions**. Branch publishing cannot directly serve uncompiled TypeScript.

Pushes to `main` run locked dependency installation, unit tests, production build, and browser tests before uploading `dist/` and deploying. Pull requests run the same checks without deployment. The `github-pages` environment and the workflow's Pages/OIDC permissions support deployment without stored tokens. Inspect the repository's Actions tab for rollout status.

## Known limitations

- Public signaling infrastructure must be reachable. WebRTC can fail across restrictive NATs or firewalls without TURN; this build does not include a paid/private TURN service. Join attempts time out after 20 seconds and can be retried.
- Host authority means a modified host can cheat. Room codes are invitations, not authenticated identities. There is no account system, persistent score history, reconnect reclamation, or host migration.
- Keep the host tab visible: browser background throttling can slow simulation. Remote display includes the interpolation delay; no client prediction is implemented.
- A full room can use many WebRTC connections; performance depends on browsers and networks. Debug output reports target rates, not a guaranteed network delivery rate.
- Fonts are fetched from Google Fonts when available; system fonts provide an offline fallback. Menus are accessible DOM elements; gameplay itself is graphical Canvas.
