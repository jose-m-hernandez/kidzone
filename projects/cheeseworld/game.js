// Cheeseworld - A cheese-collecting platformer

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score');
const levelDisplay = document.getElementById('level');
const powerUpDisplay = document.getElementById('powerUpDisplay');
const touchControls = document.querySelectorAll('[data-control]');

// Game state
const game = {
    score: 0,
    level: 1,
    gravity: 0.5,
    running: true,
    seed: 1,
    damageCooldown: 0,
    mode: 'seeded'
};

const STEP_MS = 1000 / 60;
const POWER_UP_MS = 5000;
const DAMAGE_COOLDOWN_MS = 1000;
const FLATTENED_MS = 1000;
const SPAWN = { x: 100, y: 435 };
const SPAWN_CLEAR = { x: 60, y: 360, w: 110, h: 100 };
const SPRING_BOUNCE = 16;
const MOVER_RANGE = 60;
const MOVER_SPEED = 1;
const LEVEL_LOG_PREFIX = 'CHEESEWORLD_LEVEL ';
const LIMITS = { platforms: 20, cheeses: 30, enemies: 8, levels: 12 };
// Level objects. Missing or unknown platform types are drawn and built as plain.
const PLATFORM_TYPES = {
    plain: { label: 'Plain', width: 140, height: 20 },
    wheel: { label: 'Cheese wheel', width: 56, height: 56 },
    books: { label: 'Book stack', width: 90, height: 50 },
    spring: { label: 'Mushroom', width: 70, height: 30 },
    mover: { label: 'Sliding tray', width: 120, height: 20 }
};
// Backgrounds a level can have, by number. 0 is the fridge the game shipped with.
const BACKGROUNDS = ['Fridge', 'Pantry', 'Garden', 'Night'];
const ENEMY_TYPES = {
    cat: { width: 50, height: 40, speed: 1 },
    oldman: { width: 35, height: 55, speed: 1.5 },
    blackcat: { width: 50, height: 40, speed: 1 },
    dog: { width: 30, height: 24, speed: 1.3 }
};
// A dog leaves poop behind as it walks: one every POOP_EVERY_MS, at most POOP_MAX of its own at a time.
const POOP_EVERY_MS = 4000;
const POOP_MAX = 3;
const POOP_SIZE = { width: 14, height: 10 };
// Reduced motion keeps the sliding tray still, so it is just a slab to stand on.
const moverSpeed = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : MOVER_SPEED;

// Which scene is drawn behind the level (an index into BACKGROUNDS)
let background = 0;

// Mouse player
const mouse = {
    x: 100,
    y: 300,
    width: 30,
    height: 25,
    velX: 0,
    velY: 0,
    speed: 5,
    jumpForce: 14,
    onGround: false,
    direction: 1, // 1 = right, -1 = left
    powerUp: null,
    powerUpTimer: 0
};

// Input handling
const keys = {
    left: false,
    right: false,
    jump: false
};

// Platforms
let platforms = [];

// Cheese collectibles
let cheeses = [];

// Enemies
let enemies = [];

// Poop dropped by dogs while a level is on screen (never stored in a level)
let poops = [];

function seededRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

function levelSeed(levelNum) {
    return (game.seed + Math.imul(levelNum, 2654435761)) >>> 0;
}

// Level names: two made-up words, built only from this list. Nothing a child types is ever a name.
const NAME_SYLLABLES = ['i', 'ru', 'ba', 'bu', 'zo', 'hi', 'gu', 'po', 'fi', 'ju',
    'ku', 'lu', 'yo', 'wa', 'ze', 'se', 've', 'ho', 'he', 'ki'];

