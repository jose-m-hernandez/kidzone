import { expect, test } from "@playwright/test";

const URL = "/projects/cheeseworld/";
const KEY = "cheeseworld.levels.v1";
const PREFIX = "CHEESEWORLD_LEVEL ";

async function openGame(page) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__cheeseworldTest && window.__cheeseworldTest.validateLevel);
}

test.beforeEach(async ({ page }) => {
  await openGame(page);
});

// Click a canvas coordinate (0..800 by 0..500) with a real mouse click.
async function tapCanvas(page, cx, cy) {
  const info = await page.evaluate(() => {
    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left + canvas.clientLeft, top: rect.top + canvas.clientTop, scale: canvas.clientWidth / canvas.width };
  });
  await page.mouse.click(info.left + cx * info.scale, info.top + cy * info.scale);
}

const tool = (page, name) => page.locator(`[data-tool="${name}"]`).click();
const status = (page) => page.locator("#editorStatus");
const state = (page) => page.evaluate(() => window.__cheeseworldTest.state());

// Make a level: one plain platform, one cheese on the ground, one cat.
async function buildSmallLevel(page) {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "plain");
  await tapCanvas(page, 500, 300);
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await tool(page, "cat");
  await tapCanvas(page, 600, 430);
}

// A generated name: two capitalised words (the exact syllable check is in the name tests).
const NAME_RE = /^[A-Z][a-z]+ [A-Z][a-z]+$/;
const noName = ({ name, ...rest }) => rest;

function level(overrides = {}) {
  return {
    platforms: [{ type: "plain", x: 300, y: 340 }],
    cheeses: [{ x: 330, y: 310 }],
    enemies: [],
    bg: 0,
    ...overrides
  };
}

async function putSaved(page, levels, version = 1) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [KEY, typeof levels === "string" ? levels : JSON.stringify({ v: version, levels })]);
}

test("a saved level round-trips and plays", async ({ page }) => {
  await buildSmallLevel(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("Saved");
  await page.reload();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await expect(page.locator("#levelList li")).toHaveCount(1);
  await expect(page.locator("#levelList li .level-name").first()).toHaveText(NAME_RE);
  await page.locator("#levelList li").first().getByRole("button", { name: "Play" }).click();
  const before = await state(page);
  expect(before.game.mode).toBe("custom");
  expect(before.platforms).toHaveLength(2);
  expect(before.cheeses).toHaveLength(1);
  expect(before.enemies).toHaveLength(1);
  expect(before.platforms[0].y).toBe(460);
  expect([before.mouse.x, before.mouse.y]).toEqual([100, 435]);
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => window.__cheeseworldTest.step(400));
  await page.keyboard.up("ArrowRight");
  const after = await state(page);
  expect(after.cheeses[0].collected).toBe(true);
  expect(after.game.level).toBe(1);
  expect(after.platforms).toHaveLength(2);
  await expect(status(page)).toContainText("You got all the cheese");
});

test("all five platform types persist and reload with the right sizes", async ({ page }) => {
  await putSaved(page, [{
    platforms: [
      { x: 200, y: 380 },
      { type: "wheel", x: 400, y: 380 },
      { type: "books", x: 560, y: 370 },
      { type: "spring", x: 200, y: 300 },
      { type: "mover", x: 400, y: 250 }
    ],
    cheeses: [{ x: 700, y: 430 }],
    enemies: []
  }]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await page.locator("#levelList li").first().getByRole("button", { name: "Play" }).click();
  const { platforms } = await state(page);
  const sizes = await page.evaluate(() => window.__cheeseworldTest.PLATFORM_TYPES);
  expect(platforms).toHaveLength(6);
  expect(platforms.slice(1).map((p) => p.type)).toEqual(["plain", "wheel", "books", "spring", "mover"]);
  for (const p of platforms.slice(1)) {
    expect([p.width, p.height]).toEqual([sizes[p.type].width, sizes[p.type].height]);
  }
});

test.describe("corrupt saves", () => {
  test("a corrupt blob is ignored and the editor still saves", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await putSaved(page, "not json{");
    await page.getByRole("button", { name: "My levels" }).first().click();
    await expect(status(page)).toContainText("No levels yet. Make one!");
    await expect(page.locator("#levelList li")).toHaveCount(0);
    await page.getByRole("button", { name: "Back" }).click();
    await buildSmallLevel(page);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText("Saved");
    const blob = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
    expect(blob.v).toBe(1);
    expect(blob.levels).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test("bad entries are skipped and good ones are kept", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await putSaved(page, [level(), { platforms: "x" }, null, 7, level({ cheeses: [{ x: 500, y: 430 }] })]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await expect(page.locator("#levelList li")).toHaveCount(2);

    const bad = [
      level({ cheeses: [] }),
      level({ platforms: Array.from({ length: 21 }, (_, i) => ({ type: "plain", x: 10 + (i % 4) * 190, y: 120 + Math.floor(i / 4) * 30 })) }),
      level({ platforms: [{ type: "spring", x: 300, y: 380 }], enemies: [{ type: "cat", x: 300, p: 0 }] }),
      level({ platforms: [{ type: "plain", x: 80, y: 380 }] })
    ];
    await putSaved(page, [level(), ...bad, level({ cheeses: [{ x: 500, y: 430 }] })]);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await expect(page.locator("#levelList li")).toHaveCount(2);

    await putSaved(page, [level(), level()], 2);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await expect(page.locator("#levelList li")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("blocked storage does not stop the game or the editor", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Storage.prototype.getItem = () => { throw new Error("blocked"); };
      Storage.prototype.setItem = () => { throw new Error("blocked"); };
    });
    await openGame(page);
    await buildSmallLevel(page);
    await page.getByRole("button", { name: "Play" }).first().click();
    expect((await state(page)).game.mode).toBe("custom");
    await expect(page.locator("body")).toHaveAttribute("data-view", "play-custom");
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText("can't save");
    expect(errors).toEqual([]);
  });
});

test("a failed write leaves the saved list alone on Delete", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const two = [level(), level({ cheeses: [{ x: 500, y: 430 }] })];
  await putSaved(page, two);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await expect(page.locator("#levelList li")).toHaveCount(2);
  await page.evaluate(() => {
    window.__realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
  });
  const del =page.locator("#levelList li").first().getByRole("button", { name: "Delete" });
  await del.click();
  await del.click();
  await expect(status(page)).toContainText("can't save");
  await expect(page.locator("#levelList li")).toHaveCount(2);
  const blob = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(blob.levels).toEqual(two);

  // Storage works again: saving the second level must keep both slots.
  await page.evaluate(() => { Storage.prototype.setItem = window.__realSetItem; });
  await page.locator("#levelList li").nth(1).getByRole("button", { name: "Edit" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
  const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(after.levels).toHaveLength(2);
  expect(noName(after.levels[0])).toEqual(two[0]);
  expect(errors).toEqual([]);
});

test("validation and caps", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await page.getByRole("button", { name: "Play" }).first().click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
  await expect(status(page)).toContainText("Add some cheese first");

  await tool(page, "plain");
  await tapCanvas(page, 110, 400);
  await expect(status(page)).toContainText("Keep the start clear");
  expect((await state(page)).platforms).toHaveLength(1);

  const refused = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const list = [];
    for (let i = 0; i < 20; i++) {
      const placed = api.canPlace(list, { type: "plain", x: 10 + (i % 4) * 190, y: 120 + Math.floor(i / 4) * 30 });
      if (!placed.ok) return { i, message: placed.message };
      list.push(placed.platform);
    }
    return api.canPlace(list, { type: "plain", x: 10, y: 300 });
  });
  expect(refused.ok).toBe(false);
  expect(refused.message).toContain("20 platforms");

  await tool(page, "cat");
  await tapCanvas(page, 100, 430);
  expect((await state(page)).enemies[0].x).toBe(300);
});

