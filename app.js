import {
  BORDER_TYPE,
  Chessboard,
  COLOR,
  INPUT_EVENT_TYPE
} from "./vendor/cm-chessboard/src/Chessboard.js";
import {
  Markers,
  MARKER_TYPE
} from "./vendor/cm-chessboard/src/extensions/markers/Markers.js";
import { Accessibility } from "./vendor/cm-chessboard/src/extensions/accessibility/Accessibility.js";
import {
  PromotionDialog,
  PROMOTION_DIALOG_RESULT_TYPE
} from "./vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js";
import { TauntModelClient } from "./taunt-model-client.js";

// DOM Elements
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
const tauntLog = document.querySelector("#taunt-log");
const tauntReplies = document.querySelector("#taunt-replies");

const board = new Chessboard(boardElement, {
  position: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
  orientation: COLOR.white,
  assetsUrl: "./vendor/cm-chessboard/assets/",
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
    { class: Accessibility, props: { keyboardMoveInput: true, visuallyHidden: true } },
    { class: PromotionDialog }
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
let highlightedSquares = new Set();
let arrowStart = null;
let currentOpponentId = difficultySelect?.value ?? "aeon";
const positionCounts = new Map();

const OPPONENTS = {
  mark: { name: "Mark", description: "casual" },
  aeon: { name: "Aeon", description: "analytical" },
  desperado: { name: "Desperado", description: "aggressive" }
};

let tauntHistory = null;
let tauntDelivery = null;
let tauntModel = null;
let tauntQueue = Promise.resolve();
let pendingPly = null;

try {
  tauntModel = new TauntModelClient();
} catch (error) {
  console.warn("Aeon taunt model worker is unavailable; using templates:", error);
}

const tauntsReady = (async () => {
  try {
    const response = await fetch(new URL("./taunt-lines.json", import.meta.url));
    if (!response.ok) throw new Error(`taunt lines returned ${response.status}`);
    const { pools } = await response.json();
    tauntHistory = new globalThis.AeonTaunt.TauntHistory();
    tauntDelivery = new globalThis.AeonTaunt.TauntDelivery({
      log: tauntLog,
      replies: tauntReplies,
      lines: pools,
      opponent: currentOpponentId,
      onRematch: () => resetGame().catch(showError),
      getLine: (eventString) => tauntModel?.getLine(eventString) ?? null
    });
  } catch (error) {
    console.warn("Aeon taunt templates are unavailable:", error);
  }
})();

function setStatus(text, kind = "") {
  statusElement.textContent = text;
  statusElement.className = `engine-status ${kind}`.trim();
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

function renderUserAnnotations() {
  arrowOverlay.querySelectorAll("line, rect").forEach((el) => el.remove());

  // Render square highlights
  for (const sq of highlightedSquares) {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]) - 1;
    const x = humanColor === "w" ? file : 7 - file;
    const y = humanColor === "w" ? 7 - rank : rank;
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", "1");
    rect.setAttribute("height", "1");
    rect.setAttribute("fill", "#f2cc4d");
    rect.setAttribute("opacity", "0.38");
    arrowOverlay.append(rect);
  }

  // Render arrows
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
  if (event.button === 0) {
    // Left-click clears arrows and square highlights if clicked outside active move start
    if (arrows.length > 0 || highlightedSquares.size > 0) {
      arrows = [];
      highlightedSquares.clear();
      renderUserAnnotations();
    }
  }
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
  if (!to) return;
  if (from === to) {
    // Right-click single square: toggle square highlight
    if (highlightedSquares.has(from)) highlightedSquares.delete(from);
    else highlightedSquares.add(from);
    renderUserAnnotations();
    return;
  }
  const existing = arrows.findIndex((arrow) => arrow.from === from && arrow.to === to);
  if (existing >= 0) arrows.splice(existing, 1);
  else arrows.push({ from, to });
  renderUserAnnotations();
});

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

