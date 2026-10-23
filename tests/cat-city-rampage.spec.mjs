import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const gamePath = "/projects/cat-city-rampage/";

async function waitForAnimationFrames(page, frameCount = 6) {
  await page.evaluate(
    (count) => new Promise((resolve) => {
      function nextFrame(framesLeft) {
        if (framesLeft === 0) {
          resolve();
          return;
        }

        requestAnimationFrame(() => nextFrame(framesLeft - 1));
      }

      nextFrame(count);
    }),
    frameCount
  );
}

async function state(page) {
  return page.evaluate(() => {
    const game = window.__catCityRampage;
    return {
      running: game.game.running,
      won: game.game.won,
      bricks: game.bricks.length,
      players: game.players.map((player) => ({
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        onGround: player.onGround,
        smashed: player.smashed,
        keys: { ...player.keys }
      }))
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(gamePath);
});

test("keyboard movement uses elapsed time and reset clears held input", async ({ page }) => {
  const start = await state(page);

  await page.keyboard.down("d");
  await expect.poll(async () => (await state(page)).players[0].x).toBeGreaterThan(start.players[0].x + 8);

  await page.getByRole("button", { name: "Play Again" }).click();
  const reset = await state(page);
  expect(reset.players[0].x).toBe(130);
  expect(reset.players[0].keys.right).toBe(false);

  await waitForAnimationFrames(page);
  expect((await state(page)).players[0].x).toBe(130);
  await page.keyboard.up("d");
});

test("touch controls move the selected cat and release on cancellation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(gamePath);

  const blueLeft = page.getByRole("button", { name: "Blue Cat move left" });
  const redRight = page.getByRole("button", { name: "Red Cat move right" });
  const start = await state(page);

  await blueLeft.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch" });
  await expect.poll(async () => (await state(page)).players[1].x).toBeLessThan(start.players[1].x - 8);
  await blueLeft.dispatchEvent("pointercancel", { pointerId: 1, pointerType: "touch" });
  const afterCancel = await state(page);
  expect(afterCancel.players[1].keys.left).toBe(false);

  await redRight.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch" });
  await expect.poll(async () => (await state(page)).players[0].x).toBeGreaterThan(start.players[0].x + 8);
  await redRight.dispatchEvent("pointerup", { pointerId: 2, pointerType: "touch" });

  const bodyWidth = await page.locator("body").evaluate((body) => body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(390);
});

test("smashing removes nearby bricks once per press", async ({ page }) => {
  await page.evaluate(() => {
    const game = window.__catCityRampage;
    const player = game.players[0];
    const target = game.bricks.find((brick) => brick.y === 520);
    player.x = target.x;
    player.y = target.y - player.height;
    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
  });

  const before = await state(page);
  await page.keyboard.down(" ");
  await expect.poll(async () => (await state(page)).bricks).toBeLessThan(before.bricks);
  const afterFirstPress = await state(page);
  await waitForAnimationFrames(page, 4);
  expect((await state(page)).players[0].smashed).toBe(afterFirstPress.players[0].smashed);
  await page.keyboard.up(" ");
});

test("reaching the yarn ends the round and focuses replay", async ({ page }) => {
  await page.evaluate(() => {
    const game = window.__catCityRampage;
    const player = game.players[0];
    player.x = 400;
    player.y = 40;
    player.vx = 0;
    player.vy = 0;
  });

  await expect.poll(async () => (await state(page)).won).toBe(1);
  await expect(page.locator("#statusText")).toHaveText("Player 1 grabbed the yarn!");
  await expect(page.getByRole("button", { name: "Play Again" })).toBeFocused();
});

test.describe("phone and accessibility", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const buttonNames = [
    "Red Cat move left",
    "Red Cat jump",
    "Red Cat move right",
    "Red Cat smash bricks",
    "Blue Cat move left",
    "Blue Cat jump",
    "Blue Cat move right",
    "Blue Cat smash bricks"
  ];

  test("phone layout keeps the canvas and both pads in view", async ({ page }) => {
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const boxes = [{ name: "canvas", box: await page.locator("#gameCanvas").boundingBox() }];
    for (const name of buttonNames) {
      boxes.push({ name, box: await page.getByRole("button", { name }).boundingBox() });
    }

    for (const { name, box } of boxes) {
      expect(box, name).not.toBeNull();
      expect(box.y, `${name} top`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(844);
      expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(390);
      if (name !== "canvas") {
        expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44);
        expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44);
      }
    }

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });

  test("real touch holds move each cat and release on lift", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);

    async function hold(name) {
      const box = await page.getByRole("button", { name }).boundingBox();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await page.waitForTimeout(400);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    const start = await state(page);

    await hold("Blue Cat move left");
    const afterBlue = await state(page);
    expect(afterBlue.players[1].x).toBeLessThan(start.players[1].x - 8);
    expect(afterBlue.players[1].keys.left).toBe(false);

    await hold("Red Cat move right");
    const afterRed = await state(page);
    expect(afterRed.players[0].x).toBeGreaterThan(start.players[0].x + 8);
    expect(afterRed.players[0].keys.right).toBe(false);
  });

  test("reduced motion: no button transitions, game still plays", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();

    const durations = await page.evaluate(() => [
      getComputedStyle(document.querySelector("#resetButton")).transitionDuration,
      getComputedStyle(document.querySelector(".touch-pad button")).transitionDuration
    ]);
    expect(durations).toEqual(["0s", "0s"]);

    const start = await state(page);
    await page.keyboard.down("d");
    await page.waitForTimeout(300);
    await page.keyboard.up("d");
    expect((await state(page)).players[0].x).toBeGreaterThan(start.players[0].x);
  });
});

test.describe("shelf and work-in-progress", () => {
  test("the landing shelf does not list Cat City Rampage", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-project-count]")).toHaveText(/projects? ready/);
    await expect(page.locator('[data-project-grid] a[href*="cat-city-rampage"]')).toHaveCount(0);
    expect(await page.locator('[data-project-grid] a[href*="haunted-maze"]').count()).toBeGreaterThanOrEqual(1);

    const indexPath = new URL("../projects/index.json", import.meta.url);
    const index = JSON.parse(await readFile(indexPath, "utf8"));
    const entries = Array.isArray(index) ? index : index.projects;
    const entry = entries.find((project) => JSON.stringify(project).includes("cat-city-rampage"));
    expect(entry).toBeTruthy();
    expect(entry.shelf).toBe(false);
  });

  test("the game page says it is a work in progress", async ({ page }) => {
    await expect(page.getByText("Work in progress: this game is still being built.")).toBeVisible();
  });
});
