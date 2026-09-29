import { describe, it, expect } from "vitest";
import {
  RoomSession,
  type Transport,
  type SessionEvents,
} from "../src/network";
import { GameEngine } from "../src/engine";
function rig() {
  let time = 0;
  const messages: { data: unknown; peer?: string }[] = [];
  let lost: string | null = null,
    error = "",
    input: { id: string; direction: number } | null = null,
    snapshot = false;
  const events: SessionEvents = {
    lobby: () => {},
    snapshot: () => {
      snapshot = true;
    },
    input: (id, direction) => {
      input = { id, direction };
    },
    disconnected: (id) => {
      lost = id;
    },
    error: (m) => {
      error = m;
    },
    ping: () => {},
  };
  const transport: Transport = {
    id: "host",
    send: (data, peer) => {
      messages.push({ data, peer });
    },
    onMessage: () => {},
    onJoin: () => {},
    onLeave: () => {},
    leave: () => {},
  };
  const host = new RoomSession(true, "Host", transport, events, () => time);
  return {
    host,
    transport,
    messages,
    events,
    clock: (t: number) => {
      time = t;
    },
    get lost() {
      return lost;
    },
    get error() {
      return error;
    },
    get input() {
      return input;
    },
    get snapshot() {
      return snapshot;
    },
  };
}
const hello = { v: 1, type: "hello", name: "Guest" };
describe("authoritative room", () => {
  it("assigns slots serially and rejects a thirteenth competitor", () => {
    const r = rig();
    for (let i = 1; i <= 12; i++) r.transport.onMessage(hello, `peer${i}`);
    expect(r.host.roster).toHaveLength(12);
    expect(new Set(r.host.roster.map((p) => p.slot)).size).toBe(12);
    expect(r.messages.at(-1)?.data).toMatchObject({
      type: "reject",
      reason: "full",
    });
  });
  it("host alone can start with at least two participants", () => {
    const r = rig();
    expect(r.host.start()).toBe(false);
    r.transport.onMessage(hello, "guest");
    expect(r.host.start()).toBe(true);
    expect(r.host.start()).toBe(false);
  });
  it("rejects joins and reclamation during a match", () => {
    const r = rig();
    r.transport.onMessage(hello, "guest");
    r.host.start();
    r.transport.onMessage(hello, "new");
    expect(r.messages.at(-1)?.data).toMatchObject({ reason: "running" });
  });
  it("ignores nonmembers, replayed input, and client physics", () => {
    const r = rig();
    r.transport.onMessage(hello, "guest");
    r.host.start();
    r.transport.onMessage(
      { v: 1, type: "input", sequence: 1, direction: 1 },
      "intruder",
    );
    expect(r.input).toBeNull();
    r.transport.onMessage(
      { v: 1, type: "input", sequence: 1, direction: 1 },
      "guest",
    );
    expect(r.input).toEqual({ id: "guest", direction: 1 });
    r.clock(100);
    r.transport.onMessage(
      { v: 1, type: "input", sequence: 1, direction: -1 },
      "guest",
    );
    expect(r.input?.direction).toBe(1);
    r.transport.onMessage(
      {
        v: 1,
        type: "snapshot",
        state: new GameEngine(r.host.roster, "multiplayer").snapshot(),
      },
      "guest",
    );
    expect(r.snapshot).toBe(false);
  });
  it("neutralizes stale input", () => {
    const r = rig();
    r.transport.onMessage(hello, "guest");
    r.host.start();
    r.transport.onMessage(
      { v: 1, type: "input", sequence: 0, direction: 1 },
      "guest",
    );
    r.clock(501);
    r.host.maintenance();
    expect(r.input?.direction).toBe(0);
  });
  it("removes lobby departures and reports active match departures", () => {
    const r = rig();
    r.transport.onMessage(hello, "guest");
    r.transport.onLeave("guest");
    expect(r.host.roster).toHaveLength(1);
    r.transport.onMessage(hello, "guest");
    r.host.start();
    r.transport.onLeave("guest");
    expect(r.lost).toBe("guest");
    expect(r.host.roster[1].bot).toBe(true);
    r.host.rematchLobby();
    expect(r.host.roster).toHaveLength(1);
  });
  it("binds clients to the admitting host and ignores other snapshots", () => {
    const r = rig();
    r.transport.id = "client";
    let accepted = 0;
    r.events.snapshot = () => {
      accepted++;
    };
    const client = new RoomSession(
      false,
      "Client",
      r.transport,
      r.events,
      () => 100,
    );
    const roster = [
      {
        id: "host",
        slot: 0,
        name: "Host",
        lives: 5,
        bot: false,
        connected: true,
      },
      {
        id: "client",
        slot: 1,
        name: "Client",
        lives: 5,
        bot: false,
        connected: true,
      },
    ];
    r.transport.onMessage(
      { v: 1, type: "welcome", host: "host", playerId: "client", roster },
      "host",
    );
    expect(client.hostId).toBe("host");
    const message = {
      v: 1,
      type: "snapshot",
      state: new GameEngine(roster, "multiplayer").snapshot(),
    };
    r.transport.onMessage(message, "intruder");
    expect(accepted).toBe(0);
    r.transport.onMessage(message, "host");
    expect(accepted).toBe(1);
    r.transport.onLeave("host");
    expect(r.error).toContain("host disconnected");
  });
  it("times out nonexistent rooms without creating a host", () => {
    const r = rig();
    r.transport.id = "client";
    new RoomSession(false, "Client", r.transport, r.events, () => 0);
    let t = 0;
    const client = new RoomSession(
      false,
      "Client",
      r.transport,
      r.events,
      () => t,
    );
    t = 20001;
    client.maintenance();
    expect(client.hostId).toBeNull();
    expect(r.error).toContain("Room unavailable");
  });
});

it("never sends to a transport after closing the session", () => {
  const r = rig();
  r.transport.onMessage(hello, "guest");
  r.host.start();
  const state = new GameEngine(r.host.roster, "multiplayer").snapshot();
  r.host.close();
  const count = r.messages.length;
  r.host.broadcastSnapshot(state);
  r.host.broadcastLobby();
  r.host.input(1);
  r.host.ping();
  expect(r.messages).toHaveLength(count);
  expect(r.host.start()).toBe(false);
});