test("a mushroom bounces the mouse and a plain platform does not", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const land = (type) => {
      api.loadCustomLevel({ platforms: [{ type, x: 300, y: 380 }], cheeses: [{ x: 700, y: 430 }], enemies: [] });
      api.placeMouse(320, 380 - 25 - 2, 2);
      api.step(1000 / 60);
      const { mouse } = api.state();
      return { velY: mouse.velY, onGround: mouse.onGround };
    };
    return { spring: land("spring"), plain: land("plain") };
  });
  expect(result.spring.velY).toBeLessThan(-14);
  expect(result.spring.onGround).toBe(false);
  expect(result.plain).toEqual({ velY: 0, onGround: true });
});

test("a sliding tray carries the mouse and stays in range", async ({ page }) => {
  await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.loadCustomLevel({ platforms: [{ type: "mover", x: 300, y: 300 }], cheeses: [{ x: 700, y: 430 }], enemies: [] });
    api.placeMouse(330, 275);
  });
  const before = await state(page);
  await page.evaluate(() => window.__cheeseworldTest.step(500));
  const after = await state(page);
  const trayMoved = after.platforms[1].x - before.platforms[1].x;
  const mouseMoved = after.mouse.x - before.mouse.x;
  expect(Math.abs(trayMoved)).toBeGreaterThanOrEqual(20);
  expect(Math.abs(trayMoved - mouseMoved)).toBeLessThanOrEqual(2);
  expect(after.mouse.y).toBe(275);
  const xs = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const seen = [];
    for (let i = 0; i < 20; i++) {
      api.step(500);
      seen.push(api.state().platforms[1].x);
    }
    return seen;
  });
  for (const x of xs) {
    expect(x).toBeGreaterThanOrEqual(240);
    expect(x).toBeLessThanOrEqual(360);
  }
});

test("a sliding tray stands still under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openGame(page);
  await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.loadCustomLevel({ platforms: [{ type: "mover", x: 300, y: 300 }], cheeses: [{ x: 700, y: 430 }], enemies: [] });
    api.step(500);
  });
  expect((await state(page)).platforms[1].x).toBe(300);
});

test("an unknown platform type becomes and is drawn as a plain platform", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const clean = api.validateLevel({ platforms: [{ type: "zzz", x: 300, y: 300 }], cheeses: [{ x: 100, y: 430 }], enemies: [] });
    api.loadCustomLevel(clean);
    const loaded = api.state().platforms[1];
    const ground = { x: 0, y: 460, width: 800, height: 40 };
    const ctx = document.getElementById("gameCanvas").getContext("2d");
    const pixels = (extra) => {
      api.setPlatforms([ground, { x: 300, y: 300, width: 140, height: 20, ...extra }]);
      api.render();
      return Array.from(ctx.getImageData(300, 300, 140, 20).data).join(",");
    };
    return { type: clean.platforms[0].type, size: [loaded.width, loaded.height], unknown: pixels({ type: "zzz" }), missing: pixels({}) };
  });
  expect(result.type).toBe("plain");
  expect(result.size).toEqual([140, 20]);
  expect(result.unknown).toBe(result.missing);
});

test("the seeded game is unchanged and its progress survives a trip to the editor", async ({ page }) => {
  const first = JSON.stringify((await state(page)).platforms);
  await page.getByRole("button", { name: "Make a level" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  expect(JSON.stringify((await state(page)).platforms)).toBe(first);

  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 20 && (await state(page)).game.score === 0; i++) {
    await page.evaluate(() => window.__cheeseworldTest.step(100));
  }
  await page.keyboard.up("ArrowRight");
  const progress = (await state(page)).game;
  expect(progress.score).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Play" }).first().click();
  expect((await state(page)).game.score).toBe(0);
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  const restored = (await state(page)).game;
  expect([restored.mode, restored.score, restored.level]).toEqual(["seeded", progress.score, progress.level]);
});

test("the editor fits and works at phone width", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Make a level" }).click();
  const buttons = page.locator("#editorTools button");
  expect(await buttons.count()).toBe(17);
  for (let i = 0; i < 17; i++) {
    const box = await buttons.nth(i).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(48);
    expect(box.height).toBeGreaterThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await tool(page, "plain");
  await tapCanvas(page, 400, 300);
  await tapCanvas(page, 790, 300);
  const { platforms } = await state(page);
  expect(platforms[1].x).toBeGreaterThanOrEqual(320);
  expect(platforms[1].x).toBeLessThanOrEqual(340);
  expect(platforms[2].x + 140).toBeLessThanOrEqual(792);
  expect(errors).toEqual([]);
});

test("a logged line loads back identically", async ({ page }) => {
  const lines = [];
  page.on("console", (message) => {
    if (message.text().startsWith(PREFIX)) lines.push(message.text());
  });
  await buildSmallLevel(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("Saved");
  expect(lines).toHaveLength(1);
  expect(lines[0]).not.toContain("\n");
  const logged = JSON.parse(lines[0].slice(PREFIX.length));
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).levels[0], KEY);
  expect(logged).toEqual(saved);
  // The numbers below are written out by hand: taps at (500,300), (200,440) and
  // (600,430) centre a 140x20 platform, a 25x20 cheese and a 50-wide cat.
  expect(logged.name).toMatch(NAME_RE);
  expect(noName(logged)).toEqual({
    platforms: [{ type: "plain", x: 430, y: 290 }],
    cheeses: [{ x: 188, y: 430 }],
    enemies: [{ type: "cat", x: 575, p: null }],
    bg: 0
  });
  const runtime = await page.evaluate((level) => {
    window.__cheeseworldTest.loadCustomLevel(level);
    const { platforms, cheeses, enemies } = window.__cheeseworldTest.state();
    return { platforms, cheeses, enemies };
  }, logged);
  expect(runtime).toEqual({
    platforms: [
      { x: 0, y: 460, width: 800, height: 40 },
      { type: "plain", x: 430, y: 290, width: 140, height: 20 }
    ],
    cheeses: [{ x: 188, y: 430, width: 25, height: 20, collected: false }],
    enemies: [{
      type: "cat", x: 575, y: 420, baseY: 420, width: 50, height: 40, originalHeight: 40,
      speed: 1, direction: 1, patrolMin: 300, patrolMax: 700, frameTime: 0, swingAngle: 0,
      flattened: false, flattenTimer: 0, velY: 0, jumping: false, agitated: false, platformY: 460
    }]
  });
  const expanded = await page.evaluate(([a, b]) => {
    const api = window.__cheeseworldTest;
    const shape = () => {
      const { platforms, cheeses, enemies } = api.state();
      return JSON.stringify({ platforms, cheeses, enemies });
    };
    api.loadCustomLevel(a);
    const fromLogged = shape();
    api.loadCustomLevel(b);
    return { same: fromLogged === shape(), again: api.validateLevel(a) };
  }, [logged, saved]);
  expect(expanded.same).toBe(true);
  expect(expanded.again).toEqual(logged);

  // An overwrite logs a second line and keeps one slot.
  await page.getByRole("button", { name: "Play" }).first().click();
  await page.getByRole("button", { name: "Edit" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 400, 440);
  await page.getByRole("button", { name: "Save" }).click();
  expect(lines).toHaveLength(2);
  const blob = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(blob.levels).toHaveLength(1);
  expect(JSON.parse(lines[1].slice(PREFIX.length))).toEqual(blob.levels[0]);
});

test("a logged line still appears when storage cannot write", async ({ page }) => {
  const lines = [];
  page.on("console", (message) => {
    if (message.text().startsWith(PREFIX)) lines.push(message.text());
  });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new Error("blocked"); };
  });
  await openGame(page);
  await buildSmallLevel(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("can't save");
  expect(lines).toHaveLength(1);
});

