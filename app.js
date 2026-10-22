import {
  BORDER_TYPE,
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE
} from "https://cdn.jsdelivr.net/npm/cm-chessboard@latest/src/Chessboard.js";
import {
  Markers,
  MARKER_TYPE
} from "https://cdn.jsdelivr.net/npm/cm-chessboard@latest/src/extensions/markers/Markers.js";
import { Accessibility } from "https://cdn.jsdelivr.net/npm/cm-chessboard@latest/src/extensions/accessibility/Accessibility.js";

const boardElement = document.querySelector("#board");
const messageElement = document.querySelector("#message");
const statusElement = document.querySelector("#engine-status");
const turnElement = document.querySelector("#turn-label");
const lastMoveElement = document.querySelector("#move-label");
const movesElement = document.querySelector("#moves");
const colorSelect = document.querySelector("#human-color");
const timeSelect = document.querySelector("#move-time");
const difficultySelect = document.querySelector("#difficulty");
const newGameButton = document.querySelector("#new-game");
const commentaryElement = document.querySelector("#model-commentary");
const archiveStatusElement = document.querySelector("#archive-status");
const exportGamesButton = document.querySelector("#export-games");

const board = new Chessboard(boardElement, {
  position: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
  orientation: COLOR.white,
  assetsUrl: "https://cdn.jsdelivr.net/npm/cm-chessboard@latest/assets/",
  style: {
    cssClass: "aeon",
    borderType: BORDER_TYPE.none,
    showCoordinates: true,
    aspectRatio: 1,
    pieces: { file: "pieces/standard.svg", tileSize: 40 },
    animationDuration: 180
  },
  extensions: [
    { class: Markers, props: { autoMarkers: null } },
    { class: Accessibility, props: { keyboardMoveInput: true, visuallyHidden: true } }
  ]
});

const boardSvg = boardElement.querySelector("svg");
boardSvg?.setAttribute("aria-label", "Aeon chessboard");
boardSvg?.setAttribute("aria-roledescription", "chessboard");

const SVG_NS = "http://www.w3.org/2000/svg";
const arrowOverlay = document.createElementNS(SVG_NS, "svg");
arrowOverlay.classList.add("user-arrows");
arrowOverlay.setAttribute("viewBox", "0 0 8 8");
arrowOverlay.setAttribute("preserveAspectRatio", "none");
arrowOverlay.setAttribute("aria-hidden", "true");
const arrowDefs = document.createElementNS(SVG_NS, "defs");
const arrowHead = document.createElementNS(SVG_NS, "marker");
arrowHead.id = "user-arrow-head";
arrowHead.setAttribute("markerWidth", "0.48");
arrowHead.setAttribute("markerHeight", "0.48");
arrowHead.setAttribute("markerUnits", "userSpaceOnUse");
arrowHead.setAttribute("refX", "0.42");
arrowHead.setAttribute("refY", "0.24");
arrowHead.setAttribute("orient", "auto");
arrowHead.setAttribute("viewBox", "0 0 0.48 0.48");
const arrowHeadShape = document.createElementNS(SVG_NS, "path");
arrowHeadShape.setAttribute("d", "M 0 0 L 0.48 0.24 L 0 0.48 z");
arrowHeadShape.setAttribute("fill", "#f2cc4d");
arrowHead.append(arrowHeadShape);
arrowDefs.append(arrowHead);
arrowOverlay.append(arrowDefs);
boardElement.append(arrowOverlay);

let worker;
let requestId = 0;
const pending = new Map();
let history = [];
let position = null;
let legalMoves = [];
let selectedSquare = null;
let highlightedMove = "";
let humanColor = "w";
let thinking = false;
let movePending = false;
let ready = false;
let gameOver = false;
let arrows = [];
let arrowStart = null;
let currentGameId = createGameId();
const savedGameIds = new Set();
const savingGameIds = new Set();
let gameStartedAt = new Date().toISOString();
let currentOpponentId = difficultySelect?.value ?? "aeon";

const OPPONENTS = {
  mark: { name: "Mark", description: "casual" },
  aeon: { name: "Aeon", description: "standard" },
  desperado: { name: "Desperado", description: "deep search" }
};

const archiveDatabase = openArchiveDatabase();

function setStatus(text, kind = "") {
  statusElement.textContent = text;
  statusElement.className = `engine-status ${kind}`.trim();
}

function openArchiveDatabase() {
  if (!window.indexedDB) return Promise.reject(new Error("IndexedDB is unavailable"));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open("aeon-local-games", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("games")) {
        const store = db.createObjectStore("games", { keyPath: "id" });
        store.createIndex("completedAt", "completedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local game archive"));
  });
}

