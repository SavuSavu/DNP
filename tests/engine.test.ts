import { describe, it, expect } from "vitest";
import { getArenaLayout, goalOwner, paddlesFor } from "../src/layout";
import { advanceBall, bounce, movePaddle } from "../src/physics";
import { GameEngine, FixedLoop } from "../src/engine";
import { BotController, DirectionController } from "../src/controllers";
import {
  type Player,
  type ArenaState,
  STEP,
  MAX_BALL_SPEED,
} from "../src/types";
export const players = (count: number): Player[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    slot: i,
    lives: 5,
    bot: false,
    connected: true,
  }));
function arena(): ArenaState {
  return new GameEngine(players(2), "multiplayer", "medium", () => 0.5).state
    .arenas[0];
}
function forceGoal(engine: GameEngine, arenaIndex: number, id: string) {
  const a = engine.state.arenas[arenaIndex];
  const d = a.defenses.find((d) => d.playerId === id)!;
  a.countdown = 0;
  const b = a.ball;
  const mid = (d.start + d.end) / 2;
  if (d.side === "left") {
    Object.assign(b, { x: 8, y: mid, vx: -290, vy: 0 });
  }
  if (d.side === "right") {
    Object.assign(b, { x: 792, y: mid, vx: 290, vy: 0 });
  }
  if (d.side === "top") {
    Object.assign(b, { x: mid, y: 8, vx: 0, vy: -290 });
  }
  if (d.side === "bottom") {
    Object.assign(b, { x: mid, y: 592, vx: 0, vy: 290 });
  }
}
describe("layouts", () => {
  const expected: Record<number, number[]> = {
    1: [2],
    2: [2],
    3: [3],
    4: [4],
    5: [5],
    6: [6],
    7: [4, 3],
    8: [4, 4],
    9: [5, 4],
    10: [5, 5],
    11: [6, 5],
    12: [6, 6],
  };
  for (let n = 1; n <= 12; n++)
    it(`${n} players have unique ordered slots and bounded regions`, () => {
      const layouts = getArenaLayout(n);
      expect(layouts.map((a) => a.defenses.length)).toEqual(expected[n]);
      const defenses = layouts.flatMap((a) => a.defenses);
      expect(new Set(defenses.map((d) => d.playerId)).size).toBe(
        n === 1 ? 2 : n,
      );
      for (const a of layouts)
        for (const d of a.defenses) {
          expect(d.end).toBeGreaterThan(d.start);
          expect(d.start).toBeGreaterThanOrEqual(0);
          expect(d.end).toBeLessThanOrEqual(
            d.side === "left" || d.side === "right" ? 600 : 800,
          );
        }
    });
  it("assigns classic, four-sided, and six-player layouts", () => {
    expect(getArenaLayout(2)[0].defenses.map((d) => d.side)).toEqual([
      "left",
      "right",
    ]);
    expect(getArenaLayout(4)[0].defenses.map((d) => d.side)).toEqual([
      "left",
      "right",
      "top",
      "bottom",
    ]);
    expect(getArenaLayout(6)[0].defenses.map((d) => d.side)).toEqual([
      "left",
      "right",
      "top",
      "top",
      "bottom",
      "bottom",
    ]);
  });
  it("assigns a split boundary to exactly one defender", () => {
    const a = getArenaLayout(6)[0];
    expect(goalOwner(a, "top", 399.99)).toBe("p3");
    expect(goalOwner(a, "top", 400)).toBe("p4");
    expect(goalOwner(a, "top", 800)).toBe("p4");
  });
  it.each([0, 13, 2.5, -1])("rejects invalid count %s", (n) =>
    expect(() => getArenaLayout(n)).toThrow(),
  );
});
describe("physics", () => {
  it("moves with velocity and delta time", () => {
    const a = arena();
    Object.assign(a.ball, { x: 400, y: 300, vx: 120, vy: -60 });
    advanceBall(a, [], 0.5);
    expect(a.ball.x).toBeCloseTo(460);
    expect(a.ball.y).toBeCloseTo(270);
  });
  it("bounces off an unassigned wall", () => {
    const a = arena();
    Object.assign(a.ball, { x: 400, y: 8, vx: 0, vy: -200 });
    expect(advanceBall(a, [], STEP)).toBeUndefined();
    expect(a.ball.vy).toBe(200);
    expect(a.ball.y).toBeGreaterThan(7);
  });
  it("sweeps fast collisions without tunneling", () => {
    const a = arena();
    const p = paddlesFor(a)[0];
    Object.assign(a.ball, { x: 200, y: 300, vx: -760, vy: 0 });
    expect(advanceBall(a, [p], 0.3)).toBeUndefined();
    expect(a.ball.vx).toBeGreaterThan(0);
    expect(a.ball.x).toBeGreaterThan(35);
  });
  it("concedes when paddle is missed", () => {
    const a = arena();
    Object.assign(a.ball, { x: 40, y: 100, vx: -300, vy: 0 });
    expect(advanceBall(a, paddlesFor(a), 0.2)).toBe("p1");
  });
  it("angles depend on impact position and speed is capped", () => {
    const a = arena();
    const p = paddlesFor(a)[0];
    Object.assign(a.ball, { vx: -750, vy: 0 });
    bounce(a.ball, p, p.position + p.length / 2);
    expect(a.ball.vx).toBeGreaterThan(0);
    expect(a.ball.vy).toBeGreaterThan(0);
    expect(Math.hypot(a.ball.vx, a.ball.vy)).toBeCloseTo(MAX_BALL_SPEED);
    bounce(a.ball, p, p.position);
    expect(a.ball.vy).toBeCloseTo(0);
  });
  it("confines paddle movement to its section", () => {
    const p = paddlesFor(getArenaLayout(6)[0])[2];
    movePaddle(p, 1, 100);
    expect(p.position).toBe(p.end - p.length / 2);
    movePaddle(p, -1, 100);
    expect(p.position).toBe(p.start + p.length / 2);
  });
  it("uses the correct inward normals on every paddle side", () => {
    for (const p of paddlesFor(getArenaLayout(4)[0])) {
      const b = arena().ball;
      bounce(b, p, p.position);
      expect(
        p.side === "left"
          ? b.vx > 0
          : p.side === "right"
            ? b.vx < 0
            : p.side === "top"
              ? b.vy > 0
              : b.vy < 0,
      ).toBe(true);
    }
  });
});
describe("survival engine", () => {
  it("has independent balls and preserves lives after a goal", () => {
    const e = new GameEngine(players(12), "multiplayer");
    expect(e.state.arenas).toHaveLength(2);
    forceGoal(e, 0, "p1");
    e.step();
    expect(e.state.players[0].lives).toBe(4);
    expect(e.state.arenas[0].countdown).toBe(1);
    expect(e.state.players[6].lives).toBe(5);
  });
  it("compacts survivors and preserves lives", () => {
    const e = new GameEngine(players(4), "multiplayer");
    e.state.players[0].lives = 1;
    e.state.players[1].lives = 3;
    forceGoal(e, 0, "p1");
    e.step();
    expect(e.state.paddles.map((p) => p.playerId)).toEqual(["p2", "p3", "p4"]);
    expect(e.state.players[1].lives).toBe(3);
    expect(e.state.revision).toBe(2);
  });
  it("merges at six humans and retains their lives", () => {
    const e = new GameEngine(players(7), "multiplayer");
    e.state.players[0].lives = 1;
    e.state.players[1].lives = 2;
    forceGoal(e, 0, "p1");
    e.step();
    expect(e.state.arenas).toHaveLength(1);
    expect(e.state.paddles).toHaveLength(6);
    expect(e.state.players[1].lives).toBe(2);
  });
  it("replaces disconnects while at least seven humans remain", () => {
    const e = new GameEngine(players(8), "multiplayer");
    e.disconnect("p1");
    expect(e.state.arenas).toHaveLength(2);
    expect(e.state.players[0].bot).toBe(true);
    expect(e.controllers.get("p1")).toBeInstanceOf(BotController);
  });
  it("removes replacement bots when merging after disconnect", () => {
    const e = new GameEngine(players(8), "multiplayer");
    e.disconnect("p1");
    e.disconnect("p2");
    expect(e.state.arenas).toHaveLength(1);
    expect(e.state.paddles).toHaveLength(6);
    expect(e.state.players.slice(0, 2).map((p) => p.lives)).toEqual([0, 0]);
  });
  it("retains replacements after merging", () => {
    const e = new GameEngine(players(4), "multiplayer");
    e.disconnect("p1");
    expect(e.state.players[0].lives).toBe(5);
    expect(e.state.paddles).toHaveLength(4);
  });
  it("pauses a lone survivor until merge", () => {
    const e = new GameEngine(players(12), "multiplayer");
    for (let i = 0; i < 5; i++) {
      e.state.players[i].lives = 1;
      forceGoal(e, 0, `p${i + 1}`);
      e.step();
    }
    expect(e.state.arenas[0].waiting).toBe(true);
    const b = structuredClone(e.state.arenas[0].ball);
    e.step();
    expect(e.state.arenas[0].ball).toEqual(b);
    expect(e.state.arenas).toHaveLength(2);
  });
  it("processes simultaneous goals in both arenas before merging", () => {
    const e = new GameEngine(players(8), "multiplayer");
    e.state.players[0].lives = 1;
    e.state.players[4].lives = 1;
    forceGoal(e, 0, "p1");
    forceGoal(e, 1, "p5");
    e.step();
    expect(e.state.players.filter((p) => p.lives > 0)).toHaveLength(6);
    expect(e.state.arenas).toHaveLength(1);
  });
  it("ends with one winner", () => {
    const e = new GameEngine(players(2), "multiplayer");
    e.state.players[0].lives = 1;
    forceGoal(e, 0, "p1");
    e.step();
    expect(e.state.phase).toBe("finished");
    expect(e.state.winner).toBe("p2");
  });
  it("limits solo to six competitors", () =>
    expect(() => new GameEngine(players(7), "solo")).toThrow());
  it("keeps snapshots independent", () => {
    const e = new GameEngine(players(2), "solo");
    const s = e.snapshot();
    s.players[0].lives = 0;
    expect(e.state.players[0].lives).toBe(5);
  });
  it("timestep accumulator is stable and bounds catch-up", () => {
    const loop = new FixedLoop();
    let count = 0;
    for (let i = 0; i < 120; i++) loop.advance(1 / 120, () => count++);
    expect(count).toBe(60);
    loop.advance(100, () => count++);
    expect(count).toBeLessThanOrEqual(69);
  });
  it("bots react imperfectly instead of instantly snapping", () => {
    const a = arena(),
      p = paddlesFor(a)[0];
    a.ball.vx = -200;
    a.ball.y = 500;
    const bot = new BotController("easy", () => 0.5);
    expect(bot.read({ time: 0, paddle: p, arena: a })).toBe(1);
    a.ball.y = 100;
    expect(bot.read({ time: 0.1, paddle: p, arena: a })).toBe(1);
    expect(bot.read({ time: 0.5, paddle: p, arena: a })).toBe(-1);
  });
  it("can run a six-player match to completion without invalid state", () => {
    const ps = players(6).map((p) => ({ ...p, bot: true, connected: false }));
    let seed = 42;
    const rng = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const e = new GameEngine(ps, "solo", "easy", rng);
    for (let i = 0; i < 60 * 600 && e.state.phase !== "finished"; i++) e.step();
    expect(e.state.phase).toBe("finished");
    expect(e.state.players.filter((p) => p.lives > 0)).toHaveLength(1);
  });
  it("remote controllers expose only direction", () => {
    const controller = new DirectionController();
    controller.direction = -1;
    expect(controller.read()).toBe(-1);
  });
});