const FIXTURE_LEVEL = '{"platforms":[{"type":"plain","x":400,"y":340}],"cheeses":[{"x":150,"y":430}],"enemies":[]}';

async function serveDefaults(page, body) {
  await page.route("**/projects/cheeseworld/levels.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body })
  );
  await page.reload();
  await page.waitForFunction(() => window.__cheeseworldTest && window.__cheeseworldTest.validateLevel);
}

test("level 1 plays from the defaults file and level 2 is seeded", async ({ page }) => {
  await serveDefaults(page, `window.CHEESEWORLD_DEFAULT_LEVELS = [${FIXTURE_LEVEL}];`);
  const start = await state(page);
  expect(start.game.mode).toBe("seeded");
  expect(start.platforms).toHaveLength(2);
  expect(start.cheeses).toHaveLength(1);
  expect(start.game.level).toBe(1);
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => window.__cheeseworldTest.step(100));
  await page.keyboard.up("ArrowRight");
  const next = await state(page);
  expect(next.game.level).toBe(2);
  expect(next.game.score).toBe(10);
  expect(next.platforms).toHaveLength(8);
  expect(typeof next.platforms[1].reachableFrom).toBe("number");
  await expect(page.locator("#level")).toHaveText(await page.evaluate(() => window.__cheeseworldTest.seededLevelName(2)));
});

test("an invalid default falls back to the seed", async ({ page }) => {
  const errors = [];
  const warnings = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning") warnings.push(message.text());
  });
  await serveDefaults(page, `window.CHEESEWORLD_DEFAULT_LEVELS = [{"platforms":[],"cheeses":[],"enemies":[]}, ${FIXTURE_LEVEL}];`);
  const { platforms } = await state(page);
  const regenerated = await page.evaluate(() => {
    window.__cheeseworldTest.initLevel(1);
    return JSON.stringify(window.__cheeseworldTest.state().platforms);
  });
  expect(JSON.stringify(platforms)).toBe(regenerated);
  expect(typeof platforms[1].reachableFrom).toBe("number");
  expect(warnings.filter((text) => text.includes("default level 1"))).toHaveLength(1);
  await page.evaluate(() => window.__cheeseworldTest.startLevel(2));
  expect((await state(page)).platforms).toHaveLength(2);

  for (const body of ["window.CHEESEWORLD_DEFAULT_LEVELS = [];", ""]) {
    await serveDefaults(page, body);
    const seeded = await state(page);
    expect(seeded.platforms).toHaveLength(7);
    expect(typeof seeded.platforms[1].reachableFrom).toBe("number");
  }
  expect(errors).toEqual([]);
});

test("the keyboard still works after tapping editor buttons (no blur)", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 700, 440);
  await page.getByRole("button", { name: "Play" }).first().click();
  // Restart stays on screen in play, so a button can hold focus here.
  await page.getByRole("button", { name: "Restart" }).click();
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => window.__cheeseworldTest.step(300));
  await page.keyboard.up("ArrowRight");
  const moved = await state(page);
  expect(moved.mouse.x).toBeGreaterThan(100);
  await page.keyboard.down("Space");
  await page.evaluate(() => window.__cheeseworldTest.step(100));
  await page.keyboard.up("Space");
  const jumped = await state(page);
  expect(jumped.mouse.y).toBeLessThan(435);
  expect(jumped.mouse.x).toBeGreaterThan(100);
});

test("a platform and a cheese cannot cover each other", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 500, 300);
  await tool(page, "plain");
  await tapCanvas(page, 500, 310);
  await expect(status(page)).toContainText("That spot is taken");
  expect((await state(page)).platforms).toHaveLength(1);

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  await tool(page, "plain");
  await tapCanvas(page, 500, 300);
  const covered = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const plat = api.state().platforms[1];
    return { x: plat.x, y: plat.y };
  });
  await tool(page, "cheese");
  await tapCanvas(page, covered.x + 20, covered.y + 25);
  const after = await state(page);
  expect(after.platforms).toHaveLength(2);
  // the cheese snapped onto the top of the platform, which is fine
  expect(await page.evaluate(() => window.__cheeseworldTest.validateLevel({
    platforms: [{ type: "plain", x: 300, y: 300 }], cheeses: [{ x: 320, y: 270 }], enemies: []
  }) !== null)).toBe(true);
  const rejected = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    return {
      covered: api.validateLevel({ platforms: [{ type: "plain", x: 300, y: 300 }], cheeses: [{ x: 320, y: 305 }], enemies: [] }),
      refusedPlatform: api.canPlace([], { type: "plain", x: 300, y: 300 }, [{ x: 320, y: 305 }]).ok
    };
  });
  expect(rejected.covered).toBe(null);
  expect(rejected.refusedPlatform).toBe(false);
});

test("a draft comes back when Make a level is tapped again", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "plain");
  await tapCanvas(page, 500, 300);
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  const back = await state(page);
  expect(back.platforms).toHaveLength(2);
  expect(back.cheeses).toHaveLength(1);
  // Clear is still the way to start fresh
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("button", { name: "Clear" }).click();
  expect((await state(page)).platforms).toHaveLength(1);
});

async function placeCheeseAndSave(page) {
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Save" }).click();
}

test("Make a level after saving starts a second level", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await placeCheeseAndSave(page);
  await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  const fresh = await state(page);
  expect(fresh.cheeses).toHaveLength(0);
  expect(fresh.platforms).toHaveLength(1);
  await placeCheeseAndSave(page);
  await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
  expect(await storedLevels(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await expect(page.locator("#levelList li")).toHaveCount(2);
});

test("Make a level keeps a draft that has unsaved changes", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  expect((await state(page)).cheeses).toHaveLength(1);
});

test("Make a level after editing a saved level starts a fresh one", async ({ page }) => {
  await putSaved(page, [level()]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Edit").click();
  expect((await state(page)).cheeses).toHaveLength(1);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  const fresh = await state(page);
  expect(fresh.cheeses).toHaveLength(0);
  expect(fresh.platforms).toHaveLength(1);
});

test("Make a level asks before dropping an unsaved edit of a saved level", async ({ page }) => {
  await putSaved(page, [level()]);
  const before = await page.evaluate((key) => localStorage.getItem(key), KEY);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Edit").click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  await expect(status(page)).toHaveText("Tap Make a level again to drop your changes.");
  await expect(status(page)).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-view", "play-seeded");
  await page.getByRole("button", { name: "Make a level" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
  const fresh = await state(page);
  expect(fresh.cheeses).toHaveLength(0);
  expect(fresh.platforms).toHaveLength(1);
  await placeCheeseAndSave(page);
  await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
  const stored = await storedLevels(page);
  expect(stored).toHaveLength(2);
  expect(JSON.stringify(noName(stored[0]))).toBe(JSON.stringify(JSON.parse(before).levels[0]));
});

test("Make a level keeps an unsaved new level without a message", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  await expect(status(page)).not.toContainText("drop your changes");
  await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
  expect((await state(page)).cheeses).toHaveLength(1);
});

test("the cheese wheel is a 56 by 56 round platform the mouse can stand on", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "wheel");
  await tapCanvas(page, 200, 300);
  await tapCanvas(page, 500, 300);
  const { platforms } = await state(page);
  const wheels = platforms.filter((p) => p.type === "wheel");
  expect(wheels).toHaveLength(2);
  for (const w of wheels) expect([w.width, w.height]).toEqual([56, 56]);

  const result = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.loadCustomLevel({ platforms: [{ type: "wheel", x: 300, y: 380 }], cheeses: [{ x: 700, y: 430 }], enemies: [] });
    api.placeMouse(320, 380 - 25 - 2, 2);
    api.step(1000 / 60);
    const { mouse } = api.state();
    api.render();
    const ctx = document.getElementById("gameCanvas").getContext("2d");
    const px = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    return { velY: mouse.velY, onGround: mouse.onGround, corner: px(301, 381), shoulder: px(308, 388), centre: px(328, 408) };
  });
  // The shoulder is inside a rounded rectangle but outside a circle, so a square-ish wheel fails here.
  expect(result.shoulder).not.toEqual([242, 184, 36]);
  expect(result).toMatchObject({ velY: 0, onGround: true });
  expect(result.centre).toEqual([242, 184, 36]);
  expect(result.corner).not.toEqual([242, 184, 36]);
});