function withArchiveStore(mode, action) {
  return archiveDatabase.then((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction("games", mode);
    const request = action(transaction.objectStore("games"));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("Game archive request failed"));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("Game archive transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Game archive transaction aborted"));
  }));
}

function createGameId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function refreshArchiveStatus() {
  try {
    const count = await withArchiveStore("readonly", (store) => store.count());
    archiveStatusElement.textContent = `${count} completed ${count === 1 ? "game" : "games"} saved on this device`;
    exportGamesButton.disabled = count === 0;
  } catch {
    archiveStatusElement.textContent = "Local game saving is unavailable in this browser";
    exportGamesButton.disabled = true;
  }
}

function getGameContext() {
  const [fen = null, legalLine = "", result = "loading"] = (position ?? "").split("\n");
  return {
    fen,
    sideToMove: fen?.split(" ")[1] ?? null,
    legalMoves: legalLine ? legalLine.split(" ") : [],
    lastMove: highlightedMove || null,
    movesUci: [...history],
    status: result,
    opponent: OPPONENTS[currentOpponentId]?.name ?? "Aeon",
    model: "aeon-default"
  };
}

function receiveModelText(text, speaker = OPPONENTS[currentOpponentId]?.name ?? "Aeon") {
  if (typeof text !== "string") throw new TypeError("Model text must be a string");
  const safeText = text.trim().slice(0, 500);
  if (!safeText) return false;
  const safeSpeaker = String(speaker).trim().slice(0, 40) || "Aeon";
  const label = document.createElement("strong");
  label.textContent = `${safeSpeaker}: `;
  commentaryElement.replaceChildren(label, document.createTextNode(safeText));
  return true;
}

window.aeonGameAPI = Object.freeze({
  getContext: getGameContext,
  getBoardState: () => getGameContext().fen,
  getLastMove: () => getGameContext().lastMove,
  receiveText: receiveModelText,
  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("Listener must be a function");
    window.addEventListener("aeon:state", listener);
    return () => window.removeEventListener("aeon:state", listener);
  }
});

function publishGameContext() {
  window.dispatchEvent(new CustomEvent("aeon:state", { detail: getGameContext() }));
}

function squareAtPointer(event) {
  const rect = boardSvg?.getBoundingClientRect();
  if (!rect || event.clientX < rect.left || event.clientX >= rect.right ||
      event.clientY < rect.top || event.clientY >= rect.bottom) return null;
  const column = Math.floor(((event.clientX - rect.left) / rect.width) * 8);
  const row = Math.floor(((event.clientY - rect.top) / rect.height) * 8);
  const file = humanColor === "w" ? column : 7 - column;
  const rank = humanColor === "w" ? 7 - row : row;
  return `${String.fromCharCode(97 + file)}${rank + 1}`;
}

function squareCenter(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return humanColor === "w"
    ? { x: file + 0.5, y: 7 - rank + 0.5 }
    : { x: 7 - file + 0.5, y: rank + 0.5 };
}

function renderUserArrows() {
  arrowOverlay.querySelectorAll("line").forEach((line) => line.remove());
  for (const arrow of arrows) {
    const from = squareCenter(arrow.from);
    const to = squareCenter(arrow.to);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", from.x);
    line.setAttribute("y1", from.y);
    line.setAttribute("x2", to.x);
    line.setAttribute("y2", to.y);
    line.setAttribute("marker-end", "url(#user-arrow-head)");
    arrowOverlay.append(line);
  }
}

boardElement.addEventListener("contextmenu", (event) => event.preventDefault());
boardElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 2) return;
  event.preventDefault();
  event.stopPropagation();
  arrowStart = squareAtPointer(event);
  if (arrowStart) boardElement.setPointerCapture?.(event.pointerId);
}, true);
window.addEventListener("pointerup", (event) => {
  if (!arrowStart) return;
  const from = arrowStart;
  const to = squareAtPointer(event);
  arrowStart = null;
  if (!to || from === to) return;
  const existing = arrows.findIndex((arrow) => arrow.from === from && arrow.to === to);
  if (existing >= 0) arrows.splice(existing, 1);
  else arrows.push({ from, to });
  renderUserArrows();
});

