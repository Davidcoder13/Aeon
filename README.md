# Aeon in the browser
https://davidcoder13.github.io/Aeon/  

This is a static browser client. Aeon's move generation, NNUE evaluation, and search compile to WebAssembly and run in a dedicated Web Worker. No engine server or account is involved. The exported network is packaged with the build.

The board uses the vendored `cm-chessboard` 8.15.4 library. It handles responsive SVG rendering, click or drag input, board orientation, and move animations. Aeon remains the authority for legal moves and game state. The library and piece artwork are included locally, so the page does not fetch application dependencies from a CDN. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licenses and attribution.

## Build

Install and activate the Emscripten SDK so `em++` is available in PowerShell, then run from the repository root:

```powershell
./web/build.ps1
```

The default network is `nets/best.bin`. To build with another exported network:

```powershell
./web/build.ps1 -Net "nets/web_h128_candidate.bin"
```

The output goes to `web/dist/` and is ignored by Git.

## Run locally

```powershell
./web/serve.ps1
```

Open `http://localhost:8000/`. The local server only serves static files; all chess calculations happen in the browser. Host the complete `web/` directory as a static site, including `vendor/` and the `dist/` build output.

The engine uses one search thread and WebAssembly SIMD. A separate Web Worker keeps the page responsive during searches. It uses the same packed `.bin` network format as the desktop engine.

## Opponent profiles and saved games

The browser offers Mark, Aeon, and Desperado profiles. They currently share the one network bundled in `dist/aeon.data`; the profiles scale search time to provide relative strength levels. Their Elo ratings have not been measured. Separate trained network files can be added when they are available.

Completed games are saved in IndexedDB in the current browser, with the opponent, final position, result, and UCI move list. Use **Export game archive** to download a JSON archive. This stays on the device unless you export and share it. The records contain game results but no search-score labels, so they need a conversion step before they can join the existing self-play training data.

## Browser integration API

The static page exposes `window.aeonGameAPI` for same-page integrations. It does not create an HTTP server endpoint:

```js
const context = window.aeonGameAPI.getContext();
// context includes FEN, legal moves, lastMove, movesUci, status, and opponent
window.aeonGameAPI.subscribe((event) => console.log(event.detail));
window.aeonGameAPI.receiveText("Your model response", "Model");
```

`receiveText` displays plain text in the page. State updates are also emitted as `aeon:state` browser events. Text is rendered as text, not HTML.