// The wheel is a circle to the mouse: centre (cx, cy), radius 28. These put one in open air or on the ground.
async function loadWheel(page, wheelY) {
  await page.evaluate((y) => {
    const api = window.__cheeseworldTest;
    api.loadCustomLevel({ platforms: [{ type: "wheel", x: 300, y: 300 }], cheeses: [{ x: 700, y: 430 }], enemies: [] });
    api.setPlatforms([
      { x: 0, y: 460, width: 800, height: 40 },
      { type: "wheel", x: 300, y, width: 56, height: 56 }
    ]);
  }, wheelY);
}

test("the mouse stands on the arc of a wheel, not on the top of its box", async ({ page }) => {
  await loadWheel(page, 300);
  const rows = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    return [0, 14, -14].map((dx) => {
      api.placeMouse(328 + dx - 15, 250, 0);
      api.step(1000);
      const { mouse } = api.state();
      return { dx, onGround: mouse.onGround, gap: mouse.y + mouse.height - (328 - Math.sqrt(28 * 28 - dx * dx)) };
    });
  });
  for (const row of rows) {
    expect(row.onGround, `dx ${row.dx}`).toBe(true);
    expect(Math.abs(row.gap), `dx ${row.dx}`).toBeLessThanOrEqual(2);
  }
});

test("walking off the middle of a wheel leaves it instead of hovering", async ({ page }) => {
  await loadWheel(page, 300);
  await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.placeMouse(328 - 15, 250, 0);
    api.step(500);
  });
  await page.keyboard.down("ArrowRight");
  const frames = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    const out = [];
    for (let i = 0; i < 40; i++) {
      api.step(1000 / 60);
      const { mouse } = api.state();
      out.push({ dx: mouse.x + 15 - 328, onGround: mouse.onGround, bottom: mouse.y + mouse.height });
    }
    return out;
  });
  await page.keyboard.up("ArrowRight");
  const past = frames.findIndex((f) => f.dx > 21);
  expect(past).toBeGreaterThan(0);
  expect(frames.slice(past, past + 5).some((f) => !f.onGround)).toBe(true);
  // Nothing walks along the flat top of the box: no frame past the edge of the standable arc has its feet at the box top.
  for (const f of frames.slice(past + 1, past + 8)) expect(Math.abs(f.bottom - 300)).toBeGreaterThan(2);
});

test("a mouse walking into a wheel stops at the circle, not at its box", async ({ page }) => {
  // The wheel's box bottom hangs 6 px into the mouse's head height; the circle is narrower there.
  await loadWheel(page, 385);
  await page.evaluate(() => window.__cheeseworldTest.placeMouse(200, 435, 0));
  await page.keyboard.down("ArrowRight");
  const result = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.step(1000);
    const { mouse } = api.state();
    const ey = Math.min(Math.max(413, mouse.y), mouse.y + mouse.height) - 413;
    return { gap: 328 - Math.sqrt(28 * 28 - ey * ey) - (mouse.x + mouse.width) };
  });
  await page.keyboard.up("ArrowRight");
  expect(Math.abs(result.gap)).toBeLessThanOrEqual(2);
});

test("jumping up into a wheel stops at its lower arc", async ({ page }) => {
  await loadWheel(page, 300);
  const rows = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    return [0, 35, -35].map((dx) => {
      api.placeMouse(328 + dx - 15, 386, -9);
      for (let i = 0; i < 40; i++) {
        api.step(1000 / 60);
        const { mouse } = api.state();
        if (mouse.velY === 0) {
          const ex = Math.max(0, Math.abs(dx) - 15);
          return { dx, stopped: true, gap: mouse.y - (328 + Math.sqrt(28 * 28 - ex * ex)) };
        }
      }
      return { dx, stopped: false };
    });
  });
  for (const row of rows) {
    expect(row.stopped, `dx ${row.dx}`).toBe(true);
    expect(Math.abs(row.gap), `dx ${row.dx}`).toBeLessThanOrEqual(2);
  }
});

test("saving keeps a level another tab saved in the meantime", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await putSaved(page, [level()]);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).levels.length, KEY);
  expect(stored).toBe(2);
});

// A level is saved and deleted by what it is, not by where it sits in the list.
const storedLevels = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).levels, KEY);
const rowButton = (page, row, name) => page.locator("#levelList li").nth(row).getByRole("button", { name });

async function deleteRow(page, row) {
  await rowButton(page, row, "Delete").click();
  await rowButton(page, row, "Delete").click();
}

test.describe("saving and deleting by identity", () => {
  const A = level();
  const B = level({ cheeses: [{ x: 500, y: 430 }] });

  test("deleting the level you edited, then saving, keeps the others", async ({ page }) => {
    await putSaved(page, [A, B]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 0, "Edit").click();
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await deleteRow(page, 0);
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Make a level" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
    expect((await storedLevels(page)).map(noName)).toEqual([B, A]);
  });

  test("a level deleted in another tab is not overwritten by a save", async ({ page, context }) => {
    await putSaved(page, [A, B]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 0, "Edit").click();
    const other = await context.newPage();
    await openGame(other);
    await other.getByRole("button", { name: "My levels" }).first().click();
    await deleteRow(other, 0);
    await expect(other.locator("#levelList li")).toHaveCount(1);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
    expect((await storedLevels(page)).map(noName)).toEqual([B, A]);
  });

  test("a delete from an old list does not wipe a level saved since", async ({ page, context }) => {
    await putSaved(page, [A, B]);
    const other = await context.newPage();
    await openGame(other);
    await other.getByRole("button", { name: "My levels" }).first().click();
    await expect(other.locator("#levelList li")).toHaveCount(2);
    await page.getByRole("button", { name: "Make a level" }).click();
    await tool(page, "cheese");
    await tapCanvas(page, 200, 440);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText(/Saved as [A-Z][a-z]+ [A-Z][a-z]+\./);
    const [, , added] = await storedLevels(page);
    await deleteRow(other, 0);
    expect((await storedLevels(page)).map(noName)).toEqual([B, noName(added)]);
  });

  test("deleting a level that is already gone says so", async ({ page, context }) => {
    await putSaved(page, [A, B]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    const other = await context.newPage();
    await openGame(other);
    await other.getByRole("button", { name: "My levels" }).first().click();
    await deleteRow(other, 0);
    await deleteRow(page, 0);
    await expect(status(page)).toContainText("That level is already gone.");
    await expect(page.locator("#levelList li")).toHaveCount(1);
    expect((await storedLevels(page)).map(noName)).toEqual([B]);
  });

  test("Edit does not silently drop a draft with unsaved changes", async ({ page }) => {
    await putSaved(page, [A]);
    await page.getByRole("button", { name: "Make a level" }).click();
    await tool(page, "cheese");
    await tapCanvas(page, 200, 440);
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 0, "Edit").click();
    await expect(status(page)).toContainText("Tap Edit again to drop the level you're making.");
    await expect(page.locator("body")).toHaveAttribute("data-view", "list");
    await rowButton(page, 0, "Edit").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
    expect((await state(page)).cheeses.map((c) => c.x)).toEqual([330]);

    // Edit during play asks too, when the draft is not the level on screen.
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("button", { name: "Clear" }).click();
    await tool(page, "cheese");
    await tapCanvas(page, 200, 440);
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 0, "Play").click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(status(page)).toContainText("Tap Edit again to drop the level you're making.");
    await expect(page.locator("body")).toHaveAttribute("data-view", "play-custom");
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
  });

  test("Edit opens at once when the draft is empty, saved, or the level being played", async ({ page }) => {
    await putSaved(page, [A, B]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 0, "Edit").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 1, "Edit").click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
    await page.getByRole("button", { name: "Play" }).first().click();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "edit");
  });
});

