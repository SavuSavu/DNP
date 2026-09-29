export type Direction = -1 | 0 | 1;
export type Side = "left" | "right" | "top" | "bottom";
export type Difficulty = "easy" | "medium" | "hard";
export interface Player {
  id: string;
  name: string;
  slot: number;
  lives: number;
  bot: boolean;
  connected: boolean;
}
export interface Defense {
  playerId: string;
  side: Side;
  start: number;
  end: number;
}
export interface Paddle extends Defense {
  id: string;
  arenaId: number;
  position: number;
  length: number;
}
export interface ArenaLayout {
  id: number;
  width: number;
  height: number;
  defenses: Defense[];
}
export interface Ball {
  id: string;
  arenaId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}
export interface ArenaState extends ArenaLayout {
  ball: Ball;
  countdown: number;
  waiting: boolean;
}
export interface GameSnapshot {
  revision: number;
  tick: number;
  time: number;
  phase: "playing" | "finished";
  players: Player[];
  paddles: Paddle[];
  arenas: ArenaState[];
  winner: string | null;
}
export interface ControllerContext {
  time: number;
  paddle: Paddle;
  arena: ArenaState;
}
export interface Controller {
  read(context: ControllerContext): Direction;
}
export const COLORS = [
  "#65fbd2",
  "#ff7899",
  "#af9bff",
  "#ffe581",
  "#66bfff",
  "#ffad74",
  "#f29cfa",
  "#91e991",
  "#f58c60",
  "#77dbff",
  "#d5c4ff",
  "#faf39b",
];
export const STEP = 1 / 60;
export const PADDLE_SPEED = 360;
export const BALL_SPEED = 290;
export const MAX_BALL_SPEED = 760;
export const INSET = 22;
export const THICKNESS = 12;
export const isVertical = (side: Side) => side === "left" || side === "right";
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
