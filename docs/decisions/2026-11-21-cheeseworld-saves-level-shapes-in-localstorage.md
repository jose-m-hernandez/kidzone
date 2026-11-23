# Cheese World saves level shapes in localStorage

Date: 2026-11-21

> **The rule:** Cheese World may store the player's own level shapes in `localStorage`
> under the key `cheeseworld.levels.v1`, and nothing else. There is no text input and no
> typed name, nothing goes over the network, nothing is shared, and the saved data is never read
> or sent anywhere except back into the same game on the same browser.

Each Save also prints the level's shapes to this browser's console, so a person can copy them by hand; the game sends nothing. A level's shape also stores a background number (0-3). A level's shape may also store a generated name, never typed text, and only names matching the generator's pattern are kept.

## Why

- The generated levels are too hard for players, so Cheese World gets an
  in-game level editor, and a level someone made has to survive a page reload.
- The maintainer gave the word for browser storage on 2026-11-21 at 21:18: "Yes, save
  levels", for level shapes only, with no text input and the privacy text updated.
- `docs/NEXT.md` says "no saved kid data until a project needs it explicitly". The saved
  data is geometry only (platform types and positions, cheese positions, enemy types and
  positions), so it holds nothing about the child.
- `project.json` now declares `storesData: true` and the privacy text says what is saved.
  `scripts/check.mjs` ties the two together.