// The one status line stays on screen, so a refused Play or Save is never silent.
for (const [label, viewport, hasTouch] of [
  ["1280x800", { width: 1280, height: 800 }, false],
  ["390x844 with touch", { width: 390, height: 844 }, true]
]) {
  test.describe(`the status line is always in view at ${label}`, () => {
    test.use({ viewport, hasTouch });

    const press = (locator) => (hasTouch ? locator.tap() : locator.click());

    async function expectStatusInView(page, text) {
      await expect(status(page)).toContainText(text);
      const inside = await status(page).evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= innerHeight && box.height > 0;
      });
      expect(inside).toBe(true);
    }

    for (const name of ["Play", "Save"]) {
      test(`${name} on an empty draft shows why`, async ({ page }) => {
        await page.getByRole("button", { name: "Make a level" }).click();
        const button = page.locator(name === "Play" ? "#editorPlay" : "#editorSave");
        // Play or Save at the bottom edge of the screen, where the line used to fall below the fold.
        await button.evaluate((el) => el.scrollIntoView({ block: "end" }));
        await press(button);
        await expectStatusInView(page, "Add some cheese first.");
      });
    }

    test("a canvas tap message is in view at the top of the page", async ({ page }) => {
      await page.getByRole("button", { name: "Make a level" }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await tool(page, "plain");
      await page.evaluate(() => window.scrollTo(0, 0));
      await tapCanvas(page, 110, 400);
      await expectStatusInView(page, "Keep the start clear");
    });

    test("Play, Save, Clear and Done all take a real click with a message showing", async ({ page }) => {
      await page.getByRole("button", { name: "Make a level" }).click();
      await press(page.locator("#editorPlay"));
      await expectStatusInView(page, "Add some cheese first.");
      await press(page.locator("#editorSave"));
      await expectStatusInView(page, "Add some cheese first.");
      await press(page.locator("#editorClear"));
      await expectStatusInView(page, "Tap Clear again");
      await press(page.locator("#editorDone"));
      await expect(page.locator("body")).not.toHaveAttribute("data-view", "edit");
    });
  });
}

// Backgrounds. The sample is the canvas pixel at (100, 30): empty sky or wall in every scene,
// and a different colour in each. Fridge, Pantry, Garden, Night.
const SCENE_PIXEL = [100, 30];
const SCENE_RGB = [[229, 242, 247], [105, 77, 50], [115, 200, 240], [28, 36, 72]];
const SCENE_NAMES = ["Fridge", "Pantry", "Garden", "Night"];

async function scenePixel(page) {
  return page.evaluate(([x, y]) => {
    window.__cheeseworldTest.render();
    const data = document.getElementById("gameCanvas").getContext("2d").getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2]];
  }, SCENE_PIXEL);
}

test("the Background button cycles four scenes, and a saved one comes back", async ({ page }) => {
  await buildSmallLevel(page);
  expect(await scenePixel(page)).toEqual(SCENE_RGB[0]);
  for (const next of [1, 2, 3, 0]) {
    await page.getByRole("button", { name: "Background" }).click();
    await expect(status(page)).toContainText(`Background: ${SCENE_NAMES[next]}.`);
    expect(await scenePixel(page)).toEqual(SCENE_RGB[next]);
    expect((await state(page)).background).toBe(next);
  }
  await page.getByRole("button", { name: "Background" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("Saved");
  expect((await storedLevels(page))[0].bg).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  expect((await state(page)).background).toBe(1);
  expect(await scenePixel(page)).toEqual(SCENE_RGB[1]);
});

test("a save from before backgrounds loads and plays as the fridge", async ({ page }) => {
  const old = { platforms: [{ type: "plain", x: 300, y: 340 }], cheeses: [{ x: 330, y: 310 }], enemies: [] };
  await putSaved(page, [old]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  expect((await state(page)).background).toBe(0);
  expect(await scenePixel(page)).toEqual(SCENE_RGB[0]);
  const odd = await page.evaluate(() => [7, -1, 1.5, "2", null].map((bg) => window.__cheeseworldTest.validateLevel({
    platforms: [], cheeses: [{ x: 100, y: 430 }], enemies: [], bg
  }).bg));
  expect(odd).toEqual([0, 0, 0, 0, 0]);
});

test("seeded level 1 is the fridge, level 2 the pantry, and the scenes repeat", async ({ page }) => {
  expect((await state(page)).game.level).toBe(1);
  expect(await scenePixel(page)).toEqual(SCENE_RGB[0]);
  await page.evaluate(() => window.__cheeseworldTest.startLevel(2));
  expect(await scenePixel(page)).toEqual(SCENE_RGB[1]);
  await page.evaluate(() => window.__cheeseworldTest.startLevel(4));
  expect(await scenePixel(page)).toEqual(SCENE_RGB[3]);
  await page.evaluate(() => window.__cheeseworldTest.startLevel(5));
  expect(await scenePixel(page)).toEqual(SCENE_RGB[0]);
});

test("changing only the background of a saved level counts as an unsaved change", async ({ page }) => {
  await putSaved(page, [level()]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Edit").click();
  await page.getByRole("button", { name: "Background" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Make a level" }).click();
  await expect(status(page)).toHaveText("Tap Make a level again to drop your changes.");
});

// Drag to move, with a mouse at 1280x800 and with real touch events at 390x844.
async function canvasToPage(page, cx, cy) {
  const info = await page.evaluate(() => {
    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left + canvas.clientLeft, top: rect.top + canvas.clientTop, scale: canvas.clientWidth / canvas.width };
  });
  return { x: info.left + cx * info.scale, y: info.top + cy * info.scale };
}

async function dragCanvas(page, from, to, touch) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const a = await canvasToPage(page, ...from);
  const b = await canvasToPage(page, ...to);
  if (!touch) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await page.mouse.up();
    return;
  }
  const client = await page.context().newCDPSession(page);
  const send = (type, point) => client.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ x: point.x, y: point.y }] : [] });
  await send("touchStart", a);
  await send("touchMove", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  await send("touchMove", b);
  await send("touchEnd");
}

