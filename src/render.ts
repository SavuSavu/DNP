import {
  type GameSnapshot,
  type ArenaState,
  type Paddle,
  COLORS,
  INSET,
  THICKNESS,
  isVertical,
} from "./types";
export class Renderer {
  private context: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable");
    this.context = context;
  }
  draw(state: GameSnapshot, localId: string) {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(bounds.width * ratio)),
      height = Math.max(1, Math.round(bounds.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.context;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    const split = state.arenas.length === 2,
      vertical = split && bounds.width < 760;
    const cellWidth = split && !vertical ? bounds.width / 2 : bounds.width;
    const cellHeight = split && vertical ? bounds.height / 2 : bounds.height;
    for (let i = 0; i < state.arenas.length; i++) {
      const a = state.arenas[i];
      const scale = Math.min(
        (cellWidth - 24) / a.width,
        (cellHeight - 24) / a.height,
      );
      const x =
        (split && !vertical ? i * cellWidth : 0) +
        (cellWidth - a.width * scale) / 2;
      const y =
        (vertical ? i * cellHeight : 0) + (cellHeight - a.height * scale) / 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      this.arena(a, state, localId);
      ctx.restore();
    }
  }
  private arena(arena: ArenaState, state: GameSnapshot, localId: string) {
    const c = this.context,
      w = arena.width,
      h = arena.height;
    c.fillStyle = "#0b1220";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "#172638";
    c.lineWidth = 1;
    for (let x = 40; x < w; x += 40) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = 40; y < h; y += 40) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.strokeStyle = "#344459";
    c.lineWidth = 3;
    c.strokeRect(0, 0, w, h);
    c.setLineDash([6, 12]);
    c.strokeStyle = "#25384a";
    c.beginPath();
    c.moveTo(w / 2, 0);
    c.lineTo(w / 2, h);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(w / 2, h / 2, 62, 0, Math.PI * 2);
    c.stroke();
    for (const defense of arena.defenses) {
      const player = state.players.find((p) => p.id === defense.playerId)!;
      const color = COLORS[player.slot];
      c.strokeStyle = color + "77";
      c.lineWidth = 5;
      c.beginPath();
      if (defense.side === "left" || defense.side === "right") {
        const x = defense.side === "left" ? 0 : w;
        c.moveTo(x, defense.start);
        c.lineTo(x, defense.end);
      } else {
        const y = defense.side === "top" ? 0 : h;
        c.moveTo(defense.start, y);
        c.lineTo(defense.end, y);
      }
      c.stroke();
      c.fillStyle = color;
      c.font = "600 16px system-ui";
      c.textAlign = "center";
      const mid = (defense.start + defense.end) / 2;
      const text = `${player.id === localId ? "YOU · " : ""}${player.name} ${"♥".repeat(player.lives)}`;
      if (isVertical(defense.side)) {
        c.save();
        c.translate(defense.side === "left" ? 48 : w - 48, mid);
        c.rotate(defense.side === "left" ? -Math.PI / 2 : Math.PI / 2);
        c.fillText(text, 0, 0);
        c.restore();
      } else c.fillText(text, mid, defense.side === "top" ? 53 : h - 43);
    }
    for (const p of state.paddles.filter((p) => p.arenaId === arena.id))
      this.paddle(
        p,
        COLORS[state.players.find((player) => player.id === p.playerId)!.slot],
      );
    const b = arena.ball;
    c.shadowColor = "#ffffff";
    c.shadowBlur = 18;
    c.fillStyle = "#fff";
    c.beginPath();
    c.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    if (arena.countdown > 0 || arena.waiting) {
      c.fillStyle = "#0b1220b0";
      c.fillRect(w / 2 - 210, h / 2 - 70, 420, 140);
      c.textAlign = "center";
      c.fillStyle = "#eef7ff";
      c.font = "700 46px system-ui";
      c.fillText(
        arena.waiting ? "SURVIVOR" : String(Math.ceil(arena.countdown)),
        w / 2,
        h / 2 + 12,
      );
      c.font = "16px system-ui";
      c.fillStyle = "#9aaabc";
      c.fillText(
        arena.waiting ? "Waiting for the arenas to merge" : "Get ready",
        w / 2,
        h / 2 + 45,
      );
    }
  }
  private paddle(p: Paddle, color: string) {
    const c = this.context;
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 16;
    if (isVertical(p.side))
      c.fillRect(
        (p.side === "left" ? INSET : 800 - INSET) - THICKNESS / 2,
        p.position - p.length / 2,
        THICKNESS,
        p.length,
      );
    else
      c.fillRect(
        p.position - p.length / 2,
        (p.side === "top" ? INSET : 600 - INSET) - THICKNESS / 2,
        p.length,
        THICKNESS,
      );
    c.shadowBlur = 0;
  }
}
