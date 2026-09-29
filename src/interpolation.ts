import { type GameSnapshot, clamp } from "./types";
export function interpolate(
  a: GameSnapshot,
  b: GameSnapshot,
  time: number,
): GameSnapshot {
  if (a.revision !== b.revision || a.phase !== b.phase)
    return structuredClone(b);
  const blend = clamp((time - a.time) / (b.time - a.time || 1), 0, 1);
  const result = structuredClone(b);
  for (const paddle of result.paddles) {
    const old = a.paddles.find((p) => p.id === paddle.id);
    if (old)
      paddle.position = old.position + (paddle.position - old.position) * blend;
  }
  for (const arena of result.arenas) {
    const old = a.arenas.find((ar) => ar.id === arena.id);
    // A serve is a discontinuity, never interpolate the ball across a goal.
    if (old && old.countdown === 0 && arena.countdown === 0) {
      arena.ball.x = old.ball.x + (arena.ball.x - old.ball.x) * blend;
      arena.ball.y = old.ball.y + (arena.ball.y - old.ball.y) * blend;
    }
  }
  return result;
}
export class SnapshotBuffer {
  private states: GameSnapshot[] = [];
  private received = 0;
  push(state: GameSnapshot, now: number) {
    const last = this.states.at(-1);
    if (
      last &&
      (state.tick < last.tick ||
        state.revision < last.revision ||
        (state.tick === last.tick &&
          state.revision === last.revision &&
          state.phase === last.phase))
    )
      return;
    if (
      last &&
      (state.revision !== last.revision || state.phase !== last.phase)
    )
      this.states = [];
    this.states.push(structuredClone(state));
    this.received = now;
    if (this.states.length > 12) this.states.shift();
  }
  sample(now: number): GameSnapshot | null {
    const latest = this.states.at(-1);
    if (!latest) return null;
    const target = latest.time + Math.max(0, now - this.received) / 1000 - 0.1;
    for (let i = 1; i < this.states.length; i++)
      if (this.states[i].time >= target)
        return interpolate(this.states[i - 1], this.states[i], target);
    return structuredClone(
      target < this.states[0].time ? this.states[0] : latest,
    );
  }
  clear() {
    this.states = [];
  }
}
