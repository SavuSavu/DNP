import { joinRoom, selfId } from "trystero";
import { type Direction, type Player, type GameSnapshot } from "./types";
import {
  type Message,
  VERSION,
  parseMessage,
  cleanName,
  nextSlot,
} from "./protocol";
type Payload = Message extends infer M
  ? M extends Message
    ? Omit<M, "v">
    : never
  : never;
export interface Transport {
  id: string;
  send(data: unknown, target?: string): void;
  onMessage: (data: unknown, peer: string) => void;
  onJoin: (peer: string) => void;
  onLeave: (peer: string) => void;
  leave(): void;
}
export function trysteroTransport(code: string): Transport {
  const room = joinRoom({ appId: "io.github.savusavu.dnp.v1" }, code);
  const action = room.makeAction<string>("dnp");
  const transport: Transport = {
    id: selfId,
    send: (data, target) => {
      void action
        .send(JSON.stringify(data), target ? { target } : undefined)
        .catch(() => {});
    },
    onMessage: () => {},
    onJoin: () => {},
    onLeave: () => {},
    leave: () => room.leave(),
  };
  action.onMessage = (data, { peerId }) => {
    if (data.length > 65536) return;
    try {
      transport.onMessage(JSON.parse(data), peerId);
    } catch {}
  };
  room.onPeerJoin = (peer) => transport.onJoin(peer);
  room.onPeerLeave = (peer) => transport.onLeave(peer);
  return transport;
}
export interface SessionEvents {
  lobby: (players: Player[]) => void;
  snapshot: (state: GameSnapshot) => void;
  input: (id: string, direction: Direction) => void;
  disconnected: (id: string) => void;
  error: (message: string) => void;
  ping: (milliseconds: number) => void;
}
const REASONS = {
  full: "This room is full (12 players).",
  running: "This match has already started. Join the next lobby.",
  version: "Game versions differ. Reload both browsers.",
  collision: "Another creator is using this code. Create a new room.",
};
export class RoomSession {
  readonly localId: string;
  roster: Player[] = [];
  hostId: string | null;
  playing = false;
  private sequence = 0;
  private sequences = new Map<string, number>();
  private lastInput = new Map<string, number>();
  private lastPacket = new Map<string, number>();
  private peers = new Set<string>();
  private pendingPings = new Map<number, number>();
  private nextNonce = 0;
  private lastHostPacket = 0;
  private joinedAt: number;
  private closed = false;
  constructor(
    readonly host: boolean,
    private name: string,
    private transport: Transport,
    private events: SessionEvents,
    private now = () => performance.now(),
  ) {
    this.localId = transport.id;
    this.hostId = host ? transport.id : null;
    this.joinedAt = now();
    if (host)
      this.roster = [
        {
          id: this.localId,
          name: cleanName(name),
          slot: 0,
          lives: 5,
          bot: false,
          connected: true,
        },
      ];
    transport.onJoin = (peer) => {
      this.peers.add(peer);
      if (host) this.send({ type: "host" }, peer);
      else this.send({ type: "hello", name }, peer);
    };
    transport.onMessage = (raw, peer) => this.receive(raw, peer);
    transport.onLeave = (peer) => this.depart(peer);
  }
  private send(message: Payload, peer?: string) {
    if (this.closed) return;
    this.transport.send({ v: VERSION, ...message }, peer);
  }
  private receive(raw: unknown, peer: string) {
    if (this.closed || peer === this.localId) return;
    const message = parseMessage(raw);
    if (!message) {
      if (
        this.host &&
        typeof raw === "object" &&
        raw !== null &&
        "type" in raw &&
        raw.type === "hello"
      )
        this.send({ type: "reject", reason: "version" }, peer);
      return;
    }
    if (this.host) {
      if (message.type === "host") {
        this.events.error(REASONS.collision);
        this.close();
        return;
      }
      if (message.type === "hello") {
        const existing = this.roster.find((p) => p.id === peer);
        if (existing && !this.playing) {
          this.welcome(peer);
          return;
        }
        if (this.playing) {
          this.send({ type: "reject", reason: "running" }, peer);
          return;
        }
        const slot = nextSlot(this.roster);
        if (slot === null) {
          this.send({ type: "reject", reason: "full" }, peer);
          return;
        }
        this.roster.push({
          id: peer,
          name: cleanName(message.name),
          slot,
          lives: 5,
          bot: false,
          connected: true,
        });
        this.welcome(peer);
        this.broadcastLobby();
        return;
      }
      if (!this.roster.some((p) => p.id === peer && p.connected)) return;
      if (message.type === "input" && this.playing) {
        const last = this.sequences.get(peer) ?? -1;
        const time = this.now();
        if (
          message.sequence <= last ||
          time - (this.lastPacket.get(peer) ?? -Infinity) < 8
        )
          return;
        this.sequences.set(peer, message.sequence);
        this.lastPacket.set(peer, time);
        this.lastInput.set(peer, time);
        this.events.input(peer, message.direction);
      } else if (message.type === "ping")
        this.send({ type: "pong", nonce: message.nonce }, peer);
      return;
    }
    if (!this.hostId) {
      if (message.type === "host")
        this.send({ type: "hello", name: this.name }, peer);
      if (message.type === "reject") {
        this.events.error(REASONS[message.reason]);
        this.close();
        return;
      }
      if (
        message.type !== "welcome" ||
        message.host !== peer ||
        message.playerId !== this.localId ||
        !message.roster.some((p) => p.id === peer && p.slot === 0)
      )
        return;
      this.hostId = peer;
    }
    if (peer !== this.hostId) return;
    this.lastHostPacket = this.now();
    if (message.type === "welcome" || message.type === "lobby") {
      this.playing = false;
      this.roster = structuredClone(message.roster);
      this.events.lobby(this.roster);
    } else if (message.type === "snapshot") {
      this.playing = true;
      this.events.snapshot(message.state);
    } else if (message.type === "pong") {
      const sent = this.pendingPings.get(message.nonce);
      if (sent !== undefined) {
        this.events.ping(Math.round(this.now() - sent));
        this.pendingPings.delete(message.nonce);
      }
    }
  }
  private welcome(peer: string) {
    this.send(
      {
        type: "welcome",
        host: this.localId,
        playerId: peer,
        roster: this.roster,
      },
      peer,
    );
  }
  broadcastLobby() {
    if (!this.host || this.closed) return;
    this.playing = false;
    this.send({ type: "lobby", roster: this.roster });
    this.events.lobby(this.roster);
  }
  start(): boolean {
    if (this.closed || !this.host || this.playing || this.roster.length < 2)
      return false;
    this.playing = true;
    this.sequences.clear();
    this.lastInput.clear();
    return true;
  }
  broadcastSnapshot(state: GameSnapshot) {
    if (!this.closed && this.host && this.playing)
      this.send({ type: "snapshot", state });
  }
  input(direction: Direction) {
    if (!this.host && this.hostId && this.playing)
      this.send(
        { type: "input", sequence: this.sequence++, direction },
        this.hostId,
      );
  }
  ping() {
    if (this.host || !this.hostId || this.closed) return;
    const nonce = ++this.nextNonce;
    this.pendingPings.set(nonce, this.now());
    for (const [key, time] of this.pendingPings)
      if (this.now() - time > 5000) this.pendingPings.delete(key);
    this.send({ type: "ping", nonce }, this.hostId);
  }
  maintenance() {
    if (this.closed) return;
    const time = this.now();
    if (!this.host && !this.hostId && time - this.joinedAt > 20000) {
      this.events.error(
        "Room unavailable or connection blocked. Check the code and retry.",
      );
      this.close();
    } else if (
      !this.host &&
      this.hostId &&
      time - this.lastHostPacket > 12000
    ) {
      this.events.error(
        "Host connection lost. Return to the menu to create or join a room.",
      );
      this.close();
    }
    if (this.host)
      for (const [id, last] of this.lastInput)
        if (time - last > 500) {
          this.events.input(id, 0);
          this.lastInput.delete(id);
        }
  }
  private depart(peer: string) {
    this.peers.delete(peer);
    if (this.closed) return;
    if (!this.host && peer === this.hostId) {
      this.events.error("The host disconnected. This session has ended.");
      this.close();
      return;
    }
    if (this.host) {
      const p = this.roster.find((p) => p.id === peer);
      if (!p) return;
      if (this.playing) {
        p.connected = false;
        p.bot = true;
        this.events.disconnected(peer);
      } else {
        this.roster = this.roster.filter((p) => p.id !== peer);
        this.broadcastLobby();
      }
    }
  }
  rematchLobby() {
    if (!this.host) return;
    this.roster = this.roster
      .filter((p) => p.connected)
      .map((p) => ({ ...p, bot: false, lives: 5 }));
    this.broadcastLobby();
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.playing = false;
    this.transport.leave();
  }
}