for (const [label, viewport, hasTouch] of [
  ["1280x800", { width: 1280, height: 800 }, false],
  ["390x844 with touch", { width: 390, height: 844 }, true]
]) {
  test.describe(`Move at ${label}`, () => {
    test.use({ viewport, hasTouch });

    // One plain platform at (430, 290) carrying a cat, and one cheese on the ground at (188, 430).
    async function buildMoveLevel(page) {
      // Clicking a tool button scrolls the page, so the canvas is brought back into view before each tap.
      const tapAt = async (x, y) => {
        await page.evaluate(() => window.scrollTo(0, 0));
        await tapCanvas(page, x, y);
      };
      await page.getByRole("button", { name: "Make a level" }).click();
      await tool(page, "plain");
      await tapAt(500, 300);
      await tool(page, "cat");
      await tapAt(560, 270);
      await tool(page, "cheese");
      await tapAt(200, 440);
      await tool(page, "move");
    }

    test("a cheese dragged onto a platform snaps to it, and Save keeps it", async ({ page }) => {
      await buildMoveLevel(page);
      await dragCanvas(page, [200, 440], [560, 275], hasTouch);
      const { cheeses } = await state(page);
      expect(cheeses).toHaveLength(1);
      expect(cheeses[0].y).toBe(260);
      // Dropped near the right end of the platform (430 to 570): kept on it, so x is at most 570 - 25.
      expect(cheeses[0].x).toBeGreaterThan(520);
      expect(cheeses[0].x).toBeLessThanOrEqual(545);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(status(page)).toContainText("Saved");
      const [stored] = await storedLevels(page);
      expect(stored.cheeses).toHaveLength(1);
      expect(stored.cheeses[0].y).toBe(260);
      expect(Math.abs(stored.cheeses[0].x - cheeses[0].x)).toBeLessThan(1);
    });

    test("a platform dragged away takes its enemy along, and the link is saved", async ({ page }) => {
      await buildMoveLevel(page);
      const before = await state(page);
      await dragCanvas(page, [440, 300], [240, 200], hasTouch);
      const after = await state(page);
      expect(after.platforms[1].x).toBe(before.platforms[1].x - 200);
      expect(after.platforms[1].y).toBe(before.platforms[1].y - 100);
      expect(after.enemies).toHaveLength(1);
      expect(after.enemies[0].x).toBe(before.enemies[0].x - 200);
      expect(after.enemies[0].y).toBe(after.platforms[1].y - 40);
      await page.getByRole("button", { name: "Save" }).click();
      const [stored] = await storedLevels(page);
      expect(stored.enemies).toEqual([{ type: "cat", x: before.enemies[0].x - 200, p: 0 }]);
    });

    test("a platform dropped on the start goes back and says why", async ({ page }) => {
      await buildMoveLevel(page);
      const before = await state(page);
      await dragCanvas(page, [440, 300], [110, 400], hasTouch);
      await expect(status(page)).toContainText("Keep the start clear.");
      const after = await state(page);
      expect(after.platforms).toEqual(before.platforms);
      expect(after.enemies).toEqual(before.enemies);
    });

    test("a press on empty canvas in Move mode changes nothing", async ({ page }) => {
      await buildMoveLevel(page);
      const before = await state(page);
      const message = await status(page).textContent();
      await dragCanvas(page, [700, 150], [300, 150], hasTouch);
      const after = await state(page);
      expect(after.platforms).toEqual(before.platforms);
      expect(after.cheeses).toEqual(before.cheeses);
      expect(after.enemies).toEqual(before.enemies);
      expect(await status(page).textContent()).toBe(message);
    });

    test("a move counts as an unsaved change", async ({ page }) => {
      await buildMoveLevel(page);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(status(page)).toContainText("Saved");
      await dragCanvas(page, [200, 440], [650, 430], hasTouch);
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "Make a level" }).click();
      await expect(status(page)).toHaveText("Tap Make a level again to drop your changes.");
    });
  });
}

test("with the Plain tool selected a tap still places a platform", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "plain");
  await tapCanvas(page, 500, 300);
  const { platforms } = await state(page);
  expect(platforms).toHaveLength(2);
  expect([platforms[1].x, platforms[1].y]).toEqual([430, 290]);
});

// The little white dog, the black cat and poop.
const GROUND_LEVEL = (type) => ({
  platforms: [],
  cheeses: [{ x: 700, y: 430 }],
  enemies: [{ type, x: 400, p: null }],
  bg: 0
});

const loadOnGround = (page, type) =>
  page.evaluate((shape) => window.__cheeseworldTest.loadCustomLevel(shape), GROUND_LEVEL(type));
const step = (page, ms) => page.evaluate((n) => window.__cheeseworldTest.step(n), ms);

test("a dog and a black cat are placed, saved, and come back with their types", async ({ page }) => {
  await page.getByRole("button", { name: "Make a level" }).click();
  const tapAt = async (x, y) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await tapCanvas(page, x, y);
  };
  await tool(page, "dog");
  await tapAt(450, 430);
  await tool(page, "blackcat");
  await tapAt(600, 430);
  await tool(page, "cheese");
  await tapAt(200, 440);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("Saved");
  expect((await storedLevels(page))[0].enemies.map((e) => e.type)).toEqual(["dog", "blackcat"]);
  await page.reload();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  const { enemies } = await state(page);
  expect(enemies.map((e) => e.type)).toEqual(["dog", "blackcat"]);
  expect([enemies[0].width, enemies[0].height]).toEqual([30, 24]);
  expect([enemies[1].width, enemies[1].height]).toEqual([50, 40]);
});

test("the enemy limit counts dogs and black cats", async ({ page }) => {
  const cap = await page.evaluate(() => window.__cheeseworldTest.validateLevel({
    platforms: [], cheeses: [{ x: 700, y: 430 }], bg: 0,
    enemies: Array.from({ length: 9 }, (_, i) => ({ type: i % 2 ? "dog" : "blackcat", x: 400, p: null }))
  }));
  expect(cap).toBeNull();
});

for (const type of ["blackcat", "dog"]) {
  test(`a ${type} costs cheese when it hits the mouse, and can be stomped`, async ({ page }) => {
    await loadOnGround(page, type);
    await page.evaluate(() => window.__cheeseworldTest.setScore(20));
    const first = (await state(page)).enemies[0];
    await page.evaluate((e) => window.__cheeseworldTest.placeMouse(e.x + 5, 435), first);
    await step(page, 17);
    const hit = await state(page);
    expect(hit.game.score).toBe(15);
    expect([hit.mouse.x, hit.mouse.y]).toEqual([100, 435]);

    await loadOnGround(page, type);
    const e = (await state(page)).enemies[0];
    await page.evaluate((enemy) => window.__cheeseworldTest.placeMouse(enemy.x + 2, enemy.y - 31, 6), e);
    await step(page, 17);
    const stomped = await state(page);
    expect(stomped.enemies[0].flattened).toBe(true);
    expect(stomped.game.score).toBe(25);
    expect(stomped.mouse.powerUp).toBe("speed");
  });
}

