# Kidzone

A small open-source playground where kids make web games and creative tools with a trusted adult.

Play it: https://jose-m-hernandez.github.io/kidzone/

Built by Jose Miguel Hernandez (https://jose.io) with dezi-bot and a crew of young game designers.

The projects are meant to be simple enough to open, read, change, and share.
Most of them use plain HTML, CSS, and JavaScript, so a first contribution can be
as small as changing a color, adding a level, editing some text, or inventing a
new rule.

## For Coding Kids

Welcome. This is a place to make things.

Good first ideas:

- Change how a game looks.
- Add a new level.
- Rename a button.
- Make a character move differently.
- Build a tiny new game in `projects/<your-game-name>/`.

Try to keep your project kind, clear, and fun to explore. A good Kidzone project
helps someone make, solve, decorate, experiment, or learn.

## For Parents And Helpers

Kidzone is designed for parent-assisted coding. The repo favors:

- Play with no accounts or chat.
- No public sharing features inside games.
- Static projects that can run on GitHub Pages.
- Clear project metadata for age fit, privacy, storage, network access, and
  adult-help notes.
- Small pull requests that kids can understand and talk through.

Please help kids avoid adding personal information, photos of themselves,
addresses, school names, private API keys, or open-ended communication features.

## How It's Built

Kids bring the idea. An AI coding agent builds a rough first draft. Then the kid and a parent iterate together: they play it, talk about how they want the game to work, and make refinements, with the parent reviewing and guiding each step. Kidzone is as much about that creative back-and-forth as it is about agentic coding.

The guardrails:

- `skills/kidzone-new-game` starts every new game with questions: what the player does, what makes it fun, and what it must never do. The skill writes a short parent review of the plan, and for riskier ideas stops for approval before building.
- `skills/kidzone-game-iteration` handles changes to an existing game, one small pull request at a time.
- `AGENTS.md` gives any agent the house rules: no network, storage, camera, microphone or sharing unless the project declares it, and controls that really work.
- `scripts/check.mjs` runs on every push and pull request (`.github/workflows/checks.yml`). It checks the declarations it can see: external URLs, camera use, file upload, and browser storage.
- Most games have Playwright tests that play the main path, so a game that can't be won, or controls that stop working, turn up when someone runs them (see Run The Tests). CI runs only `check.mjs`, not these tests.

## Play Locally

You need Node.js (tried with v24). Run the static preview server from this folder:

```sh
node ./server.mjs
```

Then open:

```text
http://127.0.0.1:4173
```

If that port is busy:

```sh
PORT=4174 node ./server.mjs
```

## Add A New Mini-Project

Create a project from the template:

```sh
node ./scripts/new-project.mjs sky-catcher "Sky Catcher"
```

This creates a real project folder and refreshes `projects/index.json`:

```text
projects/sky-catcher/
  index.html
  project.json
  README.md
  styles.css
```

To undo the example, delete `projects/sky-catcher/` and run
`node ./scripts/update-project-index.mjs`.

Keep the project self-contained in its folder. Use relative links like
`./styles.css`, `./assets/star.png`, and `../../` so the project works locally
and on GitHub Pages.

Before publishing, update `project.json` using the
[Kidzone project contract](./projects/PROJECT_CONTRACT.md). That metadata helps
parents and maintainers see what a project does before a kid plays it.

## Before You Open A Pull Request

Refresh the project shelf if you changed project metadata:

```sh
node ./scripts/update-project-index.mjs
```

Run the checks:

```sh
node ./scripts/check.mjs
```

The check looks for stale project metadata, JavaScript syntax errors, undeclared
external URLs, and privacy-sensitive features that are missing from
`project.json`.

## Run The Tests

Logic tests use Node's built-in runner and need no install:

```sh
node --test
```

Browser tests use Playwright. Install the package and Chromium once (the
Chromium download is about 90 MB):

```sh
npm install
npm run snapshots:install
```

Run one game's browser tests:

```sh
npx playwright test tests/brush-max.spec.mjs --global-timeout=280000
```

`npm run snapshots` runs `playwright test`, which runs every spec in `tests/`,
including the screenshot spec, and takes several minutes. To capture only a
screenshot of every published project:

```sh
npx playwright test tests/project-snapshots.spec.mjs
```

Screenshots are written to `snapshots/projects/`, which is ignored by Git.
Playwright starts its own preview server on port 4173, or reuses one already
running there.

## What It Does Not Do

- No accounts, chat, comments, or sharing features. No project code sends data
  to a server of its own.
- No backend. Every project is static (`runtime.type` in `project.json`);
  `server.mjs` only serves the files on your computer.
- Almost no saved data. Only Cheese World saves anything: the level shapes a
  player builds, in this browser's `localStorage` (`cheeseworld.levels.v1`).
  There is no typed text, and nothing leaves the browser. Every other project
  has `runtime.storesData` set to `false`.
- No hidden network use. Some games load a library from a public CDN (today
  `splat-lab` and `world-of-poo`), so they need a connection;
  `runtime.networkAccess` and `externalDependencies` in their `project.json`
  say so.
- No microphone. Camera and file upload appear only in games that list them
  under `interaction` in `project.json`.

## Project Shape

```text
kidzone/
  index.html
  projects/
    <project-slug>/
      index.html
      project.json
```

Each mini-project gets its own folder under `projects/`. Shared infrastructure
should stay small until more than one project truly needs it.

## Helpful Links

- [Contributing](./CONTRIBUTING.md)
- [Kidzone project contract](./projects/PROJECT_CONTRACT.md)
- [Next ideas](./docs/NEXT.md)

## License

Kidzone is open source under the [MIT License](./LICENSE).
