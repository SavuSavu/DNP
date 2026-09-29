import "./style.css";
import { GameEngine, FixedLoop } from "./engine";
import { KeyboardController, DirectionController } from "./controllers";
import {
  type Player,
  type Difficulty,
  type GameSnapshot,
  type Direction,
  COLORS,
  isVertical,
} from "./types";
import { Renderer } from "./render";
import { generateCode, normalizeCode, inviteUrl } from "./protocol";
import { RoomSession, trysteroTransport, type Transport } from "./network";
import { SnapshotBuffer } from "./interpolation";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<header><a class="brand" href="./" aria-label="DNP home">DNP<span>DEFINITELY NOT PONG</span></a><span class="tag"><i></i> NO SERVER. ALL GAME.</span></header>
<main>
<section id="menu" class="screen">
  <div class="hero"><div class="eyebrow">THE CLASSIC. WITH A FEW EXTRA SIDES.</div><h1>Definitely<br><em>not</em> Pong<span class="dot">.</span></h1><p>One ball. Too many paddles. Five lives.<br>Protect your side and be the last one standing.</p><div class="hero-stats"><span><b>1–12</b> players</span><span><b>5</b> lives</span><span><b>0</b> downloads</span></div></div>
  <div class="menu-panel"><div class="panel-title"><span class="number">01</span><h2>Enter the arena</h2></div>
    <label>Your name<input id="name" maxlength="20" placeholder="Player" autocomplete="nickname"></label>
    <div class="solo-options"><label>Bot opponents<select id="bots">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n} bot${n === 1 ? "" : "s"} · ${n + 1} players</option>`).join("")}</select></label><label>Difficulty<select id="difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></label></div>
    <button id="solo" class="primary">Play solo <span>↗</span></button>
    <div class="divider"><span>OR BRING YOUR FRIENDS</span></div>
    <button id="create" class="secondary">Create room <span>＋</span></button>
    <form id="join-form"><label class="sr-only" for="code">Six-character room code</label><input id="code" maxlength="6" placeholder="ROOM CODE" autocomplete="off" aria-label="Room code"><button id="join" type="submit">Join →</button></form>
    <p class="small">Private rooms · up to 12 players · peer-to-peer</p>
  </div>
</section>
<section id="lobby" class="screen hidden"><div class="lobby-top"><div><div class="eyebrow">YOUR CREW. YOUR ARENA.</div><h1>Room <span id="room-code"></span></h1></div><button id="copy" class="secondary">Copy invite ↗</button></div><p id="lobby-status" role="status">Connecting…</p><div id="players" class="players"></div><div class="lobby-bottom"><button id="start" class="primary">Start game →</button><button id="leave-lobby" class="secondary">Leave room</button></div><p class="small">Five lives each. Defend your colored edge. Arenas merge when six active humans remain.</p></section>
<section id="game" class="hidden"><div class="game-top"><div><div class="eyebrow">SURVIVAL MODE</div><h2 id="match-title">Protect your side.</h2></div><div class="game-actions"><button id="debug-toggle" class="quiet">Diagnostics</button><button id="leave-game" class="quiet">Leave</button></div></div><div id="scoreboard" class="scoreboard" aria-label="Player lives"></div><div class="canvas-wrap"><canvas id="canvas" aria-label="Pong arena"></canvas></div><div class="controls"><span id="control-label">W / S or ↑ / ↓ to move</span><div class="touch-controls"><button id="negative" aria-label="Move up">↑</button><button id="positive" aria-label="Move down">↓</button></div><span id="ping">Local · 60 Hz</span></div><div id="debug" class="hidden"></div><div id="result" class="hidden result"><h2 id="winner"></h2><p>Good defense. Questionable resemblance to Pong.</p><button id="again" class="primary">Play again →</button><button id="menu-result" class="secondary">Back to menu</button></div></section>
<div id="notice" class="notice hidden" role="alert"><span id="notice-text"></span><button id="notice-dismiss" aria-label="Dismiss">×</button></div>
</main><footer><span>BUILT FOR THE BROWSER.</span><span>W/S or ↑/↓ · A/D or ←/→ · touch supported</span></footer>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
const show = (id: string, visible: boolean) =>
  el(id).classList.toggle("hidden", !visible);
const screen = (id: string) => {
  for (const s of ["menu", "lobby", "game"]) show(s, s === id);
};
const keyboard = new KeyboardController();
const renderer = new Renderer(el<HTMLCanvasElement>("canvas"));
let engine: GameEngine | null = null,
  session: RoomSession | null = null,
  code = "",
  localId = "human",
  view: GameSnapshot | null = null;
let loop = new FixedLoop(),
  buffer = new SnapshotBuffer(),
  lastFrame = performance.now(),
  lastSend = 0,
  lastPing = 0,
  lastLobbyHeartbeat = 0,
  lastInput = 0,
  lastDirection: Direction = 0;
let scoreSignature = "",
  resultShown = false,
  diagnostics = false,
  soloDifficulty: Difficulty = "medium";
let transportFactory = (code: string): Transport => trysteroTransport(code);
// Only the local development server exposes a transport seam for browser tests.
if (import.meta.env.DEV)
  (
    window as unknown as {
      dnpTest: {
        setTransportFactory: (factory: typeof transportFactory) => void;
      };
    }
  ).dnpTest = {
    setTransportFactory: (factory) => {
      transportFactory = factory;
    },
  };
try {
  input("name").value = localStorage.getItem("dnp-name") || "";
} catch {}
function name() {
  const value = input("name").value.trim() || "Player";
  try {
    localStorage.setItem("dnp-name", value);
  } catch {}
  return value;
}
function notice(text: string) {
  el("notice-text").textContent = text;
  show("notice", true);
}
function resetMatch() {
  engine = null;
  view = null;
  buffer.clear();
  loop = new FixedLoop();
  scoreSignature = "";
  resultShown = false;
  show("result", false);
}
function leave() {
  session?.close();
  session = null;
  resetMatch();
  screen("menu");
  el("ping").textContent = "Local · 60 Hz";
  history.replaceState(null, "", location.pathname);
}
function enterGame() {
  screen("game");
  resultShown = false;
  show("result", false);
  lastSend = 0;
  lastInput = 0;
}
function solo() {
  leave();
  soloDifficulty = el<HTMLSelectElement>("difficulty").value as Difficulty;
  localId = "human";
  const bots = Number(el<HTMLSelectElement>("bots").value);
  const players: Player[] = Array.from({ length: bots + 1 }, (_, i) => ({
    id: i === 0 ? localId : `bot-${i}`,
    name: i === 0 ? name() : `Bot ${i}`,
    slot: i,
    lives: 5,
    bot: i > 0,
    connected: i === 0,
  }));
  engine = new GameEngine(players, "solo", soloDifficulty);
  engine.controllers.set(localId, keyboard);
  enterGame();
}
function lobby(players: Player[]) {
  resetMatch();
  screen("lobby");
  el("players").replaceChildren();
  for (const p of players) {
    const card = document.createElement("div");
    card.className = "player-card";
    card.style.setProperty("--player-color", COLORS[p.slot]);
    const marker = document.createElement("span");
    marker.className = "avatar";
    marker.textContent = String(p.slot + 1).padStart(2, "0");
    const text = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = p.name + (p.id === localId ? " (you)" : "");
    const small = document.createElement("small");
    small.textContent = p.id === session?.hostId ? "HOST" : "READY";
    text.append(strong, small);
    card.append(marker, text);
    el("players").append(card);
  }
  el("lobby-status").textContent =
    `${players.length}/12 players · ${session?.host ? "Share your invite to bring players in." : "Waiting for the host to start."}`;
  show("start", !!session?.host);
  el<HTMLButtonElement>("start").disabled = players.length < 2;
}
function openRoom(host: boolean, roomCode: string) {
  leave();
  code = roomCode;
  screen("lobby");
  el("room-code").textContent = code;
  el("players").replaceChildren();
  el("lobby-status").textContent = host
    ? "Creating room…"
    : "Connecting to the host…";
  show("start", false);
  try {
    const transport = transportFactory(code);
    localId = transport.id;
    session = new RoomSession(host, name(), transport, {
      lobby,
      snapshot: (state) => {
        if (!session) return;
        if (!session.playing) return;
        if (el("game").classList.contains("hidden")) enterGame();
        buffer.push(state, performance.now());
      },
      input: (id, direction) => {
        const controller = engine?.controllers.get(id);
        if (controller instanceof DirectionController)
          controller.direction = direction;
      },
      disconnected: (id) => engine?.disconnect(id),
      error: (message) => {
        leave();
        notice(message);
      },
      ping: (ms) => {
        el("ping").textContent = `${ms} ms · peer-to-peer`;
      },
    });
    history.replaceState(null, "", inviteUrl(code, location.href));
    if (host) lobby(session.roster);
  } catch (error) {
    leave();
    notice(
      `Could not connect: ${error instanceof Error ? error.message : "WebRTC unavailable"}`,
    );
  }
}
el("solo").onclick = solo;
el("create").onclick = () => openRoom(true, generateCode());
el("join-form").onsubmit = (e) => {
  e.preventDefault();
  const normalized = normalizeCode(input("code").value);
  if (!normalized) {
    notice(
      "Enter a six-character room code, using letters and numbers without I, O, 0 or 1.",
    );
    return;
  }
  openRoom(false, normalized);
};
el("start").onclick = () => {
  if (!session?.start()) return;
  engine = new GameEngine(session.roster, "multiplayer");
  engine.controllers.set(localId, keyboard);
  enterGame();
  session.broadcastSnapshot(engine.snapshot());
};
el("copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(inviteUrl(code, location.href));
    el("copy").textContent = "Copied ✓";
    setTimeout(() => {
      el("copy").textContent = "Copy invite ↗";
    }, 1500);
  } catch {
    notice(`Invite: ${inviteUrl(code, location.href)}`);
  }
};
for (const id of ["leave-lobby", "leave-game", "menu-result"])
  el(id).onclick = leave;
el("again").onclick = () => {
  if (!session) {
    solo();
  } else if (session.host) {
    session.rematchLobby();
  } else {
    notice("Waiting for the host to open the next lobby.");
  }
};
el("notice-dismiss").onclick = () => show("notice", false);
el("debug-toggle").onclick = () => {
  diagnostics = !diagnostics;
  show("debug", diagnostics);
};
for (const [id, direction] of [
  ["negative", -1],
  ["positive", 1],
] as const) {
  const button = el(id);
  button.onpointerdown = (e) => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    keyboard.setTouch(direction);
  };
  button.onpointerup = () => keyboard.setTouch(0);
  button.onpointercancel = () => keyboard.setTouch(0);
  button.onlostpointercapture = () => keyboard.setTouch(0);
}
function updateHUD(state: GameSnapshot) {
  el("game").classList.toggle("split", state.arenas.length > 1);
  const paddle = state.paddles.find((p) => p.playerId === localId);
  const alive = state.players.find((p) => p.id === localId)?.lives ?? 0;
  const vertical = !paddle || isVertical(paddle.side);
  keyboard.setVertical(vertical);
  el("control-label").textContent =
    alive <= 0
      ? "Eliminated · spectating"
      : vertical
        ? "W / S or ↑ / ↓ to move"
        : "A / D or ← / → to move";
  el("negative").textContent = vertical ? "↑" : "←";
  el("positive").textContent = vertical ? "↓" : "→";
  el("negative").setAttribute("aria-label", vertical ? "Move up" : "Move left");
  el("positive").setAttribute(
    "aria-label",
    vertical ? "Move down" : "Move right",
  );
  el<HTMLButtonElement>("negative").disabled = alive <= 0;
  el<HTMLButtonElement>("positive").disabled = alive <= 0;
  el("match-title").textContent =
    state.arenas.length > 1
      ? "Two arenas. One eventual survivor."
      : "Protect your side.";
  const signature = JSON.stringify(
    state.players.map((p) => [p.id, p.lives, p.bot]),
  );
  if (signature !== scoreSignature) {
    scoreSignature = signature;
    el("scoreboard").replaceChildren();
    for (const p of state.players) {
      const item = document.createElement("span");
      item.className = p.lives ? "score" : "score eliminated";
      item.style.setProperty("--player-color", COLORS[p.slot]);
      item.textContent = `${p.name}${p.bot ? " [BOT]" : ""} · ${p.lives ? "♥".repeat(p.lives) : "OUT"}`;
      el("scoreboard").append(item);
    }
  }
  if (state.phase === "finished" && !resultShown) {
    resultShown = true;
    el("winner").textContent = state.winner
      ? `${state.players.find((p) => p.id === state.winner)?.name} wins!`
      : "Draw!";
    el("again").textContent =
      session && !session.host
        ? "Waiting for host"
        : session
          ? "Return to lobby →"
          : "Play again →";
    el<HTMLButtonElement>("again").disabled = !!session && !session.host;
    show("result", true);
  }
  if (!session) el<HTMLButtonElement>("again").disabled = false;
}
function frame(now: number) {
  const elapsed = (now - lastFrame) / 1000;
  lastFrame = now;
  session?.maintenance();
  if (engine) {
    loop.advance(elapsed, () => engine?.step());
    view = engine.state;
    if (session?.host && now - lastSend >= 40) {
      session.broadcastSnapshot(engine.snapshot());
      lastSend = now;
    }
  } else if (session?.playing) view = buffer.sample(now);
  if (view && !el("game").classList.contains("hidden")) {
    updateHUD(view);
    renderer.draw(view, localId);
    if (diagnostics)
      el("debug").textContent =
        `${session ? (session.host ? "AUTHORITATIVE HOST" : "INTERPOLATED CLIENT") : "LOCAL SIMULATION"} · tick ${view.tick} · revision ${view.revision} · arenas ${view.arenas.length} · physics 60 Hz / snapshots 25 Hz`;
    if (session && !session.host && session.playing) {
      const direction = keyboard.read();
      if (now - lastInput >= 50 || direction !== lastDirection) {
        session.input(direction);
        lastInput = now;
        lastDirection = direction;
      }
    }
  }
  if (session && now - lastPing >= 2000) {
    session.ping();
    lastPing = now;
  }
  if (session?.host && !session.playing && now - lastLobbyHeartbeat >= 2000) {
    session.broadcastLobby();
    lastLobbyHeartbeat = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const initial = normalizeCode(
  new URL(location.href).searchParams.get("room") || "",
);
if (initial) {
  input("code").value = initial;
  notice(`Invite to room ${initial}. Enter your name, then press Join.`);
}
window.addEventListener("pagehide", () => session?.close());