async function saveCompletedGame(resultCode) {
  const gameId = currentGameId;
  if (savedGameIds.has(gameId) || savingGameIds.has(gameId)) return;
  savingGameIds.add(gameId);

  const fen = position.split("\n")[0];
  const sideToMove = fen.split(" ")[1];
  let result = "1/2-1/2";
  if (resultCode === "checkmate") {
    const humanWon = sideToMove !== humanColor;
    result = humanWon ? (humanColor === "w" ? "1-0" : "0-1") : (humanColor === "w" ? "0-1" : "1-0");
  }
  const record = {
    id: gameId,
    schema: "aeon-game-v1",
    startedAt: gameStartedAt,
    completedAt: new Date().toISOString(),
    opponent: OPPONENTS[currentOpponentId]?.name ?? "Aeon",
    model: "aeon-default",
    humanColor,
    result,
    finalFen: fen,
    movesUci: [...history]
  };
  try {
    await withArchiveStore("readwrite", (store) => store.add(record));
    savedGameIds.add(gameId);
    await refreshArchiveStatus();
  } catch (error) {
    archiveStatusElement.textContent = `Could not save this game: ${error.message ?? error}`;
  } finally {
    savingGameIds.delete(gameId);
  }
}

async function exportGameArchive() {
  try {
    const games = await withArchiveStore("readonly", (store) => store.getAll());
    games.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const blob = new Blob([JSON.stringify({ schema: "aeon-training-archive-v1", games }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aeon-games-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    archiveStatusElement.textContent = `Could not export games: ${error.message}`;
  }
}

function request(action, values = {}) {
  if (!worker) return Promise.reject(new Error("Engine worker is unavailable"));
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...values });
  });
}

function currentSide() {
  return position?.split("\n")[0]?.split(" ")[1] ?? "w";
}

function isHumanTurn() {
  return ready && !thinking && !movePending && !gameOver && currentSide() === humanColor;
}

function renderBoardMarkers() {
  const markersExt = board.getExtension(Markers);
  if (!markersExt) return;

  markersExt.removeMarkers();
  
  if (highlightedMove) {
    markersExt.addMarker(MARKER_TYPE.square, highlightedMove.slice(0, 2));
    markersExt.addMarker(MARKER_TYPE.square, highlightedMove.slice(2, 4));
  }

  if (selectedSquare && isHumanTurn()) {
    markersExt.addMarker(MARKER_TYPE.frame, selectedSquare);
    const targets = legalMoves
      .filter((move) => move.slice(0, 2) === selectedSquare)
      .map((move) => ({ to: move.slice(2, 4), promotion: move[4] ?? null }));
    
    if (typeof markersExt.addLegalMovesMarkers === "function") {
      markersExt.addLegalMovesMarkers(targets);
    } else if (typeof markersExt.showLegalMoves === "function") {
      markersExt.showLegalMoves(targets);
    }
  }
}

function render() {
  if (!position) return;
  const [fen, legalLine = "", result = "playing"] = position.split("\n");
  const [placement, side] = fen.split(" ");
  const opponentName = OPPONENTS[currentOpponentId]?.name ?? "Aeon";

  if (board.getPosition() !== placement) void board.setPosition(fen, true);
  if (board.getOrientation() !== humanColor) void board.setOrientation(humanColor, true);

  turnElement.textContent = `${side === "w" ? "White" : "Black"} to move`;
  lastMoveElement.textContent = highlightedMove ? `Last: ${highlightedMove}` : "New game";
  renderMoveList();

  gameOver = result !== "playing";
  boardElement.classList.toggle("locked", thinking || movePending || gameOver || side !== humanColor);
  
  if (result === "checkmate") {
    messageElement.textContent = side === humanColor ? `Checkmate - ${opponentName} wins.` : "Checkmate - you win.";
  } else if (result === "stalemate") {
    messageElement.textContent = "Stalemate.";
  } else if (thinking) {
    messageElement.textContent = `${opponentName} is thinking...`;
  } else if (movePending) {
    messageElement.textContent = "Updating position...";
  } else if (side === humanColor) {
    messageElement.textContent = "Your move.";
  } else {
    messageElement.textContent = `${opponentName} to move.`;
  }

  if (gameOver && (result === "checkmate" || result === "stalemate")) {
    void saveCompletedGame(result);
  }

  newGameButton.disabled = thinking || movePending || !ready;
  colorSelect.disabled = thinking || movePending || !ready;
  timeSelect.disabled = thinking || movePending || !ready;
  if (difficultySelect) difficultySelect.disabled = thinking || movePending || !ready || history.length > 0;
  
  renderBoardMarkers();
  renderUserArrows();
  publishGameContext();
}