test("a dog drops poop every four seconds, keeps at most three, and poop hurts", async ({ page }) => {
  await loadOnGround(page, "dog");
  await step(page, 3900);
  expect((await state(page)).poops).toHaveLength(0);
  await step(page, 600);
  const one = (await state(page)).poops;
  expect(one).toHaveLength(1);
  expect([one[0].width, one[0].height, one[0].y]).toEqual([14, 10, 450]);
  await step(page, 8500);
  expect((await state(page)).poops.length).toBeLessThanOrEqual(3);
  await step(page, 8000);
  const many = (await state(page)).poops;
  expect(many).toHaveLength(3);
  expect(many).not.toContainEqual(one[0]);

  // Stomp the dog, wait until it is gone and the power-up has ended: the poop is still there.
  const dog = (await state(page)).enemies[0];
  await page.evaluate((e) => window.__cheeseworldTest.placeMouse(e.x + 2, e.y - 31, 6), dog);
  await step(page, 17);
  await step(page, 8000);
  const after = await state(page);
  expect(after.enemies).toHaveLength(0);
  expect(after.mouse.powerUp).toBeNull();
  expect(after.poops).toHaveLength(3);

  // Standing on a poop costs 5 cheese and sends the mouse back to the start.
  await page.evaluate((p) => {
    window.__cheeseworldTest.setScore(20);
    window.__cheeseworldTest.placeMouse(p.x - 5, 435);
  }, after.poops[0]);
  await step(page, 17);
  const hurt = await state(page);
  expect(hurt.game.score).toBe(15);
  expect([hurt.mouse.x, hurt.mouse.y]).toEqual([100, 435]);

  // With a power-up the mouse walks over it.
  await step(page, 1100);
  await page.evaluate((p) => {
    window.__cheeseworldTest.givePowerUp();
    window.__cheeseworldTest.setScore(20);
    window.__cheeseworldTest.placeMouse(p.x - 5, 435);
  }, after.poops[0]);
  await step(page, 17);
  const safe = await state(page);
  expect(safe.game.score).toBe(20);
  expect(safe.mouse.x).not.toBe(100);
});

