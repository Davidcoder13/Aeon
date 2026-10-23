/**
 * Standalone Game Review & Evaluation Module for Aeon
 */

const SVG_NS = "http://www.w3.org/2000/svg";

// CAPS Accuracy Formula (Chess.com expected win percentage loss)
function winProbability(cp, mate) {
  if (mate !== null && mate !== undefined) {
    return mate > 0 ? 1.0 : 0.0;
  }
  const val = cp ?? 0;
  return 1 / (1 + Math.pow(10, -val / 400));
}

export function parseFenEvaluation(stateOutput) {
  if (typeof stateOutput !== "string") return { eval_cp: 0, mate: null };

  const lines = stateOutput.split("\n");
  const fen = lines[0] || "";
  const gameResult = lines[2] || "playing";
  const parts = fen.split(" ");
  if (parts.length < 4) return { eval_cp: 0, mate: null };

  if (gameResult === "checkmate") {
    const sideToMove = parts[1];
    return { eval_cp: null, mate: sideToMove === "w" ? -1 : 1 };
  }

  const placement = parts[0];
  const pieceValues = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  let whiteScore = 0;
  let blackScore = 0;

  const rows = placement.split("/");
  let whiteKingPos = null;
  let blackKingPos = null;

  rows.forEach((rowStr, rIdx) => {
    let cIdx = 0;
    for (const char of rowStr) {
      if (!isNaN(char)) {
        cIdx += parseInt(char, 10);
      } else {
        const isWhite = char === char.toUpperCase();
        const val = pieceValues[char.toLowerCase()] || 0;
        if (isWhite) whiteScore += val;
        else blackScore += val;

        if (char === "K") whiteKingPos = { r: rIdx, c: cIdx };
        if (char === "k") blackKingPos = { r: rIdx, c: cIdx };
        cIdx++;
      }
    }
  });

  whiteScore -= pieceValues.k;
  blackScore -= pieceValues.k;

  // Center King exposure penalties
  if (whiteKingPos && whiteKingPos.r < 6) {
    const kingCenterDistance = Math.abs(whiteKingPos.r - 3.5) + Math.abs(whiteKingPos.c - 3.5);
    whiteScore -= Math.round((6 - whiteKingPos.r) * 140 + (4 - kingCenterDistance) * 30);
  }
  if (blackKingPos && blackKingPos.r > 1) {
    const kingCenterDistance = Math.abs(blackKingPos.r - 3.5) + Math.abs(blackKingPos.c - 3.5);
    blackScore -= Math.round(blackKingPos.r * 140 + (4 - kingCenterDistance) * 30);
  }

  return { eval_cp: whiteScore - blackScore, mate: null };
}

export function classifyMoveDelta(winBefore, winAfter, isWhiteMove) {
  const delta = isWhiteMove ? (winBefore - winAfter) : (winAfter - winBefore);

  if (delta <= 0.03) return { label: "Best", badgeClass: "badge-best" };
  if (delta <= 0.08) return { label: "Good", badgeClass: "badge-good" };
  if (delta <= 0.18) return { label: "Inaccuracy", badgeClass: "badge-inaccuracy" };
  if (delta <= 0.35) return { label: "Mistake", badgeClass: "badge-mistake" };
  return { label: "Blunder", badgeClass: "badge-blunder" };
}

export function calculateCapsAccuracy(deltas) {
  if (!deltas.length) return 100;
  const avgLoss = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.round(Math.max(0, 100 * Math.pow(1 - avgLoss, 0.85)));
}

export function renderEvalChartSVG(svgElement, evals) {
  if (!svgElement) return;
  svgElement.replaceChildren();

  const width = svgElement.clientWidth || 600;
  const height = svgElement.clientHeight || 140;
  svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const points = evals.map((e, idx) => {
    const x = (idx / Math.max(1, evals.length - 1)) * width;
    const cpVal = e.mate !== null ? Math.sign(e.mate) * 1000 : (e.eval_cp || 0);
    const clamped = Math.max(-600, Math.min(600, cpVal));
    const y = height / 2 - (clamped / 600) * (height / 2 - 12);
    return { x, y };
  });

  const zeroLine = document.createElementNS(SVG_NS, "line");
  zeroLine.setAttribute("x1", 0);
  zeroLine.setAttribute("y1", height / 2);
  zeroLine.setAttribute("x2", width);
  zeroLine.setAttribute("y2", height / 2);
  zeroLine.setAttribute("stroke", "#334155");
  zeroLine.setAttribute("stroke-dasharray", "4");
  svgElement.append(zeroLine);

  const pathD = points.reduce((acc, p, idx) => `${acc} ${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, "");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#38bdf8");
  path.setAttribute("stroke-width", "2.5");
  svgElement.append(path);
}

export { winProbability };