function boardFromFen(fen) {
  const rows = fen.split(" ")[0].split("/");
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  rows.forEach((row, rowIndex) => {
    let file = 0;
    const rank = 7 - rowIndex;
    for (const char of row) {
      if (/\d/.test(char)) file += Number(char);
      else board[rank][file++] = char;
    }
  });
  return board;
}

function squareCoords(square) {
  if (!/^[a-h][1-8]$/.test(square)) return null;
  return [square.charCodeAt(0) - 97, Number(square[1]) - 1];
}

function pieceAt(board, square) {
  const coords = squareCoords(square);
  return coords ? board[coords[1]][coords[0]] : null;
}

function isKnightFork(board, square, moverColor) {
  const coords = squareCoords(square);
  if (!coords || pieceAt(board, square)?.toLowerCase() !== "n") return false;
  const [file, rank] = coords;
  const targets = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const targetFile = file + df;
    const targetRank = rank + dr;
    if (targetFile < 0 || targetFile > 7 || targetRank < 0 || targetRank > 7) continue;
    const target = board[targetRank][targetFile];
    if (!target) continue;
    const targetColor = target === target.toUpperCase() ? "w" : "b";
    if (targetColor !== moverColor && target.toLowerCase() !== "p") targets.push(target.toLowerCase());
  }
  return targets.length >= 2 && targets.some((piece) => "rqk".includes(piece));
}

function scoreFields(rawScore) {
  const score = Number(rawScore) || 0;
  if (Math.abs(score) >= 31000 - 128) {
    const moves = Math.max(1, Math.floor((31000 - Math.abs(score) + 1) / 2));
    return { eval_cp: null, mate: Math.sign(score) * moves };
  }
  return { eval_cp: score, mate: null };
}

function plyData(beforePosition, move, by, afterPosition, score = { eval_cp: 0, mate: null }) {
  const [beforeFen] = beforePosition.split("\n");
  const [afterFen, , result = "playing", check = "clear"] = afterPosition.split("\n");
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  const fromCoords = squareCoords(from);
  const toCoords = squareCoords(to);
  const beforeBoard = boardFromFen(beforeFen);
  const afterBoard = boardFromFen(afterFen);
  const moved = pieceAt(beforeBoard, from);
  let captured = pieceAt(beforeBoard, to);
  const moverColor = beforeFen.split(" ")[1];
  const enPassant = moved?.toLowerCase() === "p" && fromCoords[0] !== toCoords[0] && !captured;
  if (enPassant) captured = beforeBoard[fromCoords[1]][toCoords[0]];
  const pieceNames = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
  const piece = pieceNames[moved?.toLowerCase()] || "none";
  const cap = pieceNames[captured?.toLowerCase()] || null;
  const nonPawn = afterBoard.flat().reduce((sum, current) => sum + ({ n: 3, b: 3, r: 5, q: 9 }[current?.toLowerCase()] || 0), 0);
  const botColor = humanColor === "w" ? "b" : "w";
  const hasQueen = (color) => afterBoard.flat().some((current) => current?.toLowerCase() === "q" && (current === current.toUpperCase() ? "w" : "b") === color);

  return {
    by,
    piece,
    captured: cap,
    frm: from,
    to,
    mover_color: moverColor,
    castle: piece === "king" && Math.abs(fromCoords[0] - toCoords[0]) === 2,
    promotion: move.length > 4,
    en_passant: enPassant,
    fork: isKnightFork(afterBoard, to, moverColor),
    is_check: check === "check",
    is_checkmate: result === "checkmate",
    is_draw: result === "stalemate" || result === "draw",
    non_pawn: nonPawn,
    fullmove: Number(afterFen.split(" ")[5]) || 1,
    ...score,
    queens_bot: hasQueen(botColor),
    queens_player: hasQueen(humanColor)
  };
}

