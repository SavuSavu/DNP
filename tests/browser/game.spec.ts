import { test, expect, type Page } from "@playwright/test";
async function setup(page: Page) {
  await page.goto("./");
  await page.evaluate(() => {
    const scope = window as unknown as {
      dnpTest: { setTransportFactory: (f: (code: string) => unknown) => void };
    };
    scope.dnpTest.setTransportFactory((code) => {
      const channel = new BroadcastChannel(`dnp-test-${code}`),
        id = crypto.randomUUID(),
        peers = new Set<string>();
      const transport = {
        id,
        onMessage: (_data: unknown, _peer: string) => {},
        onJoin: (_peer: string) => {},
        onLeave: (_peer: string) => {},
        send: (data: unknown, target?: string) =>
          channel.postMessage({ kind: "message", id, data, target }),
        leave: () => {
          clearInterval(timer);
          channel.postMessage({ kind: "leave", id });
          channel.close();
        },
      };
      channel.onmessage = ({ data }) => {
        if (data.id === id) return;
        if (data.kind === "presence") {
          if (!peers.has(data.id)) {
            peers.add(data.id);
            transport.onJoin(data.id);
            channel.postMessage({ kind: "presence", id });
          }
        } else if (
          data.kind === "message" &&
          (!data.target || data.target === id)
        )
          transport.onMessage(data.data, data.id);
        else if (data.kind === "leave") {
          peers.delete(data.id);
          transport.onLeave(data.id);
        }
      };
      const timer = setInterval(
        () => channel.postMessage({ kind: "presence", id }),
        100,
      );
      return transport;
    });
  });
}
test("solo keyboard, touch, diagnostics, and responsive canvas", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await page.locator("#name").fill("Ada");
  await page.locator("#bots").selectOption("5");
  await page.locator("#solo").click();
  await expect(page.locator("#game")).toBeVisible();
  await expect(page.locator(".score")).toHaveCount(6);
  await page.keyboard.down("s");
  await page.waitForTimeout(200);
  await page.keyboard.up("s");
  await page
    .locator("#positive")
    .dispatchEvent("pointerdown", { pointerId: 1 });
  await page.locator("#positive").dispatchEvent("pointerup", { pointerId: 1 });
  await page.locator("#debug-toggle").click();
  await expect(page.locator("#debug")).toContainText("LOCAL SIMULATION");
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.locator("#canvas").boundingBox())!.width).toBeLessThan(
    390,
  );
  await page.screenshot({
    path: "test-results/solo-mobile.png",
    fullPage: true,
  });
  await page.locator("#leave-game").click();
  await expect(page.locator("#menu")).toBeVisible();
  expect(errors).toEqual([]);
});
test("invalid codes and invite URL preserve deployment path", async ({
  page,
}) => {
  await page.goto("./?room=K7P4XZ");
  await expect(page.locator("#code")).toHaveValue("K7P4XZ");
  await page.locator("#notice-dismiss").click();
  await page.locator("#code").fill("BAD");
  await page.locator("#join").click();
  await expect(page.locator("#notice")).toContainText("six-character");
});
test("two browsers join, start, interpolate, and handle host departure", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage(),
    client = await context.newPage();
  const errors: string[] = [];
  for (const page of [host, client])
    page.on("pageerror", (e) => errors.push(e.message));
  await setup(host);
  await setup(client);
  await host.locator("#name").fill("Host");
  await host.locator("#create").click();
  await client.locator("#name").fill("<Guest>");
  await client
    .locator("#code")
    .fill(await host.locator("#room-code").innerText());
  await client.locator("#join").click();
  await expect(host.locator(".player-card")).toHaveCount(2);
  await expect(client.locator(".player-card")).toHaveCount(2);
  await expect(client.locator("#start")).toBeHidden();
  await host.locator("#start").click();
  await expect(client.locator("#game")).toBeVisible();
  await client.locator("#debug-toggle").click();
  await expect(client.locator("#debug")).toContainText("INTERPOLATED CLIENT");
  await client.keyboard.press("ArrowDown");
  await expect(client.locator("#ping")).toContainText("ms", { timeout: 5000 });
  await host.locator("#leave-game").click();
  await expect(client.locator("#notice")).toContainText("host disconnected");
  expect(errors).toEqual([]);
  await context.close();
});
test("guest disconnect becomes a bot in a single arena", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const host = await context.newPage(),
    client = await context.newPage();
  await setup(host);
  await setup(client);
  await host.locator("#create").click();
  await client
    .locator("#code")
    .fill(await host.locator("#room-code").innerText());
  await client.locator("#join").click();
  await expect(host.locator(".player-card")).toHaveCount(2);
  await host.locator("#start").click();
  await expect(client.locator("#game")).toBeVisible();
  await client.locator("#leave-game").click();
  await expect(host.locator("#scoreboard")).toContainText("[BOT]");
  await expect(host.locator("#game")).toBeVisible();
  await context.close();
});
test("12-player room, full handling, split arenas, and disconnect merge", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const context = await browser.newContext();
  const host = await context.newPage();
  await setup(host);
  await host.locator("#create").click();
  const code = await host.locator("#room-code").innerText();
  const guests: Page[] = [];
  for (let i = 0; i < 11; i++) {
    const p = await context.newPage();
    await setup(p);
    await p.locator("#code").fill(code);
    await p.locator("#join").click();
    guests.push(p);
    await expect(host.locator(".player-card")).toHaveCount(i + 2);
  }
  const extra = await context.newPage();
  await setup(extra);
  await extra.locator("#code").fill(code);
  await extra.locator("#join").click();
  await expect(extra.locator("#notice")).toContainText("room is full");
  await host.bringToFront();
  await host.locator("#start").click();
  await expect(guests[0].locator("#game")).toBeVisible();
  await host.locator("#debug-toggle").click();
  await expect(host.locator("#debug")).toContainText("arenas 2");
  for (const p of guests.slice(0, 6)) await p.locator("#leave-game").click();
  await expect(host.locator("#debug")).toContainText("arenas 1");
  await expect(host.locator(".score:not(.eliminated)")).toHaveCount(6);
  await context.close();
});
test("real Trystero discovery and WebRTC smoke", async ({ browser }) => {
  test.skip(
    !process.env.RUN_REAL_WEBRTC,
    "Opt-in check uses public signaling infrastructure",
  );
  test.setTimeout(45000);
  const context = await browser.newContext();
  const host = await context.newPage(),
    client = await context.newPage();
  await host.goto("./");
  await client.goto("./");
  await host.locator("#create").click();
  await client
    .locator("#code")
    .fill(await host.locator("#room-code").innerText());
  await client.locator("#join").click();
  await expect(host.locator(".player-card")).toHaveCount(2, { timeout: 25000 });
  await host.locator("#start").click();
  await expect(client.locator("#game")).toBeVisible();
  await expect(client.locator("#scoreboard .score")).toHaveCount(2);
  await context.close();
});
