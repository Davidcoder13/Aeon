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

self.onmessage = (event) => {
  const { id, action, moves = "", movetime = 1200 } = event.data;
  if (!state) {
    self.postMessage({ id, error: "Aeon failed to initialize. Check the browser console." });
    return;
  }
  try {
    let result;
    if (action === "state") result = state(moves);
    else if (action === "search") result = search(moves, movetime);
    else if (action === "new-game") { newGame(); result = true; }
    else throw new Error(`Unknown worker action: ${action}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
