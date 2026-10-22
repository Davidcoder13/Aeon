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

// Define difficulty profiles (movetime in milliseconds)
const DIFFICULTY_PROFILES = {
  easy: 40,       // Fast, shallow search (drops pieces, misses simple tactics)
  medium: 300,    // Moderate search time
  hard: 1200,     // Default strong play
  master: 3000    // Deep search
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
      // Determine effective movetime based on difficulty selection
      let targetMovetime = DIFFICULTY_PROFILES[difficulty] ?? movetime;

      // Add a slight humanizing jitter (+/- 20%) to lower tiers so response times vary naturally
      if (difficulty === "easy" || difficulty === "medium") {
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
