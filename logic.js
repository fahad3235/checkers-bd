// Checkers BD — pure game engine (no DOM, no network).
// Rules: American/English draughts on 8x8. Dark squares only ((r+c) odd).
// Red moves up (toward row 0), Black moves down (toward row 7).
// Men step one diagonal square forward; kings step one diagonal square any way.
// Captures jump an adjacent enemy piece onto the empty square beyond it.
// Captures are MANDATORY: when any capture exists, only captures are legal.
// Multi-jumps chain until no further jump exists for that piece.
// A man reaching the far row is crowned king and its turn ends immediately
// (it does not continue jumping as a king in the same turn).
'use strict';

const EMPTY = 0, R_MAN = 1, R_KING = 2, B_MAN = -1, B_KING = -2;
const RED = 1, BLACK = -1;
const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function initialBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(EMPTY));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r <= 2) b[r][c] = B_MAN;
      else if (r >= 5) b[r][c] = R_MAN;
    }
  }
  return b;
}

function cloneBoard(b) { return b.map((row) => row.slice()); }
function inside(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function sideOf(p) { return p > 0 ? RED : (p < 0 ? BLACK : 0); }
function isKing(p) { return Math.abs(p) === 2; }
function isMan(p) { return Math.abs(p) === 1; }
function promotionRow(side) { return side === RED ? 0 : 7; }
function moveDirs(piece) {
  if (isKing(piece)) return DIRS;
  return sideOf(piece) === RED ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

function countPieces(board, side) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (sideOf(board[r][c]) === side) n++;
  return n;
}

// Recursive capture sequences for one piece. Each returned move has:
// { from:[r,c], to:[r,c], captures:[[r,c],...], path:[[r,c],...] (landings in order) }
function captureSequences(board, r, c) {
  const piece = board[r][c];
  const side = sideOf(piece);
  const results = [];
  function dfs(b, cr, cc, captures, path, promoted) {
    let extended = false;
    for (const [dr, dc] of moveDirs(b[cr][cc])) {
      const mr = cr + dr, mc = cc + dc;
      const lr = cr + 2 * dr, lc = cc + 2 * dc;
      if (!inside(mr, mc) || !inside(lr, lc)) continue;
      const mid = b[mr][mc];
      if (sideOf(mid) !== -side || b[lr][lc] !== EMPTY) continue;
      extended = true;
      const nb = cloneBoard(b);
      nb[cr][cc] = EMPTY;
      nb[mr][mc] = EMPTY;
      const crowns = isMan(piece) && lr === promotionRow(side);
      nb[lr][lc] = crowns ? (side === RED ? R_KING : B_KING) : b[cr][cc];
      const nc = captures.concat([[mr, mc]]);
      const np = path.concat([[lr, lc]]);
      if (crowns) {
        // Crowned: turn ends, sequence stops here.
        results.push({ from: [r, c], to: [lr, lc], captures: nc, path: np, isCapture: true });
      } else {
        dfs(nb, lr, lc, nc, np, false);
      }
    }
    if (!extended && captures.length > 0) {
      results.push({ from: [r, c], to: [path[path.length - 1][0], path[path.length - 1][1]], captures, path, isCapture: true });
    }
  }
  dfs(board, r, c, [], [], false);
  return results;
}

function quietMoves(board, r, c) {
  const piece = board[r][c];
  const out = [];
  for (const [dr, dc] of moveDirs(piece)) {
    const nr = r + dr, nc = c + dc;
    if (inside(nr, nc) && board[nr][nc] === EMPTY) {
      out.push({ from: [r, c], to: [nr, nc], captures: [], path: [[nr, nc]], isCapture: false });
    }
  }
  return out;
}

// All legal moves for a side. Captures are mandatory: if any capture
// sequence exists for the side, quiet moves are excluded.
function legalMoves(board, side) {
  const caps = [];
  const quiets = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (sideOf(board[r][c]) !== side) continue;
      caps.push(...captureSequences(board, r, c));
      quiets.push(...quietMoves(board, r, c));
    }
  }
  return caps.length > 0 ? caps : quiets;
}