function capitalise(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// A saved name is kept only if it matches this: two capitalised words of 2-3 listed syllables.
const NAME_WORD = '(?:' + NAME_SYLLABLES.map(capitalise).join('|') + ')(?:' + NAME_SYLLABLES.join('|') + '){1,2}';
const NAME_PATTERN = new RegExp('^' + NAME_WORD + ' ' + NAME_WORD + '$');

// rng is any function that returns a number from 0 up to (not including) 1.
function levelName(rng) {
    let previous = -1;
    const word = () => {
        let text = '';
        const count = 2 + Math.floor(rng() * 2);
        for (let i = 0; i < count; i++) {
            let pick = Math.floor(rng() * NAME_SYLLABLES.length);
            if (pick === previous) pick = (pick + 1) % NAME_SYLLABLES.length;  // never "kaka"
            previous = pick;
            text += NAME_SYLLABLES[pick];
        }
        return capitalise(text);
    };
    const first = word();
    return first + ' ' + word();
}

// The same level number always gets the same name.
function seededLevelName(levelNum) {
    const random = seededRandom((Math.imul(levelNum, 2654435761) ^ 0x5bd1e995) >>> 0);
    random();
    random();
    return levelName(random);
}

// A name for a level shape that has none: the same shape always gets the same name.
function shapeName(level) {
    const text = JSON.stringify(level);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    const random = seededRandom(hash >>> 0);
    random();
    random();
    return levelName(random);
}

// A fresh name for a level that is being saved for the first time.
function newLevelName() {
    return levelName(seededRandom(Math.floor(Math.random() * 4294967296)));
}

// Returns the level with a name, giving it one if it has none.
function withName(level) {
    return level.name ? level : { ...level, name: shapeName(level) };
}

// Initialize level
function initLevel(levelNum) {
    platforms = [];
    cheeses = [];
    enemies = [];
    poops = [];

    // Ground
    platforms.push({ x: 0, y: 460, width: 800, height: 40 });

    const random = seededRandom(levelSeed(levelNum));

    // Build a connected staircase. Each platform overlaps the horizontal jump
    // range of the previous platform and rises by no more than 70 pixels.
    const numPlatforms = 5 + levelNum;
    let previous = platforms[0];
    for (let i = 0; i < numPlatforms; i++) {
        const width = 110 + random() * 60;
        const direction = i % 2 === 0 ? 1 : -1;
        const anchor = direction > 0 ? previous.x + previous.width - 35 : previous.x - width + 35;
        const x = Math.max(12, Math.min(canvas.width - width - 12, anchor + (random() - 0.5) * 50));
        const y = Math.max(120, previous.y - (45 + random() * 25));
        const platform = { x, y, width, height: 20, reachableFrom: platforms.length - 1 };
        platforms.push(platform);
        previous = platform;
    }

    // Sort platforms by height so we can verify reachability
    platforms.sort((a, b) => b.y - a.y);

    // Add cheese on platforms
    platforms.forEach((plat, index) => {
        if (index === 0) {
            // Add multiple cheeses on ground
            for (let i = 0; i < 3; i++) {
                cheeses.push({
                    x: 150 + i * 200 + random() * 100,
                    y: plat.y - 30,
                    width: 25,
                    height: 20,
                    collected: false
                });
            }
        } else {
            // Add cheese on each platform
            cheeses.push({
                x: plat.x + plat.width / 2 - 12,
                y: plat.y - 30,
                width: 25,
                height: 20,
                collected: false
            });
        }
    });

    // Add enemies
    // Cat on ground
    enemies.push({
        type: 'cat',
        x: 500,
        y: 420,
        baseY: 420,
        width: 50,
        height: 40,
        originalHeight: 40,
        speed: 1,
        direction: -1,
        patrolMin: 300,
        patrolMax: 700,
        frameTime: 0,
        flattened: false,
        flattenTimer: 0,
        velY: 0,
        jumping: false
    });

    // Add grumpy old man on a platform (if we have enough platforms)
    if (platforms.length > 2) {
        const plat = platforms[Math.floor(platforms.length / 2)];
        if (plat.width >= 100) {
            enemies.push({
                type: 'oldman',
                x: plat.x + 20,
                y: plat.y - 55,
                baseY: plat.y - 55,
                width: 35,
                height: 55,
                originalHeight: 55,
                speed: 1.5,
                direction: 1,
                patrolMin: plat.x,
                patrolMax: plat.x + plat.width - 35,
                frameTime: 0,
                swingAngle: 0,
                flattened: false,
                flattenTimer: 0,
                velY: 0,
                jumping: false,
                agitated: false,
                platformY: plat.y
            });
        }
    }

    // Add more enemies based on level
    for (let i = 0; i < Math.min(levelNum - 1, 3); i++) {
        const platIndex = 2 + i % (platforms.length - 2);
        const plat = platforms[platIndex];
        if (plat && plat.width >= 80) {
            const enemyType = i % 2 === 0 ? 'cat' : 'oldman';
            const height = enemyType === 'cat' ? 40 : 55;
            enemies.push({
                type: enemyType,
                x: plat.x + 10,
                y: plat.y - height,
                baseY: plat.y - height,
                width: enemyType === 'cat' ? 50 : 35,
                height: height,
                originalHeight: height,
                speed: enemyType === 'cat' ? 1 : 1.5,
                direction: 1,
                patrolMin: plat.x,
                patrolMax: plat.x + plat.width - (enemyType === 'cat' ? 50 : 35),
                frameTime: 0,
                swingAngle: 0,
                flattened: false,
                flattenTimer: 0,
                velY: 0,
                jumping: false,
                agitated: false,
                platformY: plat.y
            });
        }
    }

    resetMouse();
}

function resetMouse() {
    mouse.x = SPAWN.x;
    mouse.y = SPAWN.y;
    mouse.velX = 0;
    mouse.velY = 0;
    mouse.powerUp = null;
    mouse.powerUpTimer = 0;
    mouse.speed = 5;
    game.damageCooldown = 0;
    powerUpDisplay.style.display = 'none';
}

// Levels made by hand (the editor, saved levels, default levels)
// Saved shape: { platforms: [{ type, x, y }], cheeses: [{ x, y }], enemies: [{ type, x, p }], bg, name }.
// bg is a background number 0-3; a missing or invalid one means 0 (the fridge).
// name is optional and only ever a generated one: anything not matching NAME_PATTERN is dropped.
// The ground is never stored; p is an index into platforms, or null for the ground.
function hasType(table, type) {
    return typeof type === 'string' && Object.prototype.hasOwnProperty.call(table, type);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Area a platform can ever cover (a tray sweeps sideways)
function footprint(plat) {
    const size = PLATFORM_TYPES[plat.type];
    const pad = plat.type === 'mover' ? MOVER_RANGE : 0;
    return { x: plat.x - pad, y: plat.y, w: size.width + pad * 2, h: size.height };
}

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// True when a platform's area would cover this cheese, so it could never be collected.
function coversCheese(plat, cheese) {
    return rectsOverlap(footprint(plat), { x: cheese.x, y: cheese.y, w: 25, h: 20 });
}

// Clamp a platform into the room, then refuse it if the level has no space for it.
// cheeses (optional) are the level's cheeses: a platform may not cover one.
function canPlace(list, candidate, cheeses = []) {
    const type = hasType(PLATFORM_TYPES, candidate.type) ? candidate.type : 'plain';
    const size = PLATFORM_TYPES[type];
    const pad = type === 'mover' ? MOVER_RANGE : 0;
    const platform = {
        type,
        x: clamp(candidate.x, 8 + pad, 792 - size.width - pad),
        y: clamp(candidate.y, 120, 420 - size.height)
    };
    if (list.length >= LIMITS.platforms) {
        return { ok: false, message: LIMITS.platforms + ' platforms is the most.' };
    }
    const area = footprint(platform);
    if (rectsOverlap(area, SPAWN_CLEAR)) {
        return { ok: false, message: 'Keep the start clear.' };
    }
    if (list.some(other => rectsOverlap(area, footprint(other))) ||
        cheeses.some(cheese => coversCheese(platform, cheese))) {
        return { ok: false, message: 'That spot is taken.' };
    }
    return { ok: true, platform };
}

// Returns a clean copy of a level, or null. A bad level is rejected whole.
function validateLevel(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const { platforms: rawPlatforms, cheeses: rawCheeses, enemies: rawEnemies } = raw;
    if (!Array.isArray(rawPlatforms) || !Array.isArray(rawCheeses) || !Array.isArray(rawEnemies)) return null;
    if (rawPlatforms.length > LIMITS.platforms || rawCheeses.length > LIMITS.cheeses ||
        rawEnemies.length > LIMITS.enemies || rawCheeses.length === 0) return null;
    const isObject = item => item && typeof item === 'object';

    const level = { platforms: [], cheeses: [], enemies: [], bg: Number.isInteger(raw.bg) && raw.bg >= 0 && raw.bg < BACKGROUNDS.length ? raw.bg : 0 };
    for (const item of rawCheeses) {
        if (!isObject(item) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
        level.cheeses.push({ x: clamp(item.x, 8, 767), y: clamp(item.y, 20, 430) });
    }
    // A platform that covers a cheese is refused by canPlace, so the whole level is rejected.
    for (const item of rawPlatforms) {
        if (!isObject(item) || !Number.isFinite(item.x) || !Number.isFinite(item.y)) return null;
        const placed = canPlace(level.platforms, item, level.cheeses);
        if (!placed.ok) return null;
        level.platforms.push(placed.platform);
    }
    for (const item of rawEnemies) {
        if (!isObject(item) || !hasType(ENEMY_TYPES, item.type) || !Number.isFinite(item.x)) return null;
        const onGround = item.p === null || item.p === undefined;
        if (!onGround && !(Number.isInteger(item.p) && level.platforms[item.p] &&
            level.platforms[item.p].type === 'plain')) return null;
        const width = ENEMY_TYPES[item.type].width;
        const x = onGround
            ? clamp(item.x, 300, 700)
            : clamp(item.x, level.platforms[item.p].x, level.platforms[item.p].x + PLATFORM_TYPES.plain.width - width);
        level.enemies.push({ type: item.type, x, p: onGround ? null : item.p });
    }
    if (typeof raw.name === 'string' && NAME_PATTERN.test(raw.name)) level.name = raw.name;
    return level;
}

// Build the three arrays from a valid saved level and put the mouse at the start.
// Does not touch the game mode, score or level display.
function applyLevelData(level) {
    background = level.bg || 0;
    platforms = [{ x: 0, y: 460, width: 800, height: 40 }];
    level.platforms.forEach(item => {
        const size = PLATFORM_TYPES[item.type];
        const plat = { type: item.type, x: item.x, y: item.y, width: size.width, height: size.height };
        if (item.type === 'mover') Object.assign(plat, { homeX: item.x, dir: 1, dx: 0 });
        platforms.push(plat);
    });
    cheeses = level.cheeses.map(c => ({ x: c.x, y: c.y, width: 25, height: 20, collected: false }));
    enemies = level.enemies.map(item => {
        const size = ENEMY_TYPES[item.type];
        const plat = item.p === null ? platforms[0] : platforms[item.p + 1];
        const y = plat.y - size.height;
        return {
            type: item.type,
            x: item.x,
            y,
            baseY: y,
            width: size.width,
            height: size.height,
            originalHeight: size.height,
            speed: size.speed,
            direction: 1,
            patrolMin: item.p === null ? 300 : plat.x,
            patrolMax: item.p === null ? 700 : plat.x + plat.width - size.width,
            frameTime: 0,
            swingAngle: 0,
            flattened: false,
            flattenTimer: 0,
            velY: 0,
            jumping: false,
            agitated: false,
            platformY: plat.y,
            ...(item.type === 'dog' ? { poopTimer: 0 } : {})
        };
    });
    poops = [];
    resetMouse();
}

// Default levels (levels.js): level N plays entry N; a bad entry is skipped.
const presetLevels = Array.isArray(window.CHEESEWORLD_DEFAULT_LEVELS)
    ? window.CHEESEWORLD_DEFAULT_LEVELS.map(validateLevel)
    : [];
presetLevels.forEach((preset, index) => {
    if (!preset) console.warn('Cheese World: default level ' + (index + 1) + ' was skipped (not valid).');
});

function startLevel(levelNum) {
    const preset = presetLevels[levelNum - 1];
    if (preset) {
        applyLevelData(preset);
    } else {
        initLevel(levelNum);
    }
    // Seeded levels take their scene from the level number; level 1 stays the fridge.
    background = (levelNum - 1) % BACKGROUNDS.length;
}

// A made level plays on its own; the seeded run waits where it was.
let seededRun = null;

function loadCustomLevel(level) {
    if (game.mode === 'seeded') seededRun = { score: game.score, level: game.level };
    game.mode = 'custom';
    game.score = 0;
    scoreDisplay.textContent = game.score;
    levelDisplay.textContent = level.name || 'Mine';
    applyLevelData(level);
}

function startSeededRun() {
    if (seededRun) {
        game.score = seededRun.score;
        game.level = seededRun.level;
        seededRun = null;
    }
    game.mode = 'seeded';
    scoreDisplay.textContent = game.score;
    levelDisplay.textContent = seededLevelName(game.level);
    startLevel(game.level);
}

// Draw the mouse character
function drawMouse() {
    ctx.save();
    if (game.damageCooldown > 0 && Math.floor(game.damageCooldown / 100) % 2 === 0) {
        ctx.globalAlpha = 0.45;
    }
    ctx.translate(mouse.x + mouse.width / 2, mouse.y + mouse.height / 2);
    ctx.scale(mouse.direction, 1);
    ctx.translate(-mouse.width / 2, -mouse.height / 2);

    // Power-up glow effect
    if (mouse.powerUp) {
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 15;
        // Draw speed lines
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.6)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-10 - i * 8, 5 + i * 6);
            ctx.lineTo(-20 - i * 8, 5 + i * 6);
            ctx.stroke();
        }
    }

    // Body (gray oval)
    ctx.fillStyle = '#808080';
    ctx.beginPath();
    ctx.ellipse(mouse.width / 2, mouse.height / 2, mouse.width / 2, mouse.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Ears
    ctx.fillStyle = '#606060';
    ctx.beginPath();
    ctx.arc(5, 2, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mouse.width - 5, 2, 8, 0, Math.PI * 2);
    ctx.fill();

    // Inner ears
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath();
    ctx.arc(5, 2, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mouse.width - 5, 2, 5, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(mouse.width - 8, mouse.height / 2 - 2, 3, 0, Math.PI * 2);
    ctx.fill();

    // Eye shine
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(mouse.width - 7, mouse.height / 2 - 3, 1, 0, Math.PI * 2);
    ctx.fill();

    // Nose
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath();
    ctx.arc(mouse.width + 2, mouse.height / 2 + 2, 4, 0, Math.PI * 2);
    ctx.fill();

    // Whiskers
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(mouse.width - 2, mouse.height / 2 + 2);
        ctx.lineTo(mouse.width + 15, mouse.height / 2 + i * 4);
        ctx.stroke();
    }

    // Tail
    ctx.strokeStyle = '#ffb6c1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, mouse.height / 2);
    ctx.quadraticCurveTo(-15, mouse.height / 2 - 10, -10, mouse.height / 2 + 10);
    ctx.stroke();

    ctx.restore();
}

// Draw cheese
function drawCheese(cheese) {
    if (cheese.collected) return;

    // Cheese wedge
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.moveTo(cheese.x, cheese.y + cheese.height);
    ctx.lineTo(cheese.x + cheese.width / 2, cheese.y);
    ctx.lineTo(cheese.x + cheese.width, cheese.y + cheese.height);
    ctx.closePath();
    ctx.fill();

    // Cheese outline
    ctx.strokeStyle = '#daa520';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Holes in cheese
    ctx.fillStyle = '#ffed8a';
    ctx.beginPath();
    ctx.arc(cheese.x + cheese.width / 2, cheese.y + cheese.height / 2 + 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cheese.x + cheese.width / 2 - 6, cheese.y + cheese.height - 5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cheese.x + cheese.width / 2 + 5, cheese.y + cheese.height - 4, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

// Cat colours: orange is the default; the black cat's body is near-black so it still reads on the Night scene.
const CAT_PALETTES = {
    cat: { body: '#ff8c00', stripe: '#cc6600', eyes: '#ffff00' },
    blackcat: { body: '#2b2b36', stripe: '#16161d', eyes: '#c8ff00' }
};

// Draw cat enemy
function drawCat(enemy, palette = CAT_PALETTES.cat) {
    ctx.save();
    ctx.translate(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);

    // Squish effect if flattened
    if (enemy.flattened) {
        ctx.scale(enemy.direction * 1.5, 0.25);
    } else {
        ctx.scale(enemy.direction, 1);
    }
    ctx.translate(-enemy.width / 2, -enemy.height / 2);

    // Body (orange oval)
    ctx.fillStyle = palette.body;
    ctx.beginPath();
    ctx.ellipse(enemy.width / 2, enemy.height / 2 + 5, enemy.width / 2 - 5, enemy.height / 2 - 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Stripes
    ctx.strokeStyle = palette.stripe;
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(15 + i * 10, enemy.height / 2 - 5);
        ctx.lineTo(15 + i * 10, enemy.height / 2 + 15);
        ctx.stroke();
    }

    // Head
    ctx.fillStyle = palette.body;
    ctx.beginPath();
    ctx.arc(enemy.width - 10, enemy.height / 2 - 5, 15, 0, Math.PI * 2);
    ctx.fill();

    // Ears (triangles)
    ctx.fillStyle = palette.body;
    ctx.beginPath();
    ctx.moveTo(enemy.width - 20, enemy.height / 2 - 18);
    ctx.lineTo(enemy.width - 15, enemy.height / 2 - 8);
    ctx.lineTo(enemy.width - 25, enemy.height / 2 - 10);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(enemy.width - 2, enemy.height / 2 - 18);
    ctx.lineTo(enemy.width + 3, enemy.height / 2 - 8);
    ctx.lineTo(enemy.width - 7, enemy.height / 2 - 10);
    ctx.closePath();
    ctx.fill();

    // Inner ears
    ctx.fillStyle = '#ffb6c1';
    ctx.beginPath();
    ctx.moveTo(enemy.width - 18, enemy.height / 2 - 15);
    ctx.lineTo(enemy.width - 15, enemy.height / 2 - 9);
    ctx.lineTo(enemy.width - 22, enemy.height / 2 - 11);
    ctx.closePath();
    ctx.fill();

    // Eyes (menacing)
    ctx.fillStyle = palette.eyes;
    ctx.beginPath();
    ctx.ellipse(enemy.width - 14, enemy.height / 2 - 7, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(enemy.width - 4, enemy.height / 2 - 7, 4, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pupils (slits)
    ctx.fillStyle = '#000';
    ctx.fillRect(enemy.width - 15, enemy.height / 2 - 11, 2, 8);
    ctx.fillRect(enemy.width - 5, enemy.height / 2 - 11, 2, 8);

    // Nose
    ctx.fillStyle = '#ff69b4';
    ctx.beginPath();
    ctx.moveTo(enemy.width + 3, enemy.height / 2 - 3);
    ctx.lineTo(enemy.width, enemy.height / 2);
    ctx.lineTo(enemy.width + 6, enemy.height / 2);
    ctx.closePath();
    ctx.fill();

    // Mouth (evil grin)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(enemy.width - 2, enemy.height / 2 + 2);
    ctx.quadraticCurveTo(enemy.width + 5, enemy.height / 2 + 6, enemy.width + 8, enemy.height / 2 + 2);
    ctx.stroke();

    // Tail
    ctx.strokeStyle = palette.body;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(5, enemy.height / 2);
    const tailWave = Math.sin(enemy.frameTime * 0.1) * 10;
    ctx.quadraticCurveTo(-10, enemy.height / 2 - 20 + tailWave, -5, enemy.height / 2 - 30);
    ctx.stroke();

    // Legs
    ctx.fillStyle = palette.body;
    ctx.fillRect(10, enemy.height - 10, 8, 10);
    ctx.fillRect(30, enemy.height - 10, 8, 10);

    ctx.restore();
}

// Draw the little white dog (30 x 24, head to the right)
function drawDog(enemy) {
    ctx.save();
    ctx.translate(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);
    if (enemy.flattened) {
        ctx.scale(enemy.direction * 1.5, 0.25);
    } else {
        ctx.scale(enemy.direction, 1);
    }
    ctx.translate(-enemy.width / 2, -enemy.height / 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#333340';
    ctx.fillStyle = '#ffffff';

    // Tail, wagging
    const wag = Math.sin(enemy.frameTime * 0.4) * 4;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(4, 12);
    ctx.lineTo(-3, 5 + wag);
    ctx.stroke();
    ctx.lineWidth = 1.5;

    // Legs, body, head
    ctx.fillRect(7, 19, 4, 5);
    ctx.strokeRect(7, 19, 4, 5);
    ctx.fillRect(19, 19, 4, 5);
    ctx.strokeRect(19, 19, 4, 5);
    ctx.beginPath();
    ctx.ellipse(13, 15, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(23, 9, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Dark ear, eye and nose
    ctx.fillStyle = '#4a3b36';
    ctx.beginPath();
    ctx.ellipse(19, 6, 3, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(25, 7, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(29, 10, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// Draw a poop: a brown swirl of three stacked blobs
function drawPoop(poop) {
    ctx.save();
    ctx.translate(poop.x, poop.y);
    ctx.fillStyle = '#6b4423';
    ctx.strokeStyle = '#3f2813';
    ctx.lineWidth = 1;
    [[7, 8, 7, 2.5], [7, 5.5, 5, 2.5], [7, 3, 3, 2.2]].forEach(([x, y, rx, ry]) => {
        ctx.beginPath();
        ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    ctx.restore();
}

// Draw grumpy old man
function drawOldMan(enemy) {
    ctx.save();
    ctx.translate(enemy.x + enemy.width / 2, enemy.y + enemy.height / 2);

    // Squish effect if flattened
    if (enemy.flattened) {
        ctx.scale(enemy.direction * 1.5, 0.25);
    } else {
        ctx.scale(enemy.direction, 1);
    }
    ctx.translate(-enemy.width / 2, -enemy.height / 2);

    // Determine face color based on agitation
    const faceColor = enemy.agitated ? '#ff6b6b' : '#deb887';
    const shakeOffset = enemy.agitated ? Math.sin(enemy.frameTime * 0.5) * 2 : 0;

    // Legs
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(8, enemy.height - 20, 8, 20);
    ctx.fillRect(20, enemy.height - 20, 8, 20);

    // Body (hunched torso)
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.moveTo(5, enemy.height - 20);
    ctx.lineTo(30, enemy.height - 20);
    ctx.lineTo(28, enemy.height - 45);
    ctx.lineTo(8, enemy.height - 45);
    ctx.closePath();
    ctx.fill();

    // Cardigan
    ctx.strokeStyle = '#6b3510';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(17, enemy.height - 45);
    ctx.lineTo(17, enemy.height - 20);
    ctx.stroke();

    // Head
    ctx.fillStyle = faceColor;
    ctx.beginPath();
    ctx.arc(18 + shakeOffset, enemy.height - 50, 10, 0, Math.PI * 2);
    ctx.fill();

    // Grumpy eyebrows (angrier when agitated)
    ctx.strokeStyle = '#696969';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(12, enemy.height - 54);
    ctx.lineTo(16, enemy.height - 52);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(20, enemy.height - 52);
    ctx.lineTo(24, enemy.height - 54);
    ctx.stroke();

    // Angry eyes
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(14, enemy.height - 51, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(22, enemy.height - 51, 2, 0, Math.PI * 2);
    ctx.fill();

    // Glasses
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.strokeRect(11, enemy.height - 53, 7, 5);
    ctx.strokeRect(19, enemy.height - 53, 7, 5);
    ctx.beginPath();
    ctx.moveTo(18, enemy.height - 51);
    ctx.lineTo(19, enemy.height - 51);
    ctx.stroke();

    // Frown
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, enemy.height - 44);
    ctx.quadraticCurveTo(18, enemy.height - 46, 22, enemy.height - 44);
    ctx.stroke();

    // Balding hair
    ctx.fillStyle = '#c0c0c0';
    ctx.beginPath();
    ctx.arc(10, enemy.height - 55, 4, Math.PI, Math.PI * 1.7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(26, enemy.height - 55, 4, Math.PI * 1.3, Math.PI * 2);
    ctx.fill();

    // Arm holding newspaper
    ctx.fillStyle = '#deb887';
    ctx.save();
    ctx.translate(28, enemy.height - 38);
    ctx.rotate(enemy.swingAngle);

    // Upper arm
    ctx.fillStyle = '#8b4513';
    ctx.fillRect(-3, 0, 8, 15);

    // Hand
    ctx.fillStyle = '#deb887';
    ctx.beginPath();
    ctx.arc(1, 17, 5, 0, Math.PI * 2);
    ctx.fill();

    // Newspaper
    ctx.fillStyle = '#f5f5dc';
    ctx.fillRect(-8, 15, 20, 25);
    ctx.fillStyle = '#d3d3d3';
    ctx.fillRect(-6, 18, 16, 2);
    ctx.fillRect(-6, 22, 16, 2);
    ctx.fillRect(-6, 26, 16, 2);
    ctx.fillRect(-6, 30, 10, 2);

    // "NEWS" text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 6px Arial';
    ctx.fillText('NEWS', -5, 38);

    ctx.restore();

    ctx.restore();
}

// Level objects besides the plain slab
function drawWheel(plat) {
    ctx.save();
    ctx.fillStyle = '#f2b824';
    ctx.strokeStyle = '#b9820f';
    ctx.lineWidth = 3;
    // A round wheel inside its box; the mouse collides with the circle, while placement still uses the box.
    const radius = Math.min(plat.width, plat.height) / 2;
    ctx.beginPath();
    ctx.arc(plat.x + plat.width / 2, plat.y + plat.height / 2, radius - 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d99a14';
    [[0.35, 0.35, 5], [0.62, 0.62, 4], [0.68, 0.32, 3.5]].forEach(([fx, fy, r]) => {
        ctx.beginPath();
        ctx.arc(plat.x + plat.width * fx, plat.y + plat.height * fy, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function drawBooks(plat) {
    ctx.save();
    const colors = ['#c0392b', '#2e86c1', '#27ae60'];
    const rowHeight = plat.height / 3;
    colors.forEach((color, i) => {
        const inset = i === 1 ? 8 : 0;
        const y = plat.y + i * rowHeight;
        ctx.fillStyle = color;
        ctx.fillRect(plat.x + inset, y, plat.width - inset, rowHeight);
        ctx.fillStyle = '#f5ecd0';
        ctx.fillRect(plat.x + inset + 6, y + 3, plat.width - inset - 8, rowHeight - 6);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.fillRect(plat.x + inset, y, 5, rowHeight);
    });
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
    ctx.restore();
}

function drawMushroom(plat) {
    ctx.save();
    ctx.fillStyle = '#f3e3c3';
    ctx.fillRect(plat.x + plat.width * 0.35, plat.y + plat.height * 0.5, plat.width * 0.3, plat.height * 0.5);
    ctx.fillStyle = '#d63a3a';
    ctx.strokeStyle = '#8f1f1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(plat.x + plat.width / 2, plat.y + plat.height * 0.55, plat.width / 2, plat.height * 0.55, 0, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    [[0.25, 0.4, 4], [0.5, 0.2, 5], [0.75, 0.4, 4]].forEach(([fx, fy, r]) => {
        ctx.beginPath();
        ctx.arc(plat.x + plat.width * fx, plat.y + plat.height * fy, r, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.restore();
}

function drawTray(plat) {
    ctx.save();
    ctx.fillStyle = '#a0703c';
    ctx.strokeStyle = '#5e3d1c';
    ctx.lineWidth = 2;
    ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
    ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
    ctx.fillStyle = '#c28b52';
    ctx.fillRect(plat.x, plat.y, plat.width, 5);
    // Arrow cue: this one slides
    ctx.fillStyle = '#f7e6c8';
    ctx.beginPath();
    ctx.moveTo(plat.x + plat.width / 2 - 14, plat.y + 12);
    ctx.lineTo(plat.x + plat.width / 2 - 6, plat.y + 7);
    ctx.lineTo(plat.x + plat.width / 2 - 6, plat.y + 17);
    ctx.moveTo(plat.x + plat.width / 2 + 14, plat.y + 12);
    ctx.lineTo(plat.x + plat.width / 2 + 6, plat.y + 7);
    ctx.lineTo(plat.x + plat.width / 2 + 6, plat.y + 17);
    ctx.fill();
    ctx.restore();
}

const PLATFORM_DRAWERS = { wheel: drawWheel, books: drawBooks, spring: drawMushroom, mover: drawTray };

// Draw platforms
function drawPlatforms() {
    platforms.forEach((plat, index) => {
        if (index > 0 && hasType(PLATFORM_DRAWERS, plat.type)) {
            PLATFORM_DRAWERS[plat.type](plat);
        } else if (index === 0) {
            // Ground - darker cheese color
            ctx.fillStyle = '#c9a030';
            ctx.fillRect(plat.x, plat.y, plat.width, plat.height);

            // Ground pattern
            ctx.fillStyle = '#b8912a';
            for (let i = 0; i < plat.width; i += 40) {
                ctx.beginPath();
                ctx.arc(i + 20, plat.y + 20, 8, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            // Floating platforms - cheese colored
            ctx.fillStyle = '#ffd700';
            ctx.fillRect(plat.x, plat.y, plat.width, plat.height);

            // Platform holes
            ctx.fillStyle = '#ffed8a';
            ctx.beginPath();
            ctx.arc(plat.x + plat.width / 4, plat.y + plat.height / 2, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(plat.x + plat.width * 3 / 4, plat.y + plat.height / 2, 3, 0, Math.PI * 2);
            ctx.fill();

            // Platform outline
            ctx.strokeStyle = '#daa520';
            ctx.lineWidth = 2;
            ctx.strokeRect(plat.x, plat.y, plat.width, plat.height);
        }
    });
}

// Draw background: the scene a level has (see BACKGROUNDS)
function drawBackground(bg = 0) {
    [drawFridge, drawPantry, drawGarden, drawNight][bg]();
}

function drawFridge() {
    // Fridge interior - cool white/blue gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#e8f4f8');
    gradient.addColorStop(0.5, '#d0e8f0');
    gradient.addColorStop(1, '#b8d8e8');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fridge back wall texture (subtle)
    ctx.fillStyle = 'rgba(200, 220, 230, 0.5)';
    for (let y = 0; y < canvas.height; y += 60) {
        ctx.fillRect(0, y, canvas.width, 2);
    }

    // Fridge light glow from top
    const lightGradient = ctx.createRadialGradient(400, -50, 10, 400, 100, 300);
    lightGradient.addColorStop(0, 'rgba(255, 255, 240, 0.4)');
    lightGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = lightGradient;
    ctx.fillRect(0, 0, canvas.width, 250);

    // Left wall shadow
    const leftShadow = ctx.createLinearGradient(0, 0, 80, 0);
    leftShadow.addColorStop(0, 'rgba(100, 130, 150, 0.3)');
    leftShadow.addColorStop(1, 'rgba(100, 130, 150, 0)');
    ctx.fillStyle = leftShadow;
    ctx.fillRect(0, 0, 80, canvas.height);

    // Right wall shadow
    const rightShadow = ctx.createLinearGradient(canvas.width, 0, canvas.width - 80, 0);
    rightShadow.addColorStop(0, 'rgba(100, 130, 150, 0.3)');
    rightShadow.addColorStop(1, 'rgba(100, 130, 150, 0)');
    ctx.fillStyle = rightShadow;
    ctx.fillRect(canvas.width - 80, 0, 80, canvas.height);

    // Fridge door seal on edges
    ctx.fillStyle = '#708090';
    ctx.fillRect(0, 0, 8, canvas.height);
    ctx.fillRect(canvas.width - 8, 0, 8, canvas.height);
    ctx.fillRect(0, 0, canvas.width, 6);

    // Some background fridge items (decorative)
    // Milk carton in back
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillRect(650, 320, 30, 50);
    ctx.fillStyle = 'rgba(100, 150, 200, 0.3)';
    ctx.fillRect(650, 320, 30, 15);

    // Jar in back
    ctx.fillStyle = 'rgba(200, 100, 100, 0.25)';
    ctx.beginPath();
    ctx.arc(720, 360, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(220, 220, 220, 0.3)';
    ctx.fillRect(705, 335, 30, 8);

    // Butter dish in back
    ctx.fillStyle = 'rgba(255, 230, 150, 0.35)';
    ctx.fillRect(50, 350, 45, 25);
    ctx.fillStyle = 'rgba(240, 240, 240, 0.4)';
    ctx.fillRect(48, 345, 50, 8);

    // Condiment bottles
    ctx.fillStyle = 'rgba(200, 50, 50, 0.25)';
    ctx.fillRect(100, 330, 15, 40);
    ctx.fillStyle = 'rgba(230, 200, 50, 0.25)';
    ctx.fillRect(120, 335, 15, 35);
}

// Pantry: dark wood wall, planks for shelves, jars and a flour sack
function drawPantry() {
    const wall = ctx.createLinearGradient(0, 0, 0, canvas.height);
    wall.addColorStop(0, '#7a5a3c');
    wall.addColorStop(1, '#5c4029');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let x = 0; x < canvas.width; x += 50) ctx.fillRect(x, 0, 3, canvas.height);

    // Three shelves, each with a row of jars
    const jarColors = ['#c0392b', '#7fb069', '#e8a33d', '#8e6bbf'];
    [150, 275, 395].forEach((y, row) => {
        for (let i = 0; i < 6; i++) {
            const x = 30 + i * 125 + (row % 2) * 55;
            ctx.fillStyle = jarColors[(i + row) % jarColors.length];
            ctx.globalAlpha = 0.55;
            ctx.fillRect(x, y - 38, 30, 38);
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#d8c9a8';
            ctx.fillRect(x - 2, y - 44, 34, 8);
        }
        ctx.fillStyle = '#3e2a18';
        ctx.fillRect(0, y, canvas.width, 8);
        ctx.fillStyle = '#9b7348';
        ctx.fillRect(0, y, canvas.width, 3);
    });
}

// Garden: sky, sun, clouds, a green lawn and a picket fence
function drawGarden() {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#6ec6f0');
    sky.addColorStop(1, '#c8ecfa');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#fff3a0';
    ctx.beginPath();
    ctx.arc(680, 90, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    [[150, 80], [420, 140]].forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.arc(x + 28, y + 6, 20, 0, Math.PI * 2);
        ctx.arc(x - 28, y + 8, 18, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = '#4f9d4a';
    ctx.fillRect(0, 380, canvas.width, canvas.height - 380);
    ctx.fillStyle = '#6dbb5f';
    ctx.fillRect(0, 380, canvas.width, 8);

    // Picket fence
    ctx.fillStyle = '#f4f1e8';
    for (let x = 6; x < canvas.width; x += 36) {
        ctx.beginPath();
        ctx.moveTo(x, 330);
        ctx.lineTo(x + 12, 318);
        ctx.lineTo(x + 24, 330);
        ctx.lineTo(x + 24, 400);
        ctx.lineTo(x, 400);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = '#d9d4c3';
    ctx.fillRect(0, 345, canvas.width, 8);
    ctx.fillRect(0, 375, canvas.width, 8);
}

// Night: a dark kitchen with a window showing the moon and stars
function drawNight() {
    const wall = ctx.createLinearGradient(0, 0, 0, canvas.height);
    wall.addColorStop(0, '#1b2347');
    wall.addColorStop(1, '#2c3560');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Window
    ctx.fillStyle = '#0c1230';
    ctx.fillRect(270, 50, 260, 200);
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    ctx.arc(450, 105, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0c1230';
    ctx.beginPath();
    ctx.arc(462, 98, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    [[300, 80], [340, 140], [395, 70], [500, 190], [310, 210], [420, 170]].forEach(([x, y]) => {
        ctx.fillRect(x, y, 3, 3);
    });
    ctx.fillStyle = '#5a6494';
    ctx.fillRect(262, 42, 276, 8);
    ctx.fillRect(262, 250, 276, 8);
    ctx.fillRect(396, 50, 8, 200);
    ctx.fillRect(270, 140, 260, 6);

    // Cupboard edges
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(0, 300, 200, 160);
    ctx.fillRect(620, 300, 180, 160);
    ctx.fillStyle = 'rgba(120, 130, 190, 0.35)';
    ctx.fillRect(0, 300, 200, 4);
    ctx.fillRect(620, 300, 180, 4);
}

// Collision detection
function checkCollision(rect1, rect2) {
    return rect1.x < rect2.x + rect2.width &&
           rect1.x + rect1.width > rect2.x &&
           rect1.y < rect2.y + rect2.height &&
           rect1.y + rect1.height > rect2.y;
}

// The mouse against a round cheese wheel. The wheel is a circle here; placement still uses its box.
const WHEEL_STAND_REACH = 0.75;  // share of the radius, either side of the middle, that can be stood on
const WHEEL_FROM_ABOVE = 8;      // how far below the surface the feet may have been and still count as above it
const WHEEL_SNAP = 6;            // feet this close above the surface settle onto it, so walking follows the curve
const WHEEL_LEAVE_NUDGE = 0.5;   // the most a mouse walking off the edge is pushed sideways in one frame
function collideWheel(mouse, plat) {
    const radius = plat.width / 2;
    const cx = plat.x + plat.width / 2;
    const cy = plat.y + plat.height / 2;
    const bottom = mouse.y + mouse.height;
    const dx = mouse.x + mouse.width / 2 - cx;

    // On top: the mouse stands with the middle of its feet on the arc.
    if (Math.abs(dx) <= WHEEL_STAND_REACH * radius) {
        const surface = cy - Math.sqrt(radius * radius - dx * dx);
        const fromAbove = mouse.velY > 0
            ? bottom - mouse.velY <= surface + WHEEL_FROM_ABOVE
            : bottom <= surface + WHEEL_FROM_ABOVE;
        if (fromAbove) {
            if (mouse.velY > 0 && bottom >= surface - WHEEL_SNAP) {
                mouse.y = surface - mouse.height;
                mouse.velY = 0;
                mouse.onGround = true;
            }
            return;
        }
    }

    // Anywhere else: touching means the nearest point of the mouse is inside the circle.
    const ex = Math.min(Math.max(cx, mouse.x), mouse.x + mouse.width) - cx;
    const ey = Math.min(Math.max(cy, mouse.y), bottom) - cy;
    if (ex * ex + ey * ey >= radius * radius) return;

    // Rising into the underside stops at the lower arc.
    if (mouse.velY < 0 && ey > 0) {
        mouse.y = cy + Math.sqrt(radius * radius - ex * ex);
        mouse.velY = 0;
        return;
    }
    // Otherwise it is pushed sideways out of the circle, and gravity does the rest.
    const clear = Math.sqrt(radius * radius - ey * ey);
    const target = dx >= 0 ? cx + clear : cx - clear - mouse.width;
    // A mouse already walking away from the wheel is nudged, not thrown: it is leaving on its own.
    const leaving = mouse.velX !== 0 && (mouse.velX > 0) === (dx >= 0);
    const shift = target - mouse.x;
    mouse.x = leaving ? mouse.x + Math.max(-WHEEL_LEAVE_NUDGE, Math.min(WHEEL_LEAVE_NUDGE, shift)) : target;
}

// A dog leaves one poop at its back foot, resting on the surface it walks on.
// A dog keeps at most POOP_MAX: the oldest of its own goes first.
function dropPoop(dog) {
    const own = poops.filter(p => p.owner === dog);
    if (own.length >= POOP_MAX) poops.splice(poops.indexOf(own[0]), 1);
    poops.push({
        x: dog.direction > 0 ? dog.x : dog.x + dog.width - POOP_SIZE.width,
        y: dog.baseY + dog.originalHeight - POOP_SIZE.height,
        width: POOP_SIZE.width,
        height: POOP_SIZE.height,
        owner: dog
    });
}

// Update game state
function update(stepMs = STEP_MS) {
    // Horizontal movement
    if (keys.left) {
        mouse.velX = -mouse.speed;
        mouse.direction = -1;
    } else if (keys.right) {
        mouse.velX = mouse.speed;
        mouse.direction = 1;
    } else {
        mouse.velX = 0;
    }

    // Jumping
    if (keys.jump && mouse.onGround) {
        mouse.velY = -mouse.jumpForce;
        mouse.onGround = false;
    }

    // Apply gravity
    mouse.velY += game.gravity;

    // Move mouse
    mouse.x += mouse.velX;
    mouse.y += mouse.velY;

    // Screen boundaries
    if (mouse.x < 0) mouse.x = 0;
    if (mouse.x + mouse.width > canvas.width) mouse.x = canvas.width - mouse.width;

    // Sliding trays move before the collision check
    platforms.forEach(plat => {
        if (plat.type !== 'mover') return;
        plat.dx = moverSpeed * plat.dir;
        plat.x += plat.dx;
        if (Math.abs(plat.x - plat.homeX) >= MOVER_RANGE) {
            plat.x = plat.homeX + MOVER_RANGE * plat.dir;
            plat.dir = -plat.dir;
        }
    });

    // Platform collision
    mouse.onGround = false;
    platforms.forEach(plat => {
        if (plat.type === 'wheel') {
            collideWheel(mouse, plat);
            return;
        }
        if (checkCollision(mouse, plat)) {
            // Check if landing on top
            if (mouse.velY > 0 && mouse.y + mouse.height - mouse.velY <= plat.y + 5) {
                mouse.y = plat.y - mouse.height;
                // Mushrooms bounce; trays carry the mouse along
                mouse.velY = plat.type === 'spring' ? -SPRING_BOUNCE : 0;
                mouse.onGround = plat.type !== 'spring';
                mouse.x += plat.dx || 0;
            }
            // Check if hitting from below
            else if (mouse.velY < 0 && mouse.y - mouse.velY >= plat.y + plat.height - 5) {
                mouse.y = plat.y + plat.height;
                mouse.velY = 0;
            }
            // Side collision
            else if (mouse.velX > 0) {
                mouse.x = plat.x - mouse.width;
            } else if (mouse.velX < 0) {
                mouse.x = plat.x + plat.width;
            }
        }
    });

    // Cheese collection
    cheeses.forEach(cheese => {
        if (!cheese.collected && checkCollision(mouse, cheese)) {
            cheese.collected = true;
            game.score += 10;
            scoreDisplay.textContent = game.score;
        }
    });

    // Check if all cheese collected
    if (cheeses.every(c => c.collected)) {
        if (game.mode === 'custom') {
            // A made level ends here; the editor shows the message.
            if (game.running) {
                game.running = false;
                document.dispatchEvent(new CustomEvent('cheeseworld:won'));
            }
        } else {
            game.level++;
            levelDisplay.textContent = seededLevelName(game.level);
            startLevel(game.level);
        }
    }

    // Update power-up timer
    if (mouse.powerUp) {
        mouse.powerUpTimer -= stepMs;
        powerUpDisplay.style.display = 'inline';
        // Blink when about to expire
        if (mouse.powerUpTimer < 1000) {
            powerUpDisplay.style.opacity = Math.sin(mouse.powerUpTimer * 0.018) > 0 ? 1 : 0.3;
        }
        if (mouse.powerUpTimer <= 0) {
            mouse.powerUp = null;
            mouse.speed = 5;
            powerUpDisplay.style.display = 'none';
            powerUpDisplay.style.opacity = 1;
        }
    }

    // Update enemies
    game.damageCooldown = Math.max(0, game.damageCooldown - stepMs);
    for (const enemy of enemies) {
        // Skip if flattened and timer expired
        if (enemy.flattened) {
            enemy.flattenTimer -= stepMs;
            if (enemy.flattenTimer <= 0) {
                // Remove flattened enemy by marking for removal
                enemy.removed = true;
            }
            continue;
        }

        // Old man agitation - check distance to mouse
        if (enemy.type === 'oldman') {
            const dx = Math.abs((enemy.x + enemy.width / 2) - (mouse.x + mouse.width / 2));
            const dy = Math.abs((enemy.y + enemy.height / 2) - (mouse.y + mouse.height / 2));
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 150) {
                enemy.agitated = true;
                // Start jumping if on ground and not already jumping
                if (!enemy.jumping && enemy.y >= enemy.baseY) {
                    enemy.velY = -8;
                    enemy.jumping = true;
                }
            } else {
                enemy.agitated = false;
            }

            // Apply gravity to jumping old man
            if (enemy.jumping) {
                enemy.velY += game.gravity;
                enemy.y += enemy.velY;

                // Land back on platform
                if (enemy.y >= enemy.baseY) {
                    enemy.y = enemy.baseY;
                    enemy.velY = 0;
                    enemy.jumping = false;
                }
            }

            // Faster newspaper swing when agitated
            if (enemy.agitated) {
                enemy.swingAngle = Math.sin(enemy.frameTime * 0.4) * 0.8;
            } else {
                enemy.swingAngle = Math.sin(enemy.frameTime * 0.15) * 0.5;
            }
        }

        // Move enemy
        enemy.x += enemy.speed * enemy.direction;
        enemy.frameTime++;

        // Patrol bounds
        if (enemy.x <= enemy.patrolMin) {
            enemy.x = enemy.patrolMin;
            enemy.direction = 1;
        } else if (enemy.x >= enemy.patrolMax) {
            enemy.x = enemy.patrolMax;
            enemy.direction = -1;
        }

        // A walking dog drops poop on a timer
        if (enemy.type === 'dog') {
            enemy.poopTimer += stepMs;
            if (enemy.poopTimer >= POOP_EVERY_MS) {
                enemy.poopTimer -= POOP_EVERY_MS;
                dropPoop(enemy);
            }
        }

        // Check collision with mouse
        if (checkCollision(mouse, enemy)) {
            // Check if mouse is stomping from above
            const mouseBottom = mouse.y + mouse.height;
            const enemyTop = enemy.y;
            const stompingFromAbove = mouse.velY > 0 && mouseBottom - mouse.velY <= enemyTop + 10;

            if (stompingFromAbove) {
                // Stomp the enemy!
                enemy.flattened = true;
                enemy.flattenTimer = FLATTENED_MS;
                enemy.height = enemy.originalHeight * 0.25; // Squish!
                enemy.y = enemy.baseY + enemy.originalHeight - enemy.height;

                // Bounce mouse up
                mouse.velY = -10;

                // Give power-up
                mouse.powerUp = 'speed';
                mouse.powerUpTimer = POWER_UP_MS;
                mouse.speed = 8;

                // Bonus points
                game.score += 25;
                scoreDisplay.textContent = game.score;
            } else if (!mouse.powerUp && game.damageCooldown <= 0) {
                // Mouse gets hit - lose some cheese and respawn
                game.score = Math.max(0, game.score - 5);
                scoreDisplay.textContent = game.score;
                mouse.x = SPAWN.x;
                mouse.y = SPAWN.y;
                mouse.velX = 0;
                mouse.velY = 0;
                game.damageCooldown = DAMAGE_COOLDOWN_MS;
                break;
            }
        }
    }

    // Remove flattened enemies
    enemies = enemies.filter(e => !e.removed);

    // Poop hurts like an enemy hit (it cannot be stomped); a power-up walks over it
    if (!mouse.powerUp && game.damageCooldown <= 0 && poops.some(poop => checkCollision(mouse, poop))) {
        game.score = Math.max(0, game.score - 5);
        scoreDisplay.textContent = game.score;
        mouse.x = SPAWN.x;
        mouse.y = SPAWN.y;
        mouse.velX = 0;
        mouse.velY = 0;
        game.damageCooldown = DAMAGE_COOLDOWN_MS;
    }

    // Fall off screen - reset position
    if (mouse.y > canvas.height) {
        mouse.x = SPAWN.x;
        mouse.y = SPAWN.y;
        mouse.velY = 0;
        mouse.powerUp = null;
        mouse.powerUpTimer = 0;
        mouse.speed = 5;
        powerUpDisplay.style.display = 'none';
    }
}

// Render game
function render() {
    drawBackground(background);
    drawPlatforms();
    cheeses.forEach(drawCheese);
    poops.forEach(drawPoop);

    // Draw enemies
    enemies.forEach(enemy => {
        if (enemy.type === 'cat' || enemy.type === 'blackcat') {
            drawCat(enemy, CAT_PALETTES[enemy.type]);
        } else if (enemy.type === 'dog') {
            drawDog(enemy);
        } else if (enemy.type === 'oldman') {
            drawOldMan(enemy);
        }
    });

    drawMouse();
}

// Game loop
let previousTime = performance.now();
let accumulator = 0;
function advanceFrame(elapsedMs) {
    accumulator += Math.min(100, elapsedMs);
    while (accumulator >= STEP_MS) {
        update(STEP_MS);
        accumulator -= STEP_MS;
    }
}
function gameLoop(now) {
    if (game.running) advanceFrame(now - previousTime);
    previousTime = now;
    render();
    requestAnimationFrame(gameLoop);
}

// Event listeners
function setControl(control, isPressed) {
    switch(control) {
        case 'left':
            keys.left = isPressed;
            break;
        case 'right':
            keys.right = isPressed;
            break;
        case 'jump':
            keys.jump = isPressed;
            break;
    }
}

function controlFromKey(key) {
    switch(key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
            return 'left';
        case 'ArrowRight':
        case 'd':
        case 'D':
            return 'right';
        case 'ArrowUp':
        case 'w':
        case 'W':
        case ' ':
            return 'jump';
        default:
            return null;
    }
}

function shouldHandleGameplayKey(event) {
    return !event.metaKey && !event.ctrlKey && !event.altKey &&
        !event.target.closest('button, input, select, textarea, a[href]');
}

function releaseAllControls() {
    keys.left = false;
    keys.right = false;
    keys.jump = false;

    touchControls.forEach(button => {
        button.classList.remove('is-pressed');
    });
}

document.addEventListener('keydown', (e) => {
    const control = controlFromKey(e.key);

    if (!control || !shouldHandleGameplayKey(e)) {
        return;
    }

    setControl(control, true);

    e.preventDefault();
});

document.addEventListener('keyup', (e) => {
    const control = controlFromKey(e.key);

    if (!control) {
        return;
    }

    // Always honor releases, even if focus moved onto a button while the key
    // was held. Scoping releases to the current target can leave movement stuck.
    setControl(control, false);
    if (shouldHandleGameplayKey(e)) e.preventDefault();
});

touchControls.forEach(button => {
    const control = button.dataset.control;

    button.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        button.classList.add('is-pressed');
        setControl(control, true);
    });

    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        button.addEventListener(eventName, (e) => {
            e.preventDefault();
            button.classList.remove('is-pressed');
            setControl(control, false);
        });
    }
});

window.addEventListener('blur', releaseAllControls);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllControls();
});

window.cheeseworldGame = {
    loadCustomLevel,
    startSeededRun,
    validateLevel,
    withName,
    newLevelName,
    canPlace,
    coversCheese,
    LEVEL_LOG_PREFIX,
    BACKGROUNDS,
    releaseAllControls,
    game,
    PLATFORM_TYPES,
    ENEMY_TYPES,
    LIMITS,
    SPAWN_CLEAR,
    MOVER_RANGE
};

window.__cheeseworldTest = {
    initLevel,
    startLevel,
    render,
    loadCustomLevel,
    validateLevel,
    canPlace,
    levelName,
    seededLevelName,
    seededRandom,
    NAME_SYLLABLES,
    NAME_PATTERN,
    PLATFORM_TYPES,
    placeMouse(x, y, velY = 0) {
        mouse.x = x;
        mouse.y = y;
        mouse.velY = velY;
        mouse.onGround = false;
    },
    setScore(value) {
        game.score = value;
        scoreDisplay.textContent = value;
    },
    givePowerUp() {
        mouse.powerUp = 'speed';
        mouse.powerUpTimer = POWER_UP_MS;
    },
    setPlatforms(list) {
        platforms = list;
    },
    step(milliseconds) {
        const count = Math.round(milliseconds / STEP_MS);
        for (let i = 0; i < count; i++) update(STEP_MS);
    },
    runFrameDeltas(deltas) {
        accumulator = 0;
        deltas.forEach(advanceFrame);
    },
    setSeed(seed) {
        game.seed = seed >>> 0;
    },
    state() {
        return {
            game: { ...game },
            background,
            mouse: { ...mouse },
            platforms: platforms.map(platform => ({ ...platform })),
            cheeses: cheeses.map(cheese => ({ ...cheese })),
            enemies: enemies.map(enemy => ({ ...enemy })),
            poops: poops.map(({ x, y, width, height }) => ({ x, y, width, height })),
            keys: { ...keys }
        };
    },
    arrangeDamageTest() {
        game.running = false;
        game.score = 20;
        game.damageCooldown = 0;
        mouse.powerUp = null;
        mouse.x = 200;
        mouse.y = 435;
        mouse.velX = 0;
        mouse.velY = 0;
        cheeses = [{ x: 700, y: 100, width: 25, height: 20, collected: false }];
        enemies = [0, 1].map(() => ({
            type: 'cat', x: 200, y: 400, baseY: 400, width: 50, height: 40,
            originalHeight: 40, speed: 0, direction: 1, patrolMin: 200,
            patrolMax: 200, frameTime: 0, flattened: false, flattenTimer: 0,
            velY: 0, jumping: false
        }));
        scoreDisplay.textContent = game.score;
    }
};

// Start game
levelDisplay.textContent = seededLevelName(1);
startLevel(1);
requestAnimationFrame(gameLoop);
