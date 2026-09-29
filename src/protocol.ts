import { type GameSnapshot, type Player, type Direction } from "./types";
export const VERSION = 1;
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function normalizeCode(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code) ? code : null;
}
export function generateCode(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  // Rejection sampling remains unbiased if the alphabet changes (currently 32 characters).
  let code = "";
  while (code.length < 6)
    for (const byte of random(new Uint8Array(12))) {
      if (byte < Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length)
        code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === 6) break;
    }
  return code;
}
export function inviteUrl(code: string, current: string): string {
  const url = new URL(current);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", code);
  return url.toString();
}
export function nextSlot(players: Player[]): number | null {
  for (let slot = 0; slot < 12; slot++)
    if (!players.some((p) => p.slot === slot)) return slot;
  return null;
}
export function cleanName(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 20) || "Player"
  );
}
export type Message =
  | { v: number; type: "hello"; name: string }
  | {
      v: number;
      type: "welcome";
      host: string;
      playerId: string;
      roster: Player[];
    }
  | { v: number; type: "lobby"; roster: Player[] }
  | { v: number; type: "input"; sequence: number; direction: Direction }
  | { v: number; type: "snapshot"; state: GameSnapshot }
  | {
      v: number;
      type: "reject";
      reason: "full" | "running" | "version" | "collision";
    }
  | { v: number; type: "host" }
  | { v: number; type: "ping" | "pong"; nonce: number };
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const num = (x: unknown, min: number, max: number) =>
  typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
const int = (x: unknown, min: number, max: number) =>
  num(x, min, max) && Number.isInteger(x);
const id = (x: unknown): x is string =>
  typeof x === "string" && x.length > 0 && x.length <= 80;
const side = (x: unknown) =>
  ["left", "right", "top", "bottom"].includes(x as string);
function player(x: unknown): x is Player {
  return (
    object(x) &&
    id(x.id) &&
    typeof x.name === "string" &&
    x.name.length <= 20 &&
    int(x.slot, 0, 11) &&
    int(x.lives, 0, 5) &&
    typeof x.bot === "boolean" &&
    typeof x.connected === "boolean"
  );
}
function roster(x: unknown): x is Player[] {
  return (
    Array.isArray(x) &&
    x.length >= 1 &&
    x.length <= 12 &&
    x.every(player) &&
    new Set(x.map((p) => p.id)).size === x.length &&
    new Set(x.map((p) => p.slot)).size === x.length
  );
}
export function validSnapshot(x: unknown): x is GameSnapshot {
  if (
    !object(x) ||
    !int(x.revision, 0, 1e9) ||
    !int(x.tick, 0, 1e12) ||
    !num(x.time, 0, 1e12) ||
    !["playing", "finished"].includes(x.phase as string) ||
    !roster(x.players)
  )
    return false;
  if (
    x.winner !== null &&
    (!id(x.winner) || !x.players.some((p) => p.id === x.winner))
  )
    return false;
  if (
    !Array.isArray(x.arenas) ||
    x.arenas.length < 1 ||
    x.arenas.length > 2 ||
    !Array.isArray(x.paddles) ||
    x.paddles.length > 12
  )
    return false;
  const playerIds = new Set(x.players.map((p) => p.id));
  const defense = (d: unknown): d is Record<string, unknown> =>
    object(d) &&
    id(d.playerId) &&
    playerIds.has(d.playerId) &&
    side(d.side) &&
    num(d.start, 0, 800) &&
    num(d.end, 0, 800) &&
    Number(d.end) > Number(d.start);
  for (const a of x.arenas) {
    if (
      !object(a) ||
      !int(a.id, 0, 1) ||
      a.width !== 800 ||
      a.height !== 600 ||
      !num(a.countdown, 0, 3) ||
      typeof a.waiting !== "boolean" ||
      !Array.isArray(a.defenses) ||
      a.defenses.length < 1 ||
      a.defenses.length > 6 ||
      !a.defenses.every(defense)
    )
      return false;
    const b = a.ball;
    if (
      !object(b) ||
      !id(b.id) ||
      b.arenaId !== a.id ||
      !num(b.x, -10, 810) ||
      !num(b.y, -10, 610) ||
      !num(b.vx, -800, 800) ||
      !num(b.vy, -800, 800) ||
      b.radius !== 7
    )
      return false;
  }
  if (new Set(x.arenas.map((a) => a.id)).size !== x.arenas.length) return false;
  for (const p of x.paddles)
    if (
      !defense(p) ||
      !id(p.id) ||
      !int(p.arenaId, 0, 1) ||
      !num(p.position, 0, 800) ||
      !num(p.length, 1, 200) ||
      !x.arenas.some(
        (a) =>
          a.id === p.arenaId &&
          a.defenses.some(
            (d: { playerId: string }) => d.playerId === p.playerId,
          ),
      )
    )
      return false;
  return new Set(x.paddles.map((p) => p.playerId)).size === x.paddles.length;
}
export function parseMessage(x: unknown): Message | null {
  if (!object(x) || x.v !== VERSION) return null;
  switch (x.type) {
    case "hello":
      return typeof x.name === "string" && x.name.length <= 80
        ? (x as Message)
        : null;
    case "welcome":
      return id(x.host) &&
        id(x.playerId) &&
        roster(x.roster) &&
        x.roster.some((p) => p.id === x.playerId)
        ? (x as Message)
        : null;
    case "lobby":
      return roster(x.roster) ? (x as Message) : null;
    case "input":
      return int(x.sequence, 0, 1e12) &&
        [-1, 0, 1].includes(x.direction as number)
        ? (x as Message)
        : null;
    case "snapshot":
      return validSnapshot(x.state) ? (x as Message) : null;
    case "reject":
      return ["full", "running", "version", "collision"].includes(
        x.reason as string,
      )
        ? (x as Message)
        : null;
    case "host":
      return x as Message;
    case "ping":
    case "pong":
      return int(x.nonce, 0, 1e12) ? (x as Message) : null;
    default:
      return null;
  }
}