// Legal continuation sequences for a piece mid-chain (used by the UI so a
// player taps through each landing square of a multi-jump).
function continuationMoves(board, r, c) {
  return captureSequences(board, r, c);
}

function applyMove(board, move) {
  const nb = cloneBoard(board);
  const [fr, fc] = move.from;
  const [tr, tc] = move.to;
  const piece = nb[fr][fc];
  nb[fr][fc] = EMPTY;
  for (const [cr, cc] of move.captures) nb[cr][cc] = EMPTY;
  if (isMan(piece) && tr === promotionRow(sideOf(piece))) {
    nb[tr][tc] = sideOf(piece) === RED ? R_KING : B_KING;
  } else {
    nb[tr][tc] = piece;
  }
  return nb;
}

// Returns { winner: 1 | -1, reason } or { draw: true, reason } or null.
function gameOver(board, sideToMove, halfmoveClock) {
  if (halfmoveClock >= 120) return { draw: true, reason: 'no-capture-limit' };
  if (countPieces(board, sideToMove) === 0) return { winner: -sideToMove, reason: 'no-pieces' };
  if (legalMoves(board, sideToMove).length === 0) return { winner: -sideToMove, reason: 'no-moves' };
  return null;
}

function evaluate(board) {
  // Red perspective. Man 100, king 175, small advancement bonus.
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p === R_MAN) score += 100 + (7 - r) * 3;
      else if (p === R_KING) score += 175;
      else if (p === B_MAN) score -= 100 + r * 3;
      else if (p === B_KING) score -= 175;
    }
  }
  return score;
}

function minimax(board, side, depth, alpha, beta) {
  const over = gameOver(board, side, 0);
  if (over) {
    if (over.draw) return 0;
    return over.winner === RED ? 10000 + depth : -10000 - depth;
  }
  if (depth === 0) return evaluate(board);
  const moves = legalMoves(board, side);
  if (side === RED) {
    let best = -Infinity;
    for (const m of moves) {
      const v = minimax(applyMove(board, m), -side, depth - 1, alpha, beta);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of moves) {
    const v = minimax(applyMove(board, m), -side, depth - 1, alpha, beta);
    if (v < best) best = v;
    if (best < beta) beta = best;
    if (beta <= alpha) break;
  }
  return best;
}

function movePromotes(board, move) {
  const piece = board[move.from[0]][move.from[1]];
  return isMan(piece) && move.to[0] === promotionRow(sideOf(piece));
}

function aiChoose(board, side, difficulty) {
  const moves = legalMoves(board, side);
  if (moves.length === 0) return null;
  if (difficulty === 'easy') {
    return moves[Math.floor(Math.random() * moves.length)];
  }
  if (difficulty === 'medium') {
    let best = -Infinity, bestMoves = [];
    for (const m of moves) {
      let s = m.captures.length * 30 + (movePromotes(board, m) ? 25 : 0);
      s += side === RED ? (7 - m.to[0]) : m.to[0]; // slight advance preference
      if (s > best) { best = s; bestMoves = [m]; }
      else if (s === best) bestMoves.push(m);
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  }
  // hard: depth-3 alpha-beta
  let best = side === RED ? -Infinity : Infinity, bestMoves = [];
  for (const m of moves) {
    const v = minimax(applyMove(board, m), -side, 2, -Infinity, Infinity);
    if ((side === RED && v > best) || (side === BLACK && v < best)) {
      best = v; bestMoves = [m];
    } else if (v === best) bestMoves.push(m);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function algebraic(r, c) {
  return 'abcdefgh'[c] + String(8 - r);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EMPTY, R_MAN, R_KING, B_MAN, B_KING, RED, BLACK,
    initialBoard, cloneBoard, inside, sideOf, isKing, isMan,
    countPieces, captureSequences, quietMoves, legalMoves,
    continuationMoves, applyMove, gameOver, evaluate, minimax,
    movePromotes, aiChoose, algebraic,
  };
}
