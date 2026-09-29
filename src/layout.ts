import {
  type ArenaLayout,
  type Defense,
  type Player,
  type Side,
  type Paddle,
} from "./types";
export const WIDTH = 800,
  HEIGHT = 600;
// Order is part of the rules: left, right, top sections, bottom sections.
export function arenaFor(ids: string[], id = 0): ArenaLayout {
  if (ids.length < 1 || ids.length > 6)
    throw new RangeError("An arena supports 1–6 survivors");
  const defenses: Defense[] = [];
  const add = (
    side: Side,
    index: number,
    start = 0,
    end = side === "left" || side === "right" ? HEIGHT : WIDTH,
  ) => {
    if (ids[index]) defenses.push({ playerId: ids[index], side, start, end });
  };
  add("left", 0);
  add("right", 1);
  if (ids.length <= 4) {
    add("top", 2);
    add("bottom", 3);
  } else {
    add("top", 2, 0, WIDTH / 2);
    add("top", 3, WIDTH / 2, WIDTH);
    if (ids.length === 5) add("bottom", 4);
    else {
      add("bottom", 4, 0, WIDTH / 2);
      add("bottom", 5, WIDTH / 2, WIDTH);
    }
  }
  return { id, width: WIDTH, height: HEIGHT, defenses };
}
export function getArenaLayout(playerCount: number): ArenaLayout[] {
  if (!Number.isInteger(playerCount) || playerCount < 1 || playerCount > 12)
    throw new RangeError("Choose 1–12 players");
  const ids = Array.from(
    { length: playerCount === 1 ? 2 : playerCount },
    (_, i) => `p${i + 1}`,
  );
  if (ids.length <= 6) return [arenaFor(ids)];
  const first = Math.ceil(ids.length / 2);
  return [arenaFor(ids.slice(0, first), 0), arenaFor(ids.slice(first), 1)];
}
export function layoutsForPlayers(players: Player[]): ArenaLayout[] {
  const layouts = getArenaLayout(players.length);
  return layouts.map((a) => ({
    ...a,
    defenses: a.defenses.map((d) => ({
      ...d,
      playerId: players[Number(d.playerId.slice(1)) - 1].id,
    })),
  }));
}
export function paddlesFor(layout: ArenaLayout): Paddle[] {
  return layout.defenses.map((d) => ({
    ...d,
    id: d.playerId,
    arenaId: layout.id,
    position: (d.start + d.end) / 2,
    length: Math.min(104, (d.end - d.start) * 0.3),
  }));
}
export function goalOwner(
  arena: ArenaLayout,
  side: Side,
  position: number,
): string | undefined {
  const extent =
    side === "left" || side === "right" ? arena.height : arena.width;
  const coordinate = Math.max(0, Math.min(extent, position));
  return arena.defenses.find(
    (d) =>
      d.side === side &&
      coordinate >= d.start &&
      (coordinate < d.end || (coordinate === extent && d.end === extent)),
  )?.playerId;
}