function renderMoveList() {
  movesElement.replaceChildren();
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    li.textContent = `${Math.floor(i / 2) + 1}. ${history[i]}${history[i + 1] ? `  ${history[i + 1]}` : ""}`;
    movesElement.append(li);
  }
  movesElement.scrollTop = movesElement.scrollHeight;
}

async function refresh(searchIfNeeded = true) {
  const result = await request("state", { moves: history.join(" ") });
  if (result.startsWith("ERROR:")) throw new Error(result);
  position = result;
  const parts = result.split("\n");
  legalMoves = parts[1] ? parts[1].split(" ") : [];
  selectedSquare = null;
  movePending = false;
  render();
  const side = parts[0].split(" ")[1];
  if (searchIfNeeded && !gameOver && side !== humanColor && !thinking) await engineMove();
}

async function engineMove() {
  thinking = true;
  render();
  try {
    const move = await request("search", {
      moves: history.join(" "),
      movetime: Number(timeSelect.value),
      difficulty: currentOpponentId
    });
    if (move.startsWith("ERROR:")) throw new Error(move);
    if (move) {
      history.push(move);
      highlightedMove = move;
      arrows = [];
      movePending = true;
    }
  } finally {
    thinking = false;
  }
  await refresh(false);
}

function handleMoveInput(event) {
  if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
    if (!isHumanTurn() || !legalMoves.some((move) => move.slice(0, 2) === event.squareFrom)) return false;
    selectedSquare = event.squareFrom;
    renderBoardMarkers();
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
    if (!isHumanTurn()) return false;
    const candidates = legalMoves.filter((move) =>
      move.slice(0, 2) === event.squareFrom && move.slice(2, 4) === event.squareTo);
    if (!candidates.length) return false;

    const move = candidates.find((candidate) => candidate.endsWith("q")) ?? candidates[0];
    history.push(move);
    highlightedMove = move;
    arrows = [];
    selectedSquare = null;
    movePending = true;
    renderBoardMarkers();
    messageElement.textContent = "Updating position...";
    newGameButton.disabled = true;
    colorSelect.disabled = true;
    timeSelect.disabled = true;
    if (difficultySelect) difficultySelect.disabled = true;
    boardElement.classList.add("locked");
    void refresh().catch(showError);
    return true;
  }

  if (event.type === INPUT_EVENT_TYPE.moveInputCanceled) {
    selectedSquare = null;
    renderBoardMarkers();
  }
  return undefined;
}

async function resetGame() {
  if (thinking || movePending || !ready) return;
  humanColor = colorSelect.value;
  currentOpponentId = difficultySelect?.value ?? "aeon";
  history = [];
  highlightedMove = "";
  arrows = [];
  currentGameId = createGameId();
  gameStartedAt = new Date().toISOString();
  commentaryElement.replaceChildren();
  selectedSquare = null;
  await board.setOrientation(humanColor, true);
  await request("new-game");
  await refresh();
}

function showError(error) {
  ready = false;
  setStatus("Engine error", "error");
  messageElement.textContent = error?.message ?? String(error);
  newGameButton.disabled = true;
  colorSelect.disabled = true;
  timeSelect.disabled = true;
  if (difficultySelect) difficultySelect.disabled = true;
  boardElement.classList.add("locked");
}

board.enableMoveInput(handleMoveInput);
newGameButton.addEventListener("click", () => resetGame().catch(showError));
colorSelect.addEventListener("change", () => resetGame().catch(showError));
exportGamesButton.addEventListener("click", () => exportGameArchive());
difficultySelect?.addEventListener("change", () => {
  currentOpponentId = difficultySelect.value;
  publishGameContext();
});
void refreshArchiveStatus();
boardElement.addEventListener("pointercancel", () => { arrowStart = null; });

worker = new Worker(new URL("engine-worker.js", import.meta.url), { type: "module" });
worker.onmessage = (event) => {
  const data = event.data;
  if (data.type === "ready") {
    ready = true;
    setStatus("Engine ready", "ready");
    refresh().catch(showError);
    return;
  }
  if (data.type === "init-error") {
    showError(new Error(data.message));
    return;
  }
  if (data.type === "log") {
    console.warn("Aeon:", data.message);
    return;
  }
  const task = pending.get(data.id);
  if (!task) return;
  pending.delete(data.id);
  if (data.error) task.reject(new Error(data.error));
  else task.resolve(data.result);
};

worker.onerror = (event) => {
  console.error("Worker failed to load or run. File path or syntax issue.", event);
  showError(new Error(`Worker error: ${event.filename || 'unknown script'} line ${event.lineno || 0}`));
};
