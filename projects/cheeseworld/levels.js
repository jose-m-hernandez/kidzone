// Default levels for Cheese World.
// Levels 1..N play from this list, in order, where N is how many entries it holds.
// Level N+1 and later are generated from the seed, as before. An empty list means
// every level is generated, which is how the game shipped.
//
// To add a level: build it with Make a level, press Save, open the browser console
// and copy the line that starts with CHEESEWORLD_LEVEL. Paste what follows that
// prefix (the {...} part) as one more entry in the list below, in a normal pull request.
// Entries go through the same checks as saved levels. A bad entry is skipped and that
// level number is generated from the seed instead (the console shows a warning).
window.CHEESEWORLD_DEFAULT_LEVELS = [
];
