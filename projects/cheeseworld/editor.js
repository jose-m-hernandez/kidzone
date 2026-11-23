// Cheese World level editor: tap to place things, Play, Save.
// Reaches the game only through window.cheeseworldGame.
(function () {
    'use strict';

    const cw = window.cheeseworldGame;
    const { game, PLATFORM_TYPES, ENEMY_TYPES, LIMITS } = cw;
    const canvas = document.getElementById('gameCanvas');
    const statusText = document.getElementById('editorStatus');
    const STORAGE_KEY = 'cheeseworld.levels.v1';
    const GROUND = { x: 0, y: 460, width: 800, height: 40 };
    const NO_SAVE = "This browser can't save levels. You can still play your level.";

    let draft = emptyDraft();       // { platforms: [{type,x,y}], cheeses: [{x,y}], enemies: [{type,x,plat}] }
    // JSON of the stored level as it was when editing began (or last saved), or null for a new level.
    // The row the child tapped, or null. It is trusted only while that row still holds the original;
    // otherwise the level is found again by what it is, so other tabs can reorder the list.
    let editingOriginal = null;
    let editingIndex = null;
    let playing = null;             // { level, original, index } of the level on screen
    let tool = 'plain';
    let saved = [];
    let armed = null;               // 'clear' or 'delete-N' while waiting for the second tap

    function emptyDraft() {
        return { platforms: [], cheeses: [], enemies: [], bg: 0 };
    }

    // Saved levels
    function readSaved() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.levels)) return [];
            // A level without a good name gets one now, the same one every time it is read.
            return data.levels.map(cw.validateLevel).filter(Boolean).slice(0, LIMITS.levels).map(cw.withName);
        } catch (error) {
            return [];
        }
    }

    function writeSaved(levels) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, levels }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function serialize(source) {
        return {
            platforms: source.platforms.map(p => ({ type: p.type, x: p.x, y: p.y })),
            cheeses: source.cheeses.map(c => ({ x: c.x, y: c.y })),
            enemies: source.enemies.map(e => ({
                type: e.type,
                x: e.x,
                p: e.plat ? source.platforms.indexOf(e.plat) : null
            })),
            bg: source.bg || 0,
            ...(source.name ? { name: source.name } : {})
        };
    }

    function fromLevel(level) {
        const result = { platforms: level.platforms.map(p => ({ ...p })), cheeses: level.cheeses.map(c => ({ ...c })), enemies: [], bg: level.bg || 0, ...(level.name ? { name: level.name } : {}) };
        result.enemies = level.enemies.map(e => ({ type: e.type, x: e.x, plat: e.p === null ? null : result.platforms[e.p] }));
        return result;
    }

    // Messages and views
    function say(message) {
        const counts = 'Platforms ' + draft.platforms.length + '/' + LIMITS.platforms +
            ', Cheese ' + draft.cheeses.length + '/' + LIMITS.cheeses +
            ', Enemies ' + draft.enemies.length + '/' + LIMITS.enemies + '.';
        statusText.textContent = document.body.dataset.view === 'edit' ? (message ? message + ' ' : '') + counts : message || '';
    }

    function setView(view) {
        document.body.dataset.view = view;
        armed = null;
        // A button that kept focus would make the game ignore the arrow keys and Space.
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        if (view === 'edit' || view === 'list') cw.releaseAllControls();
        game.running = view === 'play-seeded' || view === 'play-custom';
    }

    function refresh(message) {
        cw.loadCustomLevel(serialize(draft));
        game.running = false;
        say(message);
    }

    function enterEdit(message) {
        setView('edit');
        refresh(message);
    }

    function leaveToSeeded() {
        if (game.mode === 'custom') cw.startSeededRun();
        setView('play-seeded');
        say('');
    }

    function playLevel(level, original, index) {
        playing = { level, original, index: index === undefined ? null : index };
        cw.loadCustomLevel(level);
        setView('play-custom');
        say('');
    }

    // Tapping
    function topOf(plat) {
        return plat ? plat.y : GROUND.y;
    }

    function rectOf(plat) {
        const size = plat ? PLATFORM_TYPES[plat.type] : GROUND;
        return { x: plat ? plat.x : GROUND.x, y: topOf(plat), w: size.width, h: size.height };
    }

    // The platform (or null for the ground) a tapped spot belongs to, or undefined.
    function platformNear(cx, cy, tolerance) {
        let best;
        let bestGap = Infinity;
        [null, ...draft.platforms].forEach(plat => {
            const r = rectOf(plat);
            if (cx < r.x || cx > r.x + r.w || cy < r.y - 70 || cy > r.y + r.h + tolerance) return;
            if (Math.abs(cy - r.y) < bestGap) {
                best = plat;
                bestGap = Math.abs(cy - r.y);
            }
        });
        return best;
    }

    function enemyRect(enemy) {
        const size = ENEMY_TYPES[enemy.type];
        return { x: enemy.x, y: topOf(enemy.plat) - size.height, w: size.width, h: size.height };
    }

    function hits(r, cx, cy, tolerance) {
        return cx >= r.x - tolerance && cx <= r.x + r.w + tolerance && cy >= r.y - tolerance && cy <= r.y + r.h + tolerance;
    }

    // Where a cheese tapped (or dropped) at this spot would sit: { cheese } or { message }.
    // The cheese being moved, if any, is already out of the draft.
    function cheeseAt(cx, cy, tolerance) {
        const plat = platformNear(cx, cy, tolerance);
        const r = plat === undefined ? null : rectOf(plat);
        const cheese = r
            ? { x: Math.max(r.x, Math.min(r.x + r.w - 25, cx - 12)), y: r.y - 30 }
            : { x: Math.max(8, Math.min(767, cx - 12)), y: Math.max(20, Math.min(430, cy - 10)) };
        if (draft.cheeses.some(c => Math.abs(c.x - cheese.x) < 25 && Math.abs(c.y - cheese.y) < 20)) return { message: 'There is cheese there already.' };
        if (draft.platforms.some(p => cw.coversCheese(p, cheese))) return { message: 'That spot is taken.' };
        return { cheese };
    }

    function addCheese(cx, cy, tolerance) {
        if (draft.cheeses.length >= LIMITS.cheeses) return LIMITS.cheeses + ' cheeses is the most.';
        const result = cheeseAt(cx, cy, tolerance);
        if (result.message) return result.message;
        draft.cheeses.push(result.cheese);
        return '';
    }

    // Where an enemy of this type tapped (or dropped) at this spot would stand: { x, plat } or { message }.
    function enemyAt(type, cx, cy, tolerance) {
        const plat = platformNear(cx, cy, tolerance);
        if (plat === undefined || (plat && plat.type !== 'plain')) return { message: 'Put it on the ground or a plain platform' };
        const width = ENEMY_TYPES[type].width;
        const min = plat ? plat.x : 300;
        const max = plat ? plat.x + PLATFORM_TYPES.plain.width - width : 700;
        return { x: Math.max(min, Math.min(max, cx - width / 2)), plat };
    }

    function addEnemy(cx, cy, tolerance) {
        if (draft.enemies.length >= LIMITS.enemies) return LIMITS.enemies + ' enemies is the most.';
        const result = enemyAt(tool, cx, cy, tolerance);
        if (result.message) return result.message;
        draft.enemies.push({ type: tool, x: result.x, plat: result.plat });
        return '';
    }

    // The topmost thing at a spot: enemy, then cheese, then platform. Null when there is nothing.
    function pick(cx, cy, tolerance) {
        const enemy = draft.enemies.find(e => hits(enemyRect(e), cx, cy, tolerance));
        if (enemy) return { kind: 'enemy', item: enemy };
        const cheese = draft.cheeses.find(c => hits({ x: c.x, y: c.y, w: 25, h: 20 }, cx, cy, tolerance));
        if (cheese) return { kind: 'cheese', item: cheese };
        const platform = draft.platforms.find(p => hits(rectOf(p), cx, cy, tolerance));
        return platform ? { kind: 'platform', item: platform } : null;
    }

    function erase(cx, cy, tolerance) {
        const found = pick(cx, cy, tolerance);
        if (!found) return 'Nothing to erase there.';
        if (found.kind === 'enemy') draft.enemies.splice(draft.enemies.indexOf(found.item), 1);
        else if (found.kind === 'cheese') draft.cheeses.splice(draft.cheeses.indexOf(found.item), 1);
        else {
            draft.platforms.splice(draft.platforms.indexOf(found.item), 1);
            draft.enemies = draft.enemies.filter(e => e.plat !== found.item);
        }
        return 'Erased.';
    }

    // Canvas coordinates (0..800 by 0..500) of a pointer event, and how big a tap is in them.
    function canvasPoint(event) {
        const rect = canvas.getBoundingClientRect();
        const scale = canvas.width / canvas.clientWidth;
        return {
            cx: (event.clientX - rect.left - canvas.clientLeft) * scale,
            cy: (event.clientY - rect.top - canvas.clientTop) * scale,
            tolerance: 22 * scale
        };
    }

    // Drag to move: one item is held between pointerdown and pointerup.
    let drag = null;

    function holdPosition(kind, item) {
        if (kind === 'platform') {
            return { x: item.x, y: item.y, riders: draft.enemies.filter(e => e.plat === item).map(e => [e, e.x]) };
        }
        return kind === 'cheese' ? { x: item.x, y: item.y } : { x: item.x, plat: item.plat };
    }

    function putBack() {
        const { kind, item, from } = drag;
        item.x = from.x;
        if (kind === 'platform') {
            item.y = from.y;
            from.riders.forEach(([rider, x]) => { rider.x = x; });
        } else if (kind === 'cheese') {
            item.y = from.y;
        } else {
            item.plat = from.plat;
        }
    }

    // Try to put the held item where the pointer is. Returns '' on success, else the refusal message.
    // Leaves the item where it was when the drop is refused.
    function dropHeld(event) {
        const { kind, item, from } = drag;
        const { cx, cy, tolerance } = canvasPoint(event);
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        putBack();
        if (Math.abs(dx) + Math.abs(dy) < 4) return '';
        if (kind === 'platform') {
            const others = draft.platforms.filter(p => p !== item);
            const placed = cw.canPlace(others, {
                type: item.type,
                x: Math.round((from.x + dx) / 10) * 10,
                y: Math.round((from.y + dy) / 10) * 10
            }, draft.cheeses);
            if (!placed.ok) return placed.message;
            item.x = placed.platform.x;
            item.y = placed.platform.y;
            from.riders.forEach(([rider, x]) => { rider.x = x + (item.x - from.x); });
            if (!cw.validateLevel(serialize(draft))) {
                putBack();
                return 'That spot is taken.';
            }
            return '';
        }
        // A cheese or an enemy is looked up as if it were being placed, with itself out of the way.
        const list = kind === 'cheese' ? draft.cheeses : draft.enemies;
        const at = list.indexOf(item);
        list.splice(at, 1);
        const centreX = kind === 'cheese' ? from.x + 12.5 + dx : from.x + ENEMY_TYPES[item.type].width / 2 + dx;
        const centreY = kind === 'cheese' ? item.y + 10 + dy : rectOf(from.plat).y - ENEMY_TYPES[item.type].height / 2 + dy;
        const result = kind === 'cheese' ? cheeseAt(centreX, centreY, tolerance) : enemyAt(item.type, centreX, centreY, tolerance);
        list.splice(at, 0, item);
        if (result.message) return result.message;
        if (kind === 'cheese') {
            item.x = result.cheese.x;
            item.y = result.cheese.y;
        } else {
            item.x = result.x;
            item.plat = result.plat;
        }
        return '';
    }

    function startDrag(event) {
        if (document.body.dataset.view !== 'edit') return;
        event.preventDefault();
        armed = null;
        const { cx, cy, tolerance } = canvasPoint(event);
        const found = pick(cx, cy, tolerance);
        if (!found) return;
        drag = { ...found, from: holdPosition(found.kind, found.item), startX: cx, startY: cy, id: event.pointerId };
        canvas.setPointerCapture(event.pointerId);
    }

    function moveHeld(event) {
        if (!drag || event.pointerId !== drag.id) return;
        const { cx, cy } = canvasPoint(event);
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        const { kind, item, from } = drag;
        // The picture follows the pointer; a dropped enemy needs a surface, so it shows where it would land.
        if (kind === 'platform') {
            item.x = from.x + dx;
            item.y = from.y + dy;
            from.riders.forEach(([rider, x]) => { rider.x = x + dx; });
        } else if (kind === 'cheese') {
            item.x = from.x + dx;
            item.y = from.y + dy;
        } else {
            putBack();
            const size = ENEMY_TYPES[item.type];
            const land = enemyAt(item.type, from.x + size.width / 2 + dx, rectOf(from.plat).y - size.height / 2 + dy, canvasPoint(event).tolerance);
            if (!land.message) {
                item.x = land.x;
                item.plat = land.plat;
            }
        }
        refresh('');
    }

    function endDrag(event, cancelled) {
        if (!drag || event.pointerId !== drag.id) return;
        const message = cancelled ? (putBack(), '') : dropHeld(event);
        drag = null;
        refresh(message);
    }

    function tapCanvas(event) {
        if (document.body.dataset.view !== 'edit') return;
        event.preventDefault();
        armed = null;
        const { cx, cy, tolerance } = canvasPoint(event);
        let message = '';
        if (PLATFORM_TYPES[tool]) {
            const size = PLATFORM_TYPES[tool];
            const placed = cw.canPlace(draft.platforms, {
                type: tool,
                x: Math.round((cx - size.width / 2) / 10) * 10,
                y: Math.round((cy - size.height / 2) / 10) * 10
            }, draft.cheeses);
            if (placed.ok) draft.platforms.push(placed.platform);
            else message = placed.message;
        } else if (tool === 'cheese') {
            message = addCheese(cx, cy, tolerance);
        } else if (tool === 'erase') {
            message = erase(cx, cy, tolerance);
        } else {
            message = addEnemy(cx, cy, tolerance);
        }
        refresh(message);
    }

    // Buttons
    function save() {
        if (draft.cheeses.length === 0) return say('Add some cheese first.');
        const checked = cw.validateLevel(serialize(draft));
        if (!checked) return say("That level can't be saved.");
        // A level is named once, the first time it is saved; a re-save keeps the name.
        const level = checked.name ? checked : { ...checked, name: cw.newLevelName() };
        // Read the list again now: another tab may have changed it since this one opened.
        const latest = readSaved();
        const found = editingOriginal === null ? -1 : indexOfLevel(latest, editingOriginal, editingIndex);
        const slot = found >= 0 ? found : latest.length;
        if (slot >= LIMITS.levels) return say(LIMITS.levels + ' levels is the most. Delete one first.');
        // The line is logged before the write, so it still shows when storage fails.
        console.log(cw.LEVEL_LOG_PREFIX + JSON.stringify(level));
        latest[slot] = level;
        if (!writeSaved(latest)) return say(NO_SAVE);
        saved = latest;
        editingOriginal = JSON.stringify(level);
        editingIndex = slot;
        draft.name = level.name;
        say('Saved as ' + level.name + '.');
    }

    // The remembered row if it still holds this level, else the first row that does.
    function indexOfLevel(levels, json, row) {
        if (row !== null && row !== undefined && levels[row] !== undefined && JSON.stringify(levels[row]) === json) return row;
        return levels.findIndex(item => JSON.stringify(item) === json);
    }

    // True when opening another level would lose something the kid made and has not saved.
    function hasUnsavedDraft() {
        if (!draft.platforms.length && !draft.cheeses.length && !draft.enemies.length) return false;
        const level = cw.validateLevel(serialize(draft));
        return JSON.stringify(level || serialize(draft)) !== editingOriginal;
    }

    // Two taps to drop an unsaved draft; true means go ahead and open the other level.
    function mayDropDraft(key) {
        if (!hasUnsavedDraft() || armed === key) return true;
        armed = key;
        say("Tap Edit again to drop the level you're making.");
        return false;
    }

    function play() {
        if (draft.cheeses.length === 0) return say('Add some cheese first.');
        playLevel(serialize(draft), editingOriginal, editingIndex);
    }

    function clearDraft() {
        if (armed !== 'clear') {
            armed = 'clear';
            return say('Tap Clear again to empty the level.');
        }
        draft = emptyDraft();
        editingOriginal = null;
        editingIndex = null;
        armed = null;
        refresh('Cleared.');
    }

    function showList(message) {
        saved = readSaved();
        const list = document.getElementById('levelList');
        list.textContent = '';
        saved.forEach((level, index) => {
            const row = document.createElement('li');
            const name = document.createElement('span');
            name.className = 'level-name';
            name.textContent = level.name;
            row.append(name);
            [['Play', () => playLevel(level, JSON.stringify(level), index)],
                ['Edit', () => openForEdit(level, index)],
                ['Delete', () => deleteLevel(level, index)]].forEach(([label, action]) => {
                const button = document.createElement('button');
                button.className = 'editor-button';
                button.type = 'button';
                button.textContent = label;
                button.addEventListener('click', action);
                row.append(button);
            });
            list.append(row);
        });
        setView('list');
        say(message || (saved.length ? '' : 'No levels yet. Make one!'));
    }

    function openForEdit(level, index) {
        if (!mayDropDraft('edit-' + index)) return;
        draft = fromLevel(level);
        editingOriginal = JSON.stringify(level);
        editingIndex = index;
        enterEdit();
    }

    function deleteLevel(level, index) {
        if (armed !== 'delete-' + index) {
            armed = 'delete-' + index;
            return say('Tap Delete again to remove ' + level.name + '.');
        }
        // Another tab may have changed the list since it was drawn: find this level again by what it is.
        const json = JSON.stringify(level);
        const latest = readSaved();
        const slot = indexOfLevel(latest, json, index);
        if (slot < 0) return showList('That level is already gone.');
        // Write a copy first; the list only changes once the write has worked.
        const remaining = latest.filter((item, at) => at !== slot);
        if (!writeSaved(remaining)) return say(NO_SAVE);
        saved = remaining;
        if (json === editingOriginal) {
            editingOriginal = null;
            editingIndex = null;
        }
        showList();
    }

    function on(id, handler) {
        document.getElementById(id).addEventListener('click', handler);
    }

    // Make a level starts a new level, unless there is unsaved work: then the draft stays in
    // memory while the page is open, so leaving by accident loses nothing (Clear drops it).
    // A draft that is empty, or the same as what is saved, has nothing to lose.
    // An unsaved change to a saved level asks first: the second tap starts a fresh level.
    on('makeLevel', () => {
        saved = readSaved();
        const unsaved = hasUnsavedDraft();
        if (unsaved && editingOriginal !== null) {
            if (armed !== 'make') {
                armed = 'make';
                return say('Tap Make a level again to drop your changes.');
            }
            draft = emptyDraft();
            editingOriginal = null;
            editingIndex = null;
        } else if (!unsaved) {
            draft = emptyDraft();
            editingOriginal = null;
            editingIndex = null;
        }
        enterEdit();
    });
    on('showLevels', () => showList());
    on('showLevelsFromPlay', () => showList());
    on('listBack', leaveToSeeded);
    on('editCurrent', () => {
        // Play on the draft itself: Edit gives back the same thing, so nothing is dropped.
        if (JSON.stringify(serialize(draft)) !== JSON.stringify(playing.level) && !mayDropDraft('edit-current')) return;
        draft = fromLevel(playing.level);
        editingOriginal = playing.original;
        editingIndex = playing.index;
        saved = readSaved();
        enterEdit();
    });
    on('restartCustom', () => playLevel(playing.level, playing.original, playing.index));
    on('editorPlay', play);
    on('editorSave', save);
    on('editorClear', clearDraft);
    on('editorBackground', () => {
        draft.bg = ((draft.bg || 0) + 1) % cw.BACKGROUNDS.length;
        armed = null;
        refresh('Background: ' + cw.BACKGROUNDS[draft.bg] + '.');
    });
    on('editorDone', leaveToSeeded);
    document.querySelectorAll('[data-tool]').forEach(button => {
        button.addEventListener('click', () => {
            tool = button.dataset.tool;
            armed = null;
            document.querySelectorAll('[data-tool]').forEach(other => {
                other.setAttribute('aria-pressed', String(other === button));
            });
        });
    });
    // Editor buttons never keep focus, so the keyboard keeps working after a tap.
    document.addEventListener('pointerdown', event => {
        if (event.target.closest && event.target.closest('.editor-button')) event.preventDefault();
    });
    canvas.addEventListener('pointerdown', event => (tool === 'move' ? startDrag(event) : tapCanvas(event)));
    canvas.addEventListener('pointermove', moveHeld);
    canvas.addEventListener('pointerup', event => endDrag(event, false));
    canvas.addEventListener('pointercancel', event => endDrag(event, true));
    document.addEventListener('cheeseworld:won', () => {
        say('You got all the cheese! Tap Restart to play again.');
    });

    // Ask the browser to warn before leaving with work that is not saved.
    window.addEventListener('beforeunload', event => {
        if (!hasUnsavedDraft()) return;
        event.preventDefault();
        event.returnValue = '';
    });

    window.__cheeseworldTest.readSaved = readSaved;
}());
