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
