import { describe, it, expect } from "vitest";
import {
  generateCode,
  normalizeCode,
  inviteUrl,
  nextSlot,
  parseMessage,
  validSnapshot,
  cleanName,
  CODE_ALPHABET,
} from "../src/protocol";
import { interpolate, SnapshotBuffer } from "../src/interpolation";
import { GameEngine } from "../src/engine";
import { type Player } from "../src/types";
const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    slot: i,
    lives: 5,
    bot: false,
    connected: true,
  }));
const state = () => new GameEngine(players(2), "multiplayer").snapshot();
describe("codes and slots", () => {
  it("generates valid random six-character codes", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode()));
    expect(codes.size).toBe(1000);
    for (const code of codes) expect(normalizeCode(code)).toBe(code);
  });
  it("normalizes input and rejects ambiguous or invalid codes", () => {
    expect(normalizeCode(" k7p4xz ")).toBe("K7P4XZ");
    for (const s of ["ABC12", "ABC123", "OOOOOO", "<x>", "ABCDEFG", ""])
      expect(normalizeCode(s)).toBeNull();
  });
  it("maps random bytes without modulo bias", () => {
    expect(256 % CODE_ALPHABET.length).toBe(0);
    expect(
      generateCode((b) => {
        b.fill(255);
        return b;
      }),
    ).toBe(CODE_ALPHABET.at(-1)!.repeat(6));
  });
  it("preserves deployment path in invitations", () =>
    expect(
      inviteUrl("K7P4XZ", "https://savusavu.github.io/DNP/?old=1#hash"),
    ).toBe("https://savusavu.github.io/DNP/?room=K7P4XZ"));
  it("assigns earliest vacant slot and rejects full rooms", () => {
    expect(nextSlot(players(12))).toBeNull();
    expect(nextSlot(players(4).filter((p) => p.slot !== 1))).toBe(1);
  });
  it("bounds and cleans display names", () => {
    expect(cleanName("\u0000 Bob\n")).toBe("Bob");
    expect(cleanName(" ")).toBe("Player");
    expect(cleanName("x".repeat(80))).toHaveLength(20);
  });
});
describe("protocol", () => {
  it("accepts valid input", () =>
    expect(
      parseMessage({ v: 1, type: "input", sequence: 1, direction: -1 }),
    ).not.toBeNull());
  it.each([
    { v: 2, type: "hello", name: "a" },
    { v: 1, type: "input", sequence: -1, direction: 0 },
    { v: 1, type: "input", sequence: 1, direction: 8 },
    { v: 1, type: "input", sequence: NaN, direction: 0 },
    { v: 1, type: "teleport", x: 0 },
    null,
  ])("rejects malformed packets %s", (p) => expect(parseMessage(p)).toBeNull());
  it("accepts host snapshots and validates deep numeric data", () => {
    const s = state();
    expect(validSnapshot(s)).toBe(true);
    s.arenas[0].ball.x = Infinity;
    expect(validSnapshot(s)).toBe(false);
  });
  it("rejects oversized and duplicate rosters", () => {
    const p = players(2);
    p[1].slot = 0;
    expect(parseMessage({ v: 1, type: "lobby", roster: p })).toBeNull();
    expect(
      parseMessage({ v: 1, type: "lobby", roster: players(13) }),
    ).toBeNull();
  });
  it("rejects fabricated paddle IDs", () => {
    const s = state();
    s.paddles[0].playerId = "intruder";
    expect(validSnapshot(s)).toBe(false);
  });
});
describe("interpolation", () => {
  it("interpolates matching positions by time", () => {
    const a = state(),
      b = structuredClone(a);
    a.time = 0;
    b.time = 1;
    a.arenas[0].countdown = b.arenas[0].countdown = 0;
    b.paddles[0].position = 400;
    b.arenas[0].ball.x = 600;
    const s = interpolate(a, b, 0.5);
    expect(s.paddles[0].position).toBe(350);
    expect(s.arenas[0].ball.x).toBe(500);
    expect(b.arenas[0].ball.x).toBe(600);
  });
  it("does not animate across layouts or serves", () => {
    const a = state(),
      b = structuredClone(a);
    b.revision++;
    b.paddles[0].position = 400;
    expect(interpolate(a, b, 0.5).paddles[0].position).toBe(400);
  });
  it("buffers 100ms behind and discards stale frames", () => {
    const b = new SnapshotBuffer(),
      a = state(),
      s = structuredClone(a);
    a.time = 1;
    a.tick = 60;
    s.time = 1.2;
    s.tick = 72;
    s.paddles[0].position = 500;
    b.push(a, 1000);
    b.push(s, 1200);
    b.push(a, 1300);
    expect(b.sample(1200)!.paddles[0].position).toBeCloseTo(400);
    expect(b.sample(2000)!.paddles[0].position).toBe(500);
  });
  it("clears revision history and handles missing snapshots", () => {
    const b = new SnapshotBuffer();
    expect(b.sample(0)).toBeNull();
    const a = state();
    b.push(a, 0);
    const s = structuredClone(a);
    s.tick++;
    s.revision++;
    s.paddles[0].position = 400;
    b.push(s, 10);
    expect(b.sample(10)!.paddles[0].position).toBe(400);
    b.clear();
    expect(b.sample(0)).toBeNull();
  });
});

it("accepts a final phase or layout change at the same simulation tick", () => {
  const buffer = new SnapshotBuffer(),
    a = state();
  buffer.push(a, 0);
  const final = structuredClone(a);
  final.phase = "finished";
  final.winner = final.players[0].id;
  buffer.push(final, 20);
  expect(buffer.sample(20)!.phase).toBe("finished");
});