test("poop clears on restart, on leaving to the editor and on a level change", async ({ page }) => {
  await putSaved(page, [GROUND_LEVEL("dog")]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  await step(page, 4500);
  expect((await state(page)).poops).toHaveLength(1);
  await page.getByRole("button", { name: "Restart" }).click();
  expect((await state(page)).poops).toHaveLength(0);
  await step(page, 4500);
  expect((await state(page)).poops).toHaveLength(1);
  await page.getByRole("button", { name: "Edit" }).click();
  expect((await state(page)).poops).toHaveLength(0);
  await page.getByRole("button", { name: "Play" }).first().click();
  await step(page, 4500);
  expect((await state(page)).poops).toHaveLength(1);
  await page.evaluate(() => window.__cheeseworldTest.startLevel(2));
  expect((await state(page)).poops).toHaveLength(0);
});

test("a save from before dogs and black cats still loads", async ({ page }) => {
  const old = {
    platforms: [{ type: "plain", x: 300, y: 340 }],
    cheeses: [{ x: 330, y: 310 }],
    enemies: [{ type: "cat", x: 330, p: 0 }]
  };
  await putSaved(page, [old]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  const { enemies, poops } = await state(page);
  expect(enemies.map((e) => e.type)).toEqual(["cat"]);
  expect(poops).toEqual([]);
});

// Level names: made up by the game, never typed.
const syllables = (page) => page.evaluate(() => window.__cheeseworldTest.NAME_SYLLABLES);
const strictName = async (page) => {
  const list = await syllables(page);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const word = `(?:${list.map(cap).join("|")})(?:${list.join("|")}){1,2}`;
  return new RegExp(`^${word} ${word}$`);
};

test("the same seed gives the same name, and level 1 keeps its name across reloads", async ({ page }) => {
  const [a, b, other] = await page.evaluate(() => {
    const t = window.__cheeseworldTest;
    return [t.levelName(t.seededRandom(7)), t.levelName(t.seededRandom(7)), t.levelName(t.seededRandom(8))];
  });
  expect(a).toBe(b);
  expect(a).not.toBe(other);
  const one = await page.evaluate(() => window.__cheeseworldTest.seededLevelName(1));
  const three = await page.evaluate(() => window.__cheeseworldTest.seededLevelName(3));
  expect(one).not.toBe(three);
  await expect(page.locator("#level")).toHaveText(one);
  await page.reload();
  await page.waitForFunction(() => window.__cheeseworldTest);
  await expect(page.locator("#level")).toHaveText(one);
  expect(await page.evaluate(() => window.__cheeseworldTest.seededLevelName(3))).toBe(three);
  expect(one).toMatch(await strictName(page));
});

test("a saved level gets a generated name that shows everywhere and survives a re-save", async ({ page }) => {
  const strict = await strictName(page);
  await buildSmallLevel(page);
  await page.getByRole("button", { name: "Save" }).click();
  const said = (await status(page).innerText()).match(/Saved as (.+?)\. /);
  expect(said).not.toBeNull();
  const name = said[1];
  expect(name).toMatch(strict);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await expect(page.locator("#levelList li .level-name").first()).toHaveText(name);
  // The delete arm uses the name.
  await rowButton(page, 0, "Delete").click();
  await expect(status(page)).toHaveText(`Tap Delete again to remove ${name}.`);
  // Play shows it in the HUD.
  await rowButton(page, 0, "Play").click();
  await expect(page.locator("#level")).toHaveText(name);
  // Edit and re-save: the same name.
  await page.getByRole("button", { name: "Edit" }).first().click();
  await tool(page, "cheese");
  await tapCanvas(page, 300, 440);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText(`Saved as ${name}.`);
  const stored = await storedLevels(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].name).toBe(name);
  expect(stored[0].cheeses).toHaveLength(2);
});

test("a stored name that is not a generated one is dropped and replaced", async ({ page }) => {
  const strict = await strictName(page);
  const keep = "Iruba Buku";
  expect(keep).toMatch(strict);
  const lists = [
    level({ name: "Bob" }),
    level({ name: "<b>x</b>", cheeses: [{ x: 500, y: 430 }] }),
    level({ name: keep, cheeses: [{ x: 600, y: 430 }] }),
    level({ name: 42, cheeses: [{ x: 650, y: 430 }] })
  ];
  await putSaved(page, lists);
  await page.getByRole("button", { name: "My levels" }).first().click();
  const rows = page.locator("#levelList li .level-name");
  await expect(rows).toHaveCount(4);
  const texts = await rows.allInnerTexts();
  texts.forEach((text) => expect(text).toMatch(strict));
  expect(texts).not.toContain("Bob");
  expect(texts[2]).toBe(keep);
  expect(await page.locator("#levelList b").count()).toBe(0);
  // The replacement is stable: the same level reads back with the same name.
  await page.reload();
  await page.getByRole("button", { name: "My levels" }).first().click();
  expect(await page.locator("#levelList li .level-name").allInnerTexts()).toEqual(texts);
  // And the validator itself drops it.
  const checked = await page.evaluate(
    (raw) => window.__cheeseworldTest.validateLevel(raw),
    level({ name: "<b>x</b>" })
  );
  expect(checked).not.toBeNull();
  expect("name" in checked).toBe(false);
});

test("a save from before names gets one, and keeps it from its next save", async ({ page }) => {
  const strict = await strictName(page);
  await putSaved(page, [level()]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  const name = await page.locator("#levelList li .level-name").first().innerText();
  expect(name).toMatch(strict);
  await page.reload();
  await page.getByRole("button", { name: "My levels" }).first().click();
  await expect(page.locator("#levelList li .level-name").first()).toHaveText(name);
  await rowButton(page, 0, "Edit").click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText(`Saved as ${name}.`);
  expect((await storedLevels(page))[0].name).toBe(name);
});

// Fragments a child should never see inside a made-up name. If one appears, change the
// syllable list in game.js, not this list.
const BLOCKED = [
  "poo", "pee", "kaka", "caca", "butt", "bum", "sex", "fart", "tit", "dik", "dick", "cum",
  "ass", "nig", "fag", "gay", "wee", "pis", "piss", "fuk", "fuc", "kill", "hate", "die",
  "dum", "dud", "bad", "mad", "sad", "dad", "mom", "mum", "pus", "zit", "wtf", "hell",
  "damn", "shit", "cock", "boob", "pen", "vag", "anal", "nazi", "kkk", "pot", "wank",
  "kuso", "baka", "yaro", "guro", "homo", "kuzu"
];

test("10,000 made-up names contain none of the blocked fragments", async ({ page }) => {
  const names = await page.evaluate(() => {
    const t = window.__cheeseworldTest;
    const out = [];
    for (let seed = 1; seed <= 10000; seed++) out.push(t.levelName(t.seededRandom(seed)));
    return out;
  });
  expect(names).toHaveLength(10000);
  const strict = await strictName(page);
  const hits = [];
  for (const name of names) {
    expect(name).toMatch(strict);
    const lower = name.toLowerCase();
    const joined = lower.replace(" ", "");
    for (const bad of BLOCKED) if (joined.includes(bad)) hits.push(`${name} has ${bad}`);
  }
  expect(hits.slice(0, 10)).toEqual([]);
  expect(new Set(names).size).toBeGreaterThan(9000);
});

// The sweep above samples; this one is every word the generator can make: each 2- and
// 3-syllable run of the list (20^2 + 20^3 = 8,400), repeats included, plus the seeded names.
test("every word the generator can make, and the seeded names, contain no blocked fragment", async ({ page }) => {
  const list = await syllables(page);
  expect(list).toHaveLength(20);
  const words = [];
  for (const a of list) {
    for (const b of list) {
      words.push(a + b);
      for (const c of list) words.push(a + b + c);
    }
  }
  expect(words).toHaveLength(8400);
  const hits = [];
  for (const word of words) {
    for (const bad of BLOCKED) if (word.toLowerCase().includes(bad)) hits.push(`${word} has ${bad}`);
  }
  expect(hits.slice(0, 10)).toEqual([]);
  const seeded = await page.evaluate(() => {
    const t = window.__cheeseworldTest;
    return Array.from({ length: 50 }, (_, i) => t.seededLevelName(i + 1));
  });
  expect(seeded).toHaveLength(50);
  const strict = await strictName(page);
  const seededHits = [];
  for (const name of seeded) {
    expect(name).toMatch(strict);
    const joined = name.toLowerCase().replace(" ", "");
    for (const bad of BLOCKED) if (joined.includes(bad)) seededHits.push(`${name} has ${bad}`);
  }
  expect(seededHits).toEqual([]);
});

test("a stored name made from the old syllable list is replaced on load", async ({ page }) => {
  const strict = await strictName(page);
  const old = "Bakaso Kuro";
  expect(old).not.toMatch(strict);
  await putSaved(page, [level({ name: old })]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  const text = await page.locator("#levelList li .level-name").first().innerText();
  expect(text).not.toBe(old);
  expect(text).toMatch(strict);
  const checked = await page.evaluate((raw) => window.__cheeseworldTest.validateLevel(raw), level({ name: old }));
  expect(checked).not.toBeNull();
  expect("name" in checked).toBe(false);
});

// Re-cut 10: follow-ups from play-testing.
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test.describe("two saved levels that look the same", () => {
  const A = level({ name: "Zokihi Yoguku" });
  const B = level({ name: "Zokihi Yokuku", cheeses: [{ x: 500, y: 430 }] });

  test("Edit on row 2 changes row 2 and leaves row 1", async ({ page }) => {
    await putSaved(page, [A, A]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await rowButton(page, 1, "Edit").click();
    await tool(page, "cheese");
    await tapCanvas(page, 200, 440);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText("Saved as");
    const stored = await storedLevels(page);
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual(A);
    expect(stored[1].cheeses).toHaveLength(2);
  });

  test("Delete on row 3 of [A, B, A] removes row 3", async ({ page }) => {
    await putSaved(page, [A, B, A]);
    await page.getByRole("button", { name: "My levels" }).first().click();
    await deleteRow(page, 2);
    expect(await storedLevels(page)).toEqual([A, B]);
  });
});

test.describe("leaving with unsaved work", () => {
  const beforeUnload = (page) =>
    page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return { defaultPrevented: event.defaultPrevented, returnValue: event.returnValue };
    });

  test("the browser is asked to warn only while there is an unsaved change", async ({ page }) => {
    expect((await beforeUnload(page)).defaultPrevented).toBe(false);
    await page.getByRole("button", { name: "Make a level" }).click();
    expect((await beforeUnload(page)).defaultPrevented).toBe(false);
    await tool(page, "cheese");
    await tapCanvas(page, 200, 440);
    expect((await beforeUnload(page)).defaultPrevented).toBe(true);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(status(page)).toContainText("Saved as");
    expect((await beforeUnload(page)).defaultPrevented).toBe(false);
  });
});

test("a message in the play view does not cover the canvas at phone landscape", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await putSaved(page, [level({ platforms: [], cheeses: [{ x: 200, y: 440 }] })]);
  await page.getByRole("button", { name: "My levels" }).first().click();
  await rowButton(page, 0, "Play").click();
  await page.keyboard.down("ArrowRight");
  await page.evaluate(() => window.__cheeseworldTest.step(400));
  await page.keyboard.up("ArrowRight");
  await expect(status(page)).toContainText("You got all the cheese");
  await expect(page.locator("body")).toHaveAttribute("data-view", "play-custom");
  // Look at the top of the page, where the canvas is.
  await page.evaluate(() => window.scrollTo(0, 0));
  const message = await status(page).boundingBox();
  const canvas = await page.locator("#gameCanvas").boundingBox();
  expect(overlaps(message, canvas)).toBe(false);
  const controls = page.locator(".touch-controls");
  if (await controls.isVisible()) expect(overlaps(message, await controls.boundingBox())).toBe(false);
});

test("Done is not covered by anything at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Make a level" }).click();
  await tool(page, "cheese");
  await tapCanvas(page, 200, 440);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(status(page)).toContainText("Saved as");
  await page.locator("#editorDone").scrollIntoViewIfNeeded();
  const done = await page.locator("#editorDone").boundingBox();
  const others = await page.locator("button, #editorStatus, canvas").evaluateAll((nodes) =>
    nodes
      .filter((n) => n.id !== "editorDone" && n.getClientRects().length > 0)
      .map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.id || n.textContent.trim(), x: r.x, y: r.y, width: r.width, height: r.height };
      })
  );
  expect(others.filter((o) => overlaps(done, o)).map((o) => o.id)).toEqual([]);
});

test("walking off the edge of a wheel moves no further sideways than a normal step", async ({ page }) => {
  await loadWheel(page, 300);
  await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    api.placeMouse(328 - 15, 250, 0);
    api.step(500);
  });
  await page.keyboard.down("ArrowRight");
  const result = await page.evaluate(() => {
    const api = window.__cheeseworldTest;
    let last = api.state().mouse.x;
    let widest = 0;
    for (let i = 0; i < 40; i++) {
      api.step(1000 / 60);
      const { mouse } = api.state();
      widest = Math.max(widest, Math.abs(mouse.x - last));
      last = mouse.x;
    }
    return { widest, speed: api.state().mouse.speed };
  });
  await page.keyboard.up("ArrowRight");
  expect(result.speed).toBe(5);
  expect(result.widest).toBeLessThanOrEqual(result.speed + 0.5);
});
