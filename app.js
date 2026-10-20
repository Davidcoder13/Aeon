import {
  BORDER_TYPE,
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE
} from "https://cdn.jsdelivr.net/npm/cm-chessboard@8.5.0/src/Chessboard.js";
import {
  Markers,
  MARKER_TYPE
} from "https://cdn.jsdelivr.net/npm/cm-chessboard@8.5.0/src/extensions/markers/Markers.js";
import { Accessibility } from "https://cdn.jsdelivr.net/npm/cm-chessboard@8.5.0/src/extensions/accessibility/Accessibility.js";

const boardElement = document.querySelector("#board");
const messageElement = document.querySelector("#message");
const statusElement = document.querySelector("#engine-status");
const turnElement = document.querySelector("#turn-label");
const lastMoveElement = document.querySelector("#move-label");
const movesElement = document.querySelector("#moves");
const colorSelect = document.querySelector("#human-color");
const timeSelect = document.querySelector("#move-time");
const newGameButton = document.querySelector("#new-game");

const board = new Chessboard(boardElement, {
  position: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
  orientation: COLOR.white,
  assetsUrl: "https://cdn.jsdelivr.net/npm/cm-chessboard@8.5.0/assets/",
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

const markers = board.getExtension(Markers);
const boardSvg = boardElement.querySelector("svg");
boardSvg?.setAttribute("aria-label", "Aeon chessboard");
boardSvg?.setAttribute("aria-roledescription", "chessboard");

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

function setStatus(text, kind = "") {
  statusElement.textContent = text;
  statusElement.className = `engine-status ${kind}`.trim();
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
  markers.removeMarkers();
  if (highlightedMove) {
    markers.addMarker(MARKER_TYPE.square, highlightedMove.slice(0, 2));
    markers.addMarker(MARKER_TYPE.square, highlightedMove.slice(2, 4));
  }
  if (selectedSquare && isHumanTurn()) {
    markers.addMarker(MARKER_TYPE.frame, selectedSquare);
    const targets = legalMoves
      .filter((move) => move.slice(0, 2) === selectedSquare)
      .map((move) => ({ to: move.slice(2, 4), promotion: move[4] ?? null }));
    markers.addLegalMovesMarkers(targets);
  }
}

function render() {
  if (!position) return;
  const [fen, legalLine = "", result = "playing"] = position.split("\n");
  const [placement, side] = fen.split(" ");

  if (board.getPosition() !== placement) void board.setPosition(fen, true);
  if (board.getOrientation() !== humanColor) void board.setOrientation(humanColor, true);

  turnElement.textContent = `${side === "w" ? "White" : "Black"} to move`;
  lastMoveElement.textContent = highlightedMove ? `Last: ${highlightedMove}` : "New game";
  renderMoveList();

  gameOver = result !== "playing";
  boardElement.classList.toggle("locked", thinking || movePending || gameOver || side !== humanColor);
  if (result === "checkmate") {
    messageElement.textContent = side === humanColor ? "Checkmate - Aeon wins." : "Checkmate - you win.";
  } else if (result === "stalemate") {
    messageElement.textContent = "Stalemate.";
  } else if (thinking) {
    messageElement.textContent = "Aeon is thinking...";
  } else if (movePending) {
    messageElement.textContent = "Updating position...";
  } else if (side === humanColor) {
    messageElement.textContent = "Your move.";
  } else {
    messageElement.textContent = "Aeon to move.";
  }
  newGameButton.disabled = thinking || movePending || !ready;
  colorSelect.disabled = thinking || movePending || !ready;
  timeSelect.disabled = thinking || movePending || !ready;
  renderBoardMarkers();
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
      movetime: Number(timeSelect.value)
    });
    if (move.startsWith("ERROR:")) throw new Error(move);
    if (move) {
      history.push(move);
      highlightedMove = move;
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

    // Keep the existing promotion behavior: automatically promote to a queen.
    const move = candidates.find((candidate) => candidate.endsWith("q")) ?? candidates[0];
    history.push(move);
    highlightedMove = move;
    selectedSquare = null;
    movePending = true;
    renderBoardMarkers();
    messageElement.textContent = "Updating position...";
    newGameButton.disabled = true;
    colorSelect.disabled = true;
    timeSelect.disabled = true;
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
  history = [];
  highlightedMove = "";
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
  boardElement.classList.add("locked");
}

board.enableMoveInput(handleMoveInput);
newGameButton.addEventListener("click", () => resetGame().catch(showError));
colorSelect.addEventListener("change", () => resetGame().catch(showError));

worker = new Worker(new URL("./Aeon/engine-worker.js", import.meta.url), { type: "module" });
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
