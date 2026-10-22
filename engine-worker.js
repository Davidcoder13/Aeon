import createAeonModule from "./dist/aeon.js";

let state = null;
let search = null;
let newGame = null;

try {
  const module = await createAeonModule({
    locateFile: (path) => new URL(`./dist/${path}`, import.meta.url).href,
    printErr: (message) => self.postMessage({ type: "log", message })
  });
  state = module.cwrap("aeon_state", "string", ["string"]);
  search = module.cwrap("aeon_search", "string", ["string", "number"]);
  newGame = module.cwrap("aeon_new_game", null, []);
  self.postMessage({ type: "ready" });
} catch (error) {
  self.postMessage({ type: "init-error", message: String(error) });
}

// Named opponents currently share the shipped network. Their relative strength
// comes from search time until separate trained networks are added.
const OPPONENT_PROFILES = {
  mark: { multiplier: 0.12, jitter: true },
  aeon: { multiplier: 1, jitter: false },
  desperado: { multiplier: 2.5, jitter: false }
};

self.onmessage = (event) => {
  const { id, action, moves = "", movetime = 1200, difficulty = "hard" } = event.data;
  
  if (!state) {
    self.postMessage({ id, error: "Aeon failed to initialize. Check the browser console." });
    return;
  }

  try {
    let result;
    if (action === "state") {
      result = state(moves);
    } 
    else if (action === "search") {
      // Scale the selected base time by opponent profile.
      const profile = OPPONENT_PROFILES[difficulty] ?? OPPONENT_PROFILES.aeon;
      let targetMovetime = Math.max(100, Math.min(8000, Math.round(movetime * profile.multiplier)));

      // Add mild timing variation to Mark's quick search.
      if (profile.jitter) {
        const jitter = (Math.random() * 0.4) - 0.2; 
        targetMovetime = Math.max(20, Math.round(targetMovetime * (1 + jitter)));
      }

      result = search(moves, targetMovetime);
    } 
    else if (action === "new-game") {
      newGame();
      result = true;
    } 
    else {
      throw new Error(`Unknown worker action: ${action}`);
    }

    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
