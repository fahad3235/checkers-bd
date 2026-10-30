// Checkers BD — node unit tests for logic.js. Run: node tests/test.js
'use strict';
const L = require('../logic.js');
const {
  initialBoard, countPieces, legalMoves, quietMoves, captureSequences,
  continuationMoves, applyMove, gameOver, evaluate, aiChoose, algebraic, RED, BLACK,
} = L;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('ok - ' + name); }
  else { failed++; console.log('FAIL - ' + name + (extra ? ' :: ' + extra : '')); }
}
function emptyBoard() { return Array.from({ length: 8 }, () => Array(8).fill(0)); }
function sameMove(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 1. Initial position
{
  const b = initialBoard();
  check('initial: 12 red pieces', countPieces(b, RED) === 12);
  check('initial: 12 black pieces', countPieces(b, BLACK) === 12);
  let allDark = true;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (b[r][c] !== 0 && (r + c) % 2 !== 1) allDark = false;
  check('initial: all pieces on dark squares', allDark);
  const rm = legalMoves(b, RED);
  check('initial: red has 7 moves', rm.length === 7, 'got ' + rm.length);
  check('initial: red moves all quiet', rm.every((m) => !m.isCapture));
  const bm = legalMoves(b, BLACK);
  check('initial: black has 7 moves', bm.length === 7, 'got ' + bm.length);
  check('initial: evaluation is 0 (symmetric)', evaluate(b) === 0, 'got ' + evaluate(b));
}

// 2. Quiet move application
{
  const b = initialBoard();
  const mv = legalMoves(b, RED).find((m) => m.from[0] === 5 && m.from[1] === 0);
  check('quiet move (5,0) exists', !!mv);
  const nb = applyMove(b, mv);
  check('quiet move lands piece', nb[mv.to[0]][mv.to[1]] === 1);
  check('quiet move vacates origin', nb[5][0] === 0);
  check('quiet move keeps counts', countPieces(nb, RED) === 12 && countPieces(nb, BLACK) === 12);
  check('original board unmutated', b[5][0] === 1);
}

// 3. Forced capture: red has a capture AND a quiet move -> only captures legal
{
  const b = emptyBoard();
  b[4][3] = 1; b[3][4] = -1; // red can jump (4,3)->(2,5)
  b[5][0] = 1; // this man also has a quiet move
  const moves = legalMoves(b, RED);
  check('forced capture: only captures offered', moves.length > 0 && moves.every((m) => m.isCapture), JSON.stringify(moves));
  check('forced capture: jump found', moves.some((m) => m.from[0] === 4 && m.from[1] === 3 && m.to[0] === 2 && m.to[1] === 5));
}

// 4. Single jump removes the captured piece
{
  const b = emptyBoard();
  b[4][3] = 1; b[3][4] = -1;
  const mv = legalMoves(b, RED)[0];
  const nb = applyMove(b, mv);
  check('jump removes captured piece', nb[3][4] === 0);
  check('jump lands jumper', nb[2][5] === 1);
  check('jump leaves black at 0', countPieces(nb, BLACK) === 0);
}

// 5. Multi-jump sequence (double capture, ending in promotion)
{
  const b = emptyBoard();
  b[4][1] = 1; b[3][2] = -1; b[1][4] = -1;
  const seqs = captureSequences(b, 4, 1);
  const dbl = seqs.find((s) => s.captures.length === 2);
  check('multi-jump: double sequence exists', !!dbl, JSON.stringify(seqs));
  if (dbl) {
    check('multi-jump: path is (2,3)->(0,5)', JSON.stringify(dbl.path) === JSON.stringify([[2, 3], [0, 5]]));
    const nb = applyMove(b, dbl);
    check('multi-jump: both captured removed', nb[3][2] === 0 && nb[1][4] === 0);
    check('multi-jump: piece crowned on last row', nb[0][5] === 2);
  }
}

// 6. Promotion ends the chain (no king continuation in the same turn)
{
  const b = emptyBoard();
  b[2][1] = 1; b[1][2] = -1; b[1][4] = -1;
  const seqs = captureSequences(b, 2, 1);
  check('promotion: only single jump offered (chain stops)', seqs.length === 1 && seqs[0].captures.length === 1, JSON.stringify(seqs));
  const nb = applyMove(b, seqs[0]);
  check('promotion: piece is king', nb[0][3] === 2);
  check('promotion: second enemy survives', nb[1][4] === -1);
}

// 7. Men cannot move backward; kings can
{
  const b = emptyBoard();
  b[4][3] = 1;
  const q = quietMoves(b, 4, 3);
  check('man: exactly 2 forward quiet moves', q.length === 2, JSON.stringify(q));
  check('man: no backward moves', q.every((m) => m.to[0] === 3));
  const bk = emptyBoard();
  bk[3][4] = 2;
  const kq = quietMoves(bk, 3, 4);
  check('king: 4 diagonal quiet moves', kq.length === 4, JSON.stringify(kq));
}

// 8. King captures backward
{
  const b = emptyBoard();
  b[3][4] = 2; b[4][5] = -1;
  const seqs = captureSequences(b, 3, 4);
  check('king backward capture exists', seqs.some((s) => s.to[0] === 5 && s.to[1] === 6), JSON.stringify(seqs));
}

// 9. Continuation after a partial jump
{
  const b = emptyBoard();
  b[4][1] = 1; b[3][2] = -1; b[1][4] = -1;
  const first = { from: [4, 1], to: [2, 3], captures: [[3, 2]], path: [[2, 3]], isCapture: true };
  const mid = applyMove(b, first);
  const cont = continuationMoves(mid, 2, 3);
  check('continuation: jump remains from landing square', cont.length === 1 && cont[0].captures[0][0] === 1 && cont[0].captures[0][1] === 4, JSON.stringify(cont));
}

// 10. Win / draw detection
{
  const b = emptyBoard();
  b[4][3] = 1;
  const over = gameOver(b, BLACK, 0);
  check('win: side with no pieces loses', over && over.winner === RED && over.reason === 'no-pieces', JSON.stringify(over));
  const blocked = emptyBoard();
  blocked[0][1] = -1; blocked[1][0] = 1; blocked[1][2] = 1; blocked[2][3] = 1;
  const over2 = gameOver(blocked, BLACK, 0);
  check('win: side with no moves loses', over2 && over2.winner === RED && over2.reason === 'no-moves', JSON.stringify(over2));
  const over3 = gameOver(initialBoard(), RED, 120);
  check('draw: 120 capture-free half-moves', over3 && over3.draw === true, JSON.stringify(over3));
  check('ongoing: initial position not over', gameOver(initialBoard(), RED, 0) === null);
}

// 11. AI always returns a legal move
{
  const b = initialBoard();
  for (const diff of ['easy', 'medium', 'hard']) {
    const m = aiChoose(b, RED, diff);
    const legal = legalMoves(b, RED);
    check('ai ' + diff + ' returns a legal move', !!m && legal.some((x) => sameMove(x, m)));
  }
  const mid = emptyBoard();
  mid[4][3] = 1; mid[3][4] = -1; mid[5][6] = -1; mid[2][1] = 1;
  const mh = aiChoose(mid, RED, 'hard');
  check('ai hard on capture position returns legal move', !!mh && legalMoves(mid, RED).some((x) => sameMove(x, mh)));
}

// 12. Notation + misc
{
  check('algebraic a1', algebraic(7, 0) === 'a1');
  check('algebraic h8', algebraic(0, 7) === 'h8');
  check('algebraic d5', algebraic(3, 3) === 'd5');
  const b = emptyBoard();
  b[4][3] = 1;
  check('lone man: 2 moves', legalMoves(b, RED).length === 2);
  check('empty side: no moves', legalMoves(b, BLACK).length === 0);
}

console.log('unit passed: ' + passed + ', failed: ' + failed);
if (failed > 0) process.exitCode = 1;
