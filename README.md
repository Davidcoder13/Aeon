# Aeon in the browser
https://davidcoder13.github.io/Aeon/  

This is a static browser client. Aeon's move generation, NNUE evaluation, and search compile to WebAssembly and run in a dedicated Web Worker. No engine server or account is involved. The exported network is packaged with the build.

The board uses the vendored `cm-chessboard` 8.15.4 library. It handles responsive SVG rendering, click or drag input, board orientation, and move animations. Aeon remains the authority for legal moves and game state. The library and piece artwork are included locally, so the page does not fetch application dependencies from a CDN. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for licenses and attribution.

## Build

Install and activate the Emscripten SDK so `em++` is available in PowerShell, then run from the repository root:

```powershell
./build.ps1
```

The default network is `nets/best.bin`. To build with another exported network:

```powershell
./build.ps1 -Net "nets/web_h128_candidate.bin"
```

The output goes to `dist/` and is ignored by Git.

## Run locally

```powershell
./serve.ps1
```

Open `http://localhost:8000/`. The local server only serves static files; all chess calculations happen in the browser. Host the complete repository directory as a static site, including `vendor/` and the `dist/` build output.

The engine uses one search thread and WebAssembly SIMD. A separate Web Worker keeps the page responsive during searches. It uses the same packed `.bin` network format as the desktop engine.

## Opponent profiles

The browser offers Mark, Aeon, and Desperado profiles. They currently share the one network bundled in `dist/aeon.data`; the profiles scale search time to provide relative strength levels and feature distinct commentary personalities. Separate trained network files can be added when they are available.

## Browser integration API

The static page exposes `window.aeonGameAPI` for same-page integrations. It does not create an HTTP server endpoint:

```js
const context = window.aeonGameAPI.getContext();
// context includes FEN, legal moves, lastMove, movesUci, status, and opponent
window.aeonGameAPI.subscribe((event) => console.log(event.detail));
window.aeonGameAPI.receiveText("Your model response", "Model");
```

`receiveText` displays plain text in the page. State updates are also emitted as `aeon:state` browser events. Text is rendered as text, not HTML.
