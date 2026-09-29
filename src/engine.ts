import {
  type Player,
  type ArenaLayout,
  type ArenaState,
  type GameSnapshot,
  type Controller,
  type Difficulty,
  STEP,
  BALL_SPEED,
} from "./types";
import { arenaFor, layoutsForPlayers, paddlesFor } from "./layout";
import { advanceBall, movePaddle } from "./physics";
import { BotController, DirectionController } from "./controllers";
export class GameEngine {
  state: GameSnapshot;
  controllers = new Map<string, Controller>();
  private random: () => number;
  constructor(
    players: Player[],
    private mode: "solo" | "multiplayer",
    difficulty: Difficulty = "medium",
    random = Math.random,
  ) {
    if (players.length < 2 || players.length > (mode === "solo" ? 6 : 12))
      throw new RangeError("Invalid match size");
    this.random = random;
    this.state = {
      revision: 0,
      tick: 0,
      time: 0,
      phase: "playing",
      players: structuredClone(players).map((p) => ({ ...p, lives: 5 })),
      paddles: [],
      arenas: [],
      winner: null,
    };
    for (const p of this.state.players)
      this.controllers.set(
        p.id,
        p.bot
          ? new BotController(difficulty, random)
          : new DirectionController(),
      );
    this.rebuild(layoutsForPlayers(this.state.players), 2);
  }
  private makeArena(layout: ArenaLayout, countdown: number): ArenaState {
    const arena: ArenaState = {
      ...layout,
      ball: {
        id: `ball-${layout.id}`,
        arenaId: layout.id,
        x: layout.width / 2,
        y: layout.height / 2,
        vx: 0,
        vy: 0,
        radius: 7,
      },
      countdown,
      waiting: layout.defenses.length < 2,
    };
    this.serve(arena, countdown);
    return arena;
  }
  private serve(arena: ArenaState, countdown = 1) {
    const angle = (this.random() * 0.8 - 0.4) * Math.PI;
    const sign = this.random() < 0.5 ? -1 : 1;
    Object.assign(arena.ball, {
      x: arena.width / 2,
      y: arena.height / 2,
      vx: Math.cos(angle) * BALL_SPEED * sign,
      vy: Math.sin(angle) * BALL_SPEED,
    });
    arena.countdown = countdown;
  }
  private rebuild(layouts: ArenaLayout[], countdown = 2) {
    this.state.revision++;
    this.state.arenas = layouts.map((a) => this.makeArena(a, countdown));
    this.state.paddles = layouts.flatMap(paddlesFor);
  }
  disconnect(id: string) {
    const p = this.state.players.find((p) => p.id === id);
    if (!p || !p.connected) return;
    p.connected = false;
    if (p.lives > 0) {
      p.bot = true;
      this.controllers.set(id, new BotController("medium", this.random));
    }
    this.reconcile();
  }
  private reconcile() {
    let alive = this.state.players
      .filter((p) => p.lives > 0)
      .sort((a, b) => a.slot - b.slot);
    const activeHumans = alive.filter((p) => p.connected && !p.bot);
    if (
      this.state.arenas.length > 1 &&
      (this.mode === "solo" ? alive.length <= 6 : activeHumans.length <= 6)
    ) {
      if (this.mode === "multiplayer") {
        for (const p of alive) if (p.bot) p.lives = 0;
        alive = activeHumans;
      }
      if (alive.length > 1) this.rebuild([arenaFor(alive.map((p) => p.id))]);
    } else if (alive.length > 1) {
      const layouts = this.state.arenas
        .map((a) => ({
          id: a.id,
          ids: a.defenses
            .map((d) => d.playerId)
            .filter((id) => alive.some((p) => p.id === id)),
        }))
        .filter((a) => a.ids.length);
      if (
        layouts.some(
          (a) =>
            a.ids.length !==
            this.state.arenas.find((old) => old.id === a.id)?.defenses.length,
        ) ||
        layouts.length !== this.state.arenas.length
      )
        this.rebuild(layouts.map((a) => arenaFor(a.ids, a.id)));
    }
    if (alive.length <= 1) {
      this.state.phase = "finished";
      this.state.winner = alive[0]?.id ?? null;
    }
  }
  step(dt = STEP) {
    if (this.state.phase !== "playing") return;
    this.state.tick++;
    this.state.time += dt;
    const losers: string[] = [];
    for (const arena of this.state.arenas) {
      if (arena.waiting) continue;
      const paddles = this.state.paddles.filter((p) => p.arenaId === arena.id);
      for (const paddle of paddles)
        movePaddle(
          paddle,
          this.controllers
            .get(paddle.playerId)
            ?.read({ time: this.state.time, paddle, arena }) ?? 0,
          dt,
        );
      if (arena.countdown > 0) {
        arena.countdown = Math.max(0, arena.countdown - dt);
        continue;
      }
      const loser = advanceBall(arena, paddles, dt);
      if (loser) {
        losers.push(loser);
        this.serve(arena);
      }
    }
    for (const id of losers) {
      const p = this.state.players.find((p) => p.id === id);
      if (p) p.lives = Math.max(0, p.lives - 1);
    }
    if (
      losers.some(
        (id) => this.state.players.find((p) => p.id === id)?.lives === 0,
      )
    )
      this.reconcile();
  }
  snapshot(): GameSnapshot {
    return structuredClone(this.state);
  }
}
export class FixedLoop {
  private accumulator = 0;
  advance(elapsed: number, step: () => void) {
    this.accumulator += Math.max(0, Math.min(0.15, elapsed));
    let count = 0;
    while (this.accumulator + 1e-10 >= STEP && count < 9) {
      step();
      this.accumulator -= STEP;
      count++;
    }
    return Math.max(0, this.accumulator / STEP);
  }
}