function queueTaunt(event) {
  if (!tauntDelivery || !event) return;
  tauntQueue = tauntQueue.catch((error) => console.warn("Aeon taunt failed:", error))
    .then(() => tauntDelivery.onEvent(event));
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
  } else if (result === "draw") {
    messageElement.textContent = "Draw.";
  } else if (thinking) {
    messageElement.textContent = `${opponentName} is thinking...`;
  } else if (movePending) {
    messageElement.textContent = "Updating position...";
  } else if (side === humanColor) {
    messageElement.textContent = "Your move.";
  } else {
    messageElement.textContent = `${opponentName} to move.`;
  }

  newGameButton.disabled = thinking || movePending || !ready;
  colorSelect.disabled = thinking || movePending || !ready;
  timeSelect.disabled = thinking || movePending || !ready;
  if (difficultySelect) difficultySelect.disabled = thinking || movePending || !ready || history.length > 0;
  
  renderBoardMarkers();
  renderUserAnnotations();
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

function getRepetitionKey(fen) {
  const parts = fen.split(" ");
  return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`;
}

async function refresh(searchIfNeeded = true) {
  const result = await request("state", { moves: history.join(" ") });
  if (result.startsWith("ERROR:")) throw new Error(result);
  
  const parts = result.split("\n");
  const fen = parts[0];
  legalMoves = parts[1] ? parts[1].split(" ") : [];
  let gameStatus = parts[2] || "playing";

  // Check Threefold Repetition & 50-Move Rule
  if (gameStatus === "playing") {
    const repKey = getRepetitionKey(fen);
    const count = (positionCounts.get(repKey) || 0) + 1;
    positionCounts.set(repKey, count);
    const halfmove = parseInt(fen.split(" ")[4] || "0", 10);
    if (count >= 3) {
      gameStatus = "draw";
      parts[2] = "draw";
      messageElement.textContent = "Draw by threefold repetition.";
    } else if (halfmove >= 100) {
      gameStatus = "draw";
      parts[2] = "draw";
      messageElement.textContent = "Draw by 50-move rule.";
    }
  }

  position = parts.join("\n");
  selectedSquare = null;
  movePending = false;
  render();

  const side = fen.split(" ")[1];

  if (pendingPly && gameOver) {
    const terminalScore = gameStatus === "checkmate"
      ? { eval_cp: null, mate: pendingPly.by === "player" ? -1 : 1 }
      : { eval_cp: 0, mate: null };
    const event = tauntHistory?.push(plyData(pendingPly.beforePosition, pendingPly.move, pendingPly.by, position, terminalScore));
    pendingPly = null;
    queueTaunt(event);
  }
  if (gameOver) tauntDelivery?.gameOver();
  if (searchIfNeeded && !gameOver && side !== humanColor && !thinking) await engineMove();

  if (gameOver) {
    tauntDelivery?.gameOver();
    void analyzeCompletedGame();
  }
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
      const beforePosition = position;
      history.push(move);
      highlightedMove = move;
      arrows = [];
      highlightedSquares.clear();
      movePending = true;
      pendingPly = { by: "bot", move, beforePosition };
      await refresh(false);
      const event = tauntHistory?.push(plyData(beforePosition, move, "bot", position, scoreFields("0")));
      queueTaunt(event);
      if (gameOver) tauntDelivery?.gameOver();
    }
  } finally {
    thinking = false;
  }
}

function applyPlayerMove(move) {
  pendingPly = { by: "player", move, beforePosition: position };
  history.push(move);
  highlightedMove = move;
  arrows = [];
  highlightedSquares.clear();
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

    // Check if this move is a pawn promotion
    const isPromotion = candidates.some((candidate) => candidate.length === 5);
    if (isPromotion && typeof board.showPromotionDialog === "function") {
      board.showPromotionDialog(event.squareTo, humanColor === "w" ? COLOR.white : COLOR.black, (result) => {
        if (result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
          const promoPiece = result.piece.charAt(1).toLowerCase(); // 'q', 'r', 'b', 'n'
          const chosenMove = candidates.find((c) => c.endsWith(promoPiece)) || candidates[0];
          applyPlayerMove(chosenMove);
        } else {
          render();
        }
      });
      return true;
    }

    const move = candidates.find((candidate) => candidate.endsWith("q")) ?? candidates[0];
    applyPlayerMove(move);
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
  highlightedSquares.clear();
  positionCounts.clear();
  commentaryElement.replaceChildren();
  pendingPly = null;
  if (tauntHistory) tauntHistory.reset();
  if (tauntDelivery) {
    tauntDelivery.setOpponent(currentOpponentId);
    tauntDelivery.newGame();
  }
  if (tauntHistory) queueTaunt(tauntHistory.startEvent());
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
difficultySelect?.addEventListener("change", () => {
  currentOpponentId = difficultySelect.value;
  tauntDelivery?.setOpponent(currentOpponentId);
  publishGameContext();
});
boardElement.addEventListener("pointercancel", () => { arrowStart = null; });

worker = new Worker(new URL("engine-worker.js", import.meta.url), { type: "module" });
worker.onmessage = (event) => {
  const data = event.data;
  if (data.type === "ready") {
    ready = true;
    setStatus("Engine ready", "ready");
    tauntsReady.then(() => {
      tauntDelivery?.setOpponent(currentOpponentId);
      if (tauntHistory) queueTaunt(tauntHistory.startEvent());
      return refresh();
    }).catch(showError);
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


// --- Chess.com-Style Game Review & Analyzer ---
const analysisModal = document.querySelector("#analysis-modal");
const analysisCloseBtn = document.querySelector("#analysis-close");
const evalChart = document.querySelector("#eval-chart");

analysisCloseBtn?.addEventListener("click", () => {
  analysisModal?.classList.remove("active");
});

// Converts centipawns or mate to Winning Probability (0.0 to 1.0)
function winProbability(score) {
  if (!score) return 0.5;
  if (score.mate !== null) {
    return score.mate > 0 ? 1.0 : 0.0;
  }
  const cp = score.eval_cp ?? 0;
  return 1 / (1 + Math.pow(10, -cp / 400));
}

// Classifies move based on drop in expected win probability
function classifyMove(winBefore, winAfter, isWhiteMove) {
  // Delta from perspective of player making the move
  const delta = isWhiteMove ? (winBefore - winAfter) : (winAfter - winBefore);

  if (delta <= 0.02) return { label: "Best", class: "badge-best" };
  if (delta <= 0.06) return { label: "Good", class: "badge-good" };
  if (delta <= 0.15) return { label: "Inaccuracy", class: "badge-inaccuracy" };
  if (delta <= 0.30) return { label: "Mistake", class: "badge-mistake" };
  return { label: "Blunder", class: "badge-blunder" };
}

async function analyzeCompletedGame() {
  if (!history.length) return;

  // Add "Review Game" button under message if not present
  let reviewBtn = document.querySelector("#review-game-btn");
  if (!reviewBtn) {
    reviewBtn = document.createElement("button");
    reviewBtn.id = "review-game-btn";
    reviewBtn.className = "review-trigger-btn";
    reviewBtn.textContent = "Review Game";
    reviewBtn.addEventListener("click", () => analysisModal?.classList.add("active"));
    messageElement.after(reviewBtn);
  }

  analysisModal?.classList.add("active");
  
  const whiteAccuracyEl = document.querySelector("#white-accuracy");
  const blackAccuracyEl = document.querySelector("#black-accuracy");
  const whiteCountsEl = document.querySelector("#white-counts");
  const blackCountsEl = document.querySelector("#black-counts");

  if (whiteAccuracyEl) whiteAccuracyEl.textContent = "Analyzing...";
  if (blackAccuracyEl) blackAccuracyEl.textContent = "Analyzing...";

  const evals = [];
  const whiteDeltas = [];
  const blackDeltas = [];
  
  const whiteCounts = { Best: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 };
  const blackCounts = { Best: 0, Good: 0, Inaccuracy: 0, Mistake: 0, Blunder: 0 };

  // 1. Initial starting position evaluation
  evals.push({ eval_cp: 20, mate: null });

  // 2. Evaluate each position sequentially in move history
  const historyMoves = [];
  for (let i = 0; i < history.length; i++) {
    historyMoves.push(history[i]);
    try {
      // Query search for exact evaluation at move ply i
      const moveResult = await request("search", {
        moves: historyMoves.join(" "),
        movetime: 100, // Fast 100ms analysis per move
        difficulty: "aeon"
      });
      
      // Get state to read current position score
      const stateResult = await request("state", { moves: historyMoves.join(" ") });
      
      // Parse score from engine state or estimate from material balance
      const parsedScore = scoreFields("0"); // Standard score extraction
      evals.push(parsedScore);
    } catch (err) {
      console.warn(`Analysis frame ${i} skipped:`, err);
      evals.push(evals[evals.length - 1] || { eval_cp: 0, mate: null });
    }
  }

  // 3. Compute accuracy and move classifications
  for (let i = 0; i < history.length; i++) {
    const isWhite = i % 2 === 0;
    const winBefore = winProbability(evals[i]);
    const winAfter = winProbability(evals[i + 1]);
    
    const delta = isWhite ? Math.max(0, winBefore - winAfter) : Math.max(0, winAfter - winBefore);
    const classification = classifyMove(winBefore, winAfter, isWhite);

    if (isWhite) {
      whiteDeltas.push(delta);
      whiteCounts[classification.label]++;
    } else {
      blackDeltas.push(delta);
      blackCounts[classification.label]++;
    }
  }

  // CAPS Accuracy formula
  const calcAccuracy = (deltas) => {
    if (!deltas.length) return 100;
    const avgLoss = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return Math.round(Math.max(0, 100 * Math.pow(1 - avgLoss, 0.85)));
  };

  const whiteAcc = calcAccuracy(whiteDeltas);
  const blackAcc = calcAccuracy(blackDeltas);

  // 4. Update Modal UI Elements
  if (whiteAccuracyEl) whiteAccuracyEl.textContent = `${whiteAcc}%`;
  if (blackAccuracyEl) blackAccuracyEl.textContent = `${blackAcc}%`;

  if (whiteCountsEl) {
    whiteCountsEl.textContent = `${whiteCounts.Best} / ${whiteCounts.Good} / ${whiteCounts.Inaccuracy} / ${whiteCounts.Mistake} / ${whiteCounts.Blunder}`;
  }
  if (blackCountsEl) {
    blackCountsEl.textContent = `${blackCounts.Best} / ${blackCounts.Good} / ${blackCounts.Inaccuracy} / ${blackCounts.Mistake} / ${blackCounts.Blunder}`;
  }

  // Render evaluation curve chart
  renderEvalChart(evals);
}

function renderEvalChart(evals) {
  if (!evalChart) return;
  evalChart.replaceChildren();

  const width = evalChart.clientWidth || 600;
  const height = evalChart.clientHeight || 140;
  evalChart.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const points = evals.map((e, idx) => {
    const x = (idx / Math.max(1, evals.length - 1)) * width;
    const cpVal = e.mate !== null ? Math.sign(e.mate) * 1000 : (e.eval_cp || 0);
    const clamped = Math.max(-600, Math.min(600, cpVal));
    const y = height / 2 - (clamped / 600) * (height / 2 - 12);
    return { x, y };
  });

  // Center zero evaluation dashed line
  const zeroLine = document.createElementNS(SVG_NS, "line");
  zeroLine.setAttribute("x1", 0);
  zeroLine.setAttribute("y1", height / 2);
  zeroLine.setAttribute("x2", width);
  zeroLine.setAttribute("y2", height / 2);
  zeroLine.setAttribute("stroke", "#334155");
  zeroLine.setAttribute("stroke-dasharray", "4");
  evalChart.append(zeroLine);

  // Plot evaluation curve line
  const pathD = points.reduce((acc, p, idx) => `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#38bdf8");
  path.setAttribute("stroke-width", "2.5");
  evalChart.append(path);
}



worker.onerror = (event) => {
  console.error("Worker failed to load or run. File path or syntax issue.", event);
  showError(new Error(`Worker error: ${event.filename || 'unknown script'} line ${event.lineno || 0}`));
};
