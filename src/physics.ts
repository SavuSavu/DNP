import {
  type ArenaState,
  type Ball,
  type Paddle,
  type Side,
  type Direction,
  clamp,
  isVertical,
  PADDLE_SPEED,
  INSET,
  THICKNESS,
  MAX_BALL_SPEED,
} from "./types";
import { goalOwner } from "./layout";
export function movePaddle(p: Paddle, direction: Direction, dt: number) {
  p.position = clamp(
    p.position + direction * PADDLE_SPEED * dt,
    p.start + p.length / 2,
    p.end - p.length / 2,
  );
}
export function bounce(ball: Ball, paddle: Paddle, impact: number) {
  const offset = clamp(
    (impact - paddle.position) / (paddle.length / 2 + ball.radius),
    -1,
    1,
  );
  const angle = (offset * Math.PI) / 3;
  const speed = Math.min(MAX_BALL_SPEED, Math.hypot(ball.vx, ball.vy) * 1.045);
  const normal = Math.cos(angle) * speed,
    tangent = Math.sin(angle) * speed;
  switch (paddle.side) {
    case "left":
      ball.vx = normal;
      ball.vy = tangent;
      break;
    case "right":
      ball.vx = -normal;
      ball.vy = tangent;
      break;
    case "top":
      ball.vy = normal;
      ball.vx = tangent;
      break;
    case "bottom":
      ball.vy = -normal;
      ball.vx = tangent;
      break;
  }
}
interface Hit {
  t: number;
  side: Side;
  paddle?: Paddle;
  impact: number;
}
// Continuous collision times against inward paddle faces and boundary planes.
export function advanceBall(
  arena: ArenaState,
  paddles: Paddle[],
  dt: number,
): string | undefined {
  const b = arena.ball;
  let remaining = dt;
  for (let iteration = 0; iteration < 12 && remaining > 1e-8; iteration++) {
    const hits: Hit[] = [];
    for (const side of ["left", "right", "top", "bottom"] as Side[]) {
      const vertical = isVertical(side);
      const velocity = vertical ? b.vx : b.vy;
      if (side === "left" || side === "top" ? velocity >= 0 : velocity <= 0)
        continue;
      const coordinate = vertical ? b.x : b.y;
      const extent = vertical ? arena.width : arena.height;
      const low = side === "left" || side === "top";
      const edge = low ? b.radius : extent - b.radius;
      const wallTime = (edge - coordinate) / velocity;
      if (wallTime >= -1e-8 && wallTime <= remaining)
        hits.push({
          t: Math.max(0, wallTime),
          side,
          impact:
            (vertical ? b.y : b.x) +
            (vertical ? b.vy : b.vx) * Math.max(0, wallTime),
        });
      const face = low
        ? INSET + THICKNESS / 2 + b.radius
        : extent - INSET - THICKNESS / 2 - b.radius;
      const t = (face - coordinate) / velocity;
      if (t < -1e-8 || t > remaining) continue;
      const impact =
        (vertical ? b.y : b.x) + (vertical ? b.vy : b.vx) * Math.max(0, t);
      for (const paddle of paddles)
        if (
          paddle.side === side &&
          Math.abs(impact - paddle.position) <= paddle.length / 2 + b.radius
        )
          hits.push({ t: Math.max(0, t), side, paddle, impact });
    }
    hits.sort((a, c) => a.t - c.t || Number(!!c.paddle) - Number(!!a.paddle));
    const hit = hits[0];
    if (!hit) {
      b.x += b.vx * remaining;
      b.y += b.vy * remaining;
      break;
    }
    b.x += b.vx * hit.t;
    b.y += b.vy * hit.t;
    remaining -= hit.t;
    if (hit.paddle) bounce(b, hit.paddle, hit.impact);
    else {
      const owner = goalOwner(arena, hit.side, hit.impact);
      if (owner) return owner;
      if (isVertical(hit.side)) b.vx *= -1;
      else b.vy *= -1;
    }
    // Nudge into the new direction to avoid repeated zero-time contacts.
    const speed = Math.hypot(b.vx, b.vy) || 1;
    b.x += (b.vx / speed) * 1e-5;
    b.y += (b.vy / speed) * 1e-5;
  }
}
