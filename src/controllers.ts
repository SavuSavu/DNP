import {
  type Controller,
  type ControllerContext,
  type Direction,
  type Difficulty,
  isVertical,
  clamp,
} from "./types";
export class DirectionController implements Controller {
  direction: Direction = 0;
  read(): Direction {
    return this.direction;
  }
}
export class KeyboardController extends DirectionController {
  private keys = new Set<string>();
  private vertical = true;
  private touch: Direction = 0;
  private down = (e: KeyboardEvent) => {
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "s",
        "a",
        "d",
      ].includes(
        e.key.toLowerCase().startsWith("arrow") ? e.key : e.key.toLowerCase(),
      )
    ) {
      e.preventDefault();
      this.keys.add(e.key.toLowerCase());
    }
  };
  private up = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };
  private clear = () => {
    this.keys.clear();
    this.touch = 0;
  };
  constructor() {
    super();
    window.addEventListener("keydown", this.down);
    window.addEventListener("keyup", this.up);
    window.addEventListener("blur", this.clear);
  }
  setVertical(vertical: boolean) {
    this.vertical = vertical;
  }
  setTouch(direction: Direction) {
    this.touch = direction;
  }
  read(): Direction {
    const negative = this.vertical ? ["w", "arrowup"] : ["a", "arrowleft"];
    const positive = this.vertical ? ["s", "arrowdown"] : ["d", "arrowright"];
    return (
      this.touch ||
      ((Number(positive.some((k) => this.keys.has(k))) -
        Number(negative.some((k) => this.keys.has(k)))) as Direction)
    );
  }
  dispose() {
    window.removeEventListener("keydown", this.down);
    window.removeEventListener("keyup", this.up);
    window.removeEventListener("blur", this.clear);
  }
}
const PRESETS = {
  easy: { reaction: 0.32, error: 90, deadzone: 24 },
  medium: { reaction: 0.18, error: 48, deadzone: 12 },
  hard: { reaction: 0.09, error: 20, deadzone: 6 },
};
export class BotController implements Controller {
  private nextObservation = 0;
  private target = 0;
  constructor(
    private difficulty: Difficulty,
    private random = Math.random,
  ) {}
  read({ time, paddle, arena }: ControllerContext): Direction {
    const preset = PRESETS[this.difficulty];
    if (time >= this.nextObservation) {
      this.nextObservation = time + preset.reaction;
      const vertical = isVertical(paddle.side),
        ball = arena.ball;
      const toward =
        paddle.side === "left"
          ? ball.vx < 0
          : paddle.side === "right"
            ? ball.vx > 0
            : paddle.side === "top"
              ? ball.vy < 0
              : ball.vy > 0;
      this.target = clamp(
        (toward
          ? vertical
            ? ball.y
            : ball.x
          : (paddle.start + paddle.end) / 2) +
          (this.random() * 2 - 1) * preset.error,
        paddle.start,
        paddle.end,
      );
    }
    const difference = this.target - paddle.position;
    return Math.abs(difference) <= preset.deadzone
      ? 0
      : difference < 0
        ? -1
        : 1;
  }
}
