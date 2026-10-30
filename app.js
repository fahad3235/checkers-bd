// Checkers BD — UI controller (DOM). Depends on logic.js + i18n.js.
'use strict';

const LS_KEY = 'checkers-bd-state-v1';
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

const $ = (id) => document.getElementById(id);

const state = {
  lang: 'en',
  mode: 'cpu',
  difficulty: 'medium',
  sound: true,
  board: initialBoard(),
  turn: RED,
  over: null, // null | { winner: 1|-1, reason } | { draw: true, reason }
  selected: null,
  chain: null, // { from:[r,c], captures:[[r,c]], path:[[r,c]], pos:[r,c] }
  history: [],
  halfmoveClock: 0,
  snapshots: [],
  stats: { you: 0, comp: 0, red: 0, black: 0, draws: 0, streak: 0, best: 0 },
  thinkToken: 0,
};

let audioCtx = null;

function t(key) { return I18N[state.lang][key]; }
function fmt(n) {
  const s = String(n);
  return state.lang === 'bn' ? s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]) : s;
}

function beep(freq, dur, type) {
  if (!state.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.connect(g); g.connect(o.destination || audioCtx.destination);
    o.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio unavailable: stay silent */ }
}
function playSound(kind) {
  if (kind === 'move') beep(520, 0.07);
  else if (kind === 'capture') { beep(740, 0.1); setTimeout(() => beep(990, 0.1), 90); }
  else if (kind === 'king') { beep(660, 0.1); setTimeout(() => beep(880, 0.15), 100); }
  else if (kind === 'win') { [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.18), i * 130)); }
  else if (kind === 'lose') { [392, 330, 262].forEach((f, i) => setTimeout(() => beep(f, 0.18), i * 130)); }
}

// ---------- persistence ----------
function save() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      lang: state.lang, mode: state.mode, difficulty: state.difficulty,
      sound: state.sound, stats: state.stats,
      game: {
        board: state.board, turn: state.turn, over: state.over,
        history: state.history, halfmoveClock: state.halfmoveClock,
        snapshots: state.snapshots.slice(-200),
      },
    }));
  } catch (e) { /* storage full/blocked: game still works in memory */ }
}

function validBoard(b) {
  return Array.isArray(b) && b.length === 8 &&
    b.every((row) => Array.isArray(row) && row.length === 8 &&
      row.every((v) => [-2, -1, 0, 1, 2].includes(v)));
}

// Drop history entries that lack a usable from/to (e.g. saves written by a
// buggy build) instead of crashing the history renderer on load.
function cleanHistory(h) {
  if (!Array.isArray(h)) return [];
  return h.filter((m) => m && Array.isArray(m.from) && m.from.length === 2 &&
    Array.isArray(m.to) && m.to.length === 2);
}

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.lang === 'en' || d.lang === 'bn') state.lang = d.lang;
    if (d.mode === 'cpu' || d.mode === '2p') state.mode = d.mode;
    if (['easy', 'medium', 'hard'].includes(d.difficulty)) state.difficulty = d.difficulty;
    if (typeof d.sound === 'boolean') state.sound = d.sound;
    if (d.stats && typeof d.stats === 'object') Object.assign(state.stats, d.stats);
    if (d.game && validBoard(d.game.board)) {
      state.board = d.game.board;
      state.turn = d.game.turn === BLACK ? BLACK : RED;
      state.over = d.game.over || null;
      state.history = cleanHistory(d.game.history);
      state.halfmoveClock = d.game.halfmoveClock || 0;
      state.snapshots = Array.isArray(d.game.snapshots) ? d.game.snapshots : [];
      // Sanitize snapshot histories too, so Undo can never restore a bad entry.
      for (const s of state.snapshots) {
        if (s && Array.isArray(s.history)) s.history = cleanHistory(s.history);
      }
    }
  } catch (e) { /* corrupt save: start fresh */ }
}

// ---------- game flow ----------
function snapshot() {
  return {
    board: cloneBoard(state.board), turn: state.turn,
    history: state.history.slice(), halfmoveClock: state.halfmoveClock,
  };
}

function newGame() {
  state.thinkToken++;
  state.board = initialBoard();
  state.turn = RED;
  state.over = null;
  state.selected = null;
  state.chain = null;
  state.history = [];
  state.halfmoveClock = 0;
  state.snapshots = [];
  save();
  render();
}

function recordResult() {
  const o = state.over;
  if (!o) return;
  if (o.draw) { state.stats.draws++; state.stats.streak = 0; return; }
  if (state.mode === 'cpu') {
    if (o.winner === RED) {
      state.stats.you++;
      state.stats.streak++;
      if (state.stats.streak > state.stats.best) state.stats.best = state.stats.streak;
      playSound('win');
    } else {
      state.stats.comp++;
      state.stats.streak = 0;
      playSound('lose');
    }
  } else {
    if (o.winner === RED) state.stats.red++;
    else state.stats.black++;
    playSound('win');
  }
}

function finishTurn(move, wasCapture) {
  state.history.push(move);
  state.halfmoveClock = wasCapture ? 0 : state.halfmoveClock + 1;
  state.turn = -state.turn;
  state.over = gameOver(state.board, state.turn, state.halfmoveClock);
  if (state.over) recordResult();
  state.selected = null;
  state.chain = null;
  save();
  render();
  if (!state.over && state.mode === 'cpu' && state.turn === BLACK) {
    const token = state.thinkToken;
    render(); // shows "thinking"
    setTimeout(() => {
      if (token !== state.thinkToken || state.over) return;
      const m = aiChoose(state.board, BLACK, state.difficulty);
      if (!m) return;
      state.snapshots.push(snapshot());
      const wasKing = isKing(state.board[m.from[0]][m.from[1]]);
      const wasCapture = m.captures.length > 0;
      state.board = applyMove(state.board, m);
      if (!wasKing && isKing(state.board[m.to[0]][m.to[1]])) playSound('king');
      else if (wasCapture) playSound('capture');
      else playSound('move');
      finishTurn({
        side: BLACK, from: m.from, to: m.to,
        captures: m.captures, path: m.path,
      }, wasCapture);
    }, 450);
  }
}

// Apply one jump step during a chain (or a full quiet move / full capture
// sequence chosen in one tap when only one landing exists). Returns true
// if the turn is now complete.
function doStep(fromSquare, toSquare) {
  const piece = state.board[fromSquare[0]][fromSquare[1]];
  const seqs = state.chain
    ? continuationMoves(state.board, fromSquare[0], fromSquare[1])
    : legalMoves(state.board, state.turn).filter((m) =>
        m.from[0] === fromSquare[0] && m.from[1] === fromSquare[1] &&
        m.path[0][0] === toSquare[0] && m.path[0][1] === toSquare[1]);
  const seq = seqs.find((s) => s.path[0][0] === toSquare[0] && s.path[0][1] === toSquare[1]);
  if (!seq) return false;
  const single = {
    from: fromSquare, to: toSquare,
    captures: [seq.captures[0]], path: [toSquare], isCapture: true,
  };
  const wasKing = isKing(piece);
  // Snapshot BEFORE mutating, so Undo restores the pre-move board.
  const preSnap = state.chain ? null : snapshot();
  state.board = applyMove(state.board, single);
  if (preSnap) state.snapshots.push(preSnap);
  const crowned = !wasKing && isKing(state.board[toSquare[0]][toSquare[1]]);
  if (crowned) playSound('king');
  else playSound('capture');
  if (state.chain) {
    state.chain.captures.push(seq.captures[0]);
    state.chain.path.push(toSquare);
    state.chain.pos = toSquare;
  } else {
    state.chain = { from: fromSquare, captures: [seq.captures[0]], path: [toSquare], pos: toSquare };
  }
  if (crowned) {
    // Promotion ends the turn immediately.
    const done = state.chain;
    state.chain = null;
    finishTurn({ side: state.turn, from: done.from, to: done.pos, captures: done.captures, path: done.path }, true);
    return true;
  }
  const cont = continuationMoves(state.board, toSquare[0], toSquare[1]);
  if (cont.length === 0) {
    const done = state.chain;
    state.chain = null;
    finishTurn({ side: state.turn, from: done.from, to: done.pos, captures: done.captures, path: done.path }, true);
    return true;
  }
  state.selected = toSquare;
  save();
  render();
  return false;
}

function onSquareClick(r, c) {
  if (state.over) return;
  if (state.mode === 'cpu' && state.turn === BLACK) return; // computer thinking
  const piece = state.board[r][c];
  const hintSquares = currentHints();
  const isHint = hintSquares.some((h) => h[0] === r && h[1] === c);

  if (state.chain) {
    // Mid-chain: only the highlighted continuation landing is accepted.
    if (isHint) doStep(state.chain.pos, [r, c]);
    return;
  }

  if (isHint && state.selected) {
    const sel = state.selected;
    const moves = legalMoves(state.board, state.turn)
      .filter((m) => m.from[0] === sel[0] && m.from[1] === sel[1] &&
        m.path[0][0] === r && m.path[0][1] === c);
    const mv = moves[0];
    if (!mv) return;
    if (!mv.isCapture) {
      const selPiece = state.board[sel[0]][sel[1]];
      state.snapshots.push(snapshot());
      state.board = applyMove(state.board, mv);
      playSound('move');
      if (!isKing(selPiece) && isKing(state.board[r][c])) playSound('king');
      finishTurn({ side: state.turn, from: sel, to: [r, c], captures: [], path: [[r, c]] }, false);
    } else {
      doStep(sel, [r, c]);
    }
    return;
  }

  if (piece !== EMPTY && sideOf(piece) === state.turn) {
    state.selected = (state.selected && state.selected[0] === r && state.selected[1] === c) ? null : [r, c];
    render();
    return;
  }
  state.selected = null;
  render();
}

// Squares highlighted as legal destinations for the current selection.
function currentHints() {
  if (state.over) return [];
  if (state.chain) {
    return continuationMoves(state.board, state.chain.pos[0], state.chain.pos[1])
      .map((s) => s.path[0]);
  }
  if (!state.selected) return [];
  return legalMoves(state.board, state.turn)
    .filter((m) => m.from[0] === state.selected[0] && m.from[1] === state.selected[1])
    .map((m) => m.path[0]);
}

function hintIsCapture(r, c) {
  if (state.chain) return true;
  if (!state.selected) return false;
  return legalMoves(state.board, state.turn).some((m) =>
    m.from[0] === state.selected[0] && m.from[1] === state.selected[1] &&
    m.path[0][0] === r && m.path[0][1] === c && m.isCapture);
}

// ---------- rendering ----------
function buildBoard() {
  const el = $('board');
  el.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const d = document.createElement('div');
      d.className = 'cell' + ((r + c) % 2 === 1 ? ' dark' : ' light');
      d.dataset.r = r; d.dataset.c = c;
      d.addEventListener('click', () => onSquareClick(r, c));
      el.appendChild(d);
    }
  }
}

function renderBoard() {
  const hints = currentHints();
  const cells = $('board').children;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = cells[r * 8 + c];
      cell.classList.toggle('selected', !!state.selected && state.selected[0] === r && state.selected[1] === c);
      const isHint = hints.some((h) => h[0] === r && h[1] === c);
      cell.classList.toggle('hint', isHint);
      cell.classList.toggle('hint-capture', isHint && hintIsCapture(r, c));
      const p = state.board[r][c];
      if (p === EMPTY) {
        cell.innerHTML = '';
      } else {
        const king = isKing(p);
        cell.innerHTML = '<div class="piece ' + (p > 0 ? 'red' : 'black') + (king ? ' king' : '') + '">' +
          (king ? '&#9813;' : '') + '</div>';
      }
    }
  }
}

function renderStatus() {
  const o = state.over;
  let main = '', hint = '';
  if (o) {
    if (o.draw) main = t('draw');
    else if (state.mode === 'cpu') main = o.winner === RED ? t('youWin') : t('cpuWin');
    else main = o.winner === RED ? t('redWin') : t('blackWin');
    hint = o.reason === 'no-pieces' ? t('winNoPieces')
      : o.reason === 'no-moves' ? t('winNoMoves') : t('winDrawLimit');
  } else if (state.chain) {
    main = t('multiJump');
    hint = t('mustCapture');
  } else if (state.mode === 'cpu') {
    main = state.turn === RED ? t('yourTurn') : t('cpuTurn');
    hint = legalMoves(state.board, state.turn).some((m) => m.isCapture) && state.turn === RED
      ? t('mustCapture') : t('selectPiece');
  } else {
    main = state.turn === RED ? t('redTurn') : t('blackTurn');
    hint = legalMoves(state.board, state.turn).some((m) => m.isCapture)
      ? t('mustCapture') : t('selectPiece');
  }
  $('statusMain').textContent = main;
  $('statusHint').textContent = hint;
  $('capturedRed').textContent = fmt(12 - countPieces(state.board, BLACK));
  $('capturedBlack').textContent = fmt(12 - countPieces(state.board, RED));
  $('undoBtn').disabled = state.over !== null || state.snapshots.length === 0;
}

function renderHistory() {
  const el = $('historyList');
  if (state.history.length === 0) {
    el.innerHTML = '<li class="muted">' + t('noMovesYet') + '</li>';
    return;
  }
  el.innerHTML = state.history.map((m, i) => {
    const side = state.mode === 'cpu'
      ? (m.side === RED ? t('you') : t('computer'))
      : (m.side === RED ? t('red') : t('black'));
    const cap = m.captures.length > 0 ? ' &times;' + fmt(m.captures.length) : '';
    return '<li>' + fmt(i + 1) + '. ' + side + ' ' +
      algebraic(m.from[0], m.from[1]) + ' &rarr; ' +
      algebraic(m.to[0], m.to[1]) + cap + '</li>';
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function renderStats() {
  if (state.mode === 'cpu') {
    $('statA').textContent = t('you') + ': ' + fmt(state.stats.you) + ' ' + t('wins');
    $('statB').textContent = t('computer') + ': ' + fmt(state.stats.comp) + ' ' + t('wins');
  } else {
    $('statA').textContent = t('red') + ': ' + fmt(state.stats.red) + ' ' + t('wins');
    $('statB').textContent = t('black') + ': ' + fmt(state.stats.black) + ' ' + t('wins');
  }
  $('statDraws').textContent = t('draws') + ': ' + fmt(state.stats.draws);
  $('statStreak').textContent = t('streak') + ': ' + fmt(state.stats.streak) +
    ' · ' + t('bestStreak') + ': ' + fmt(state.stats.best);
}

function applyLang() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (I18N[state.lang][key]) el.textContent = I18N[state.lang][key];
  });
  document.title = I18N[state.lang].title + ' — ' + (state.lang === 'bn' ? 'অফলাইন চেকার্স খেলা' : 'Offline checkers game');
  $('langBtn').textContent = t('langBtn');
  $('soundBtn').textContent = state.sound ? t('soundOn') : t('soundOff');
  $('modeSelect').value = state.mode;
  $('diffSelect').value = state.difficulty;
  $('diffSelect').disabled = state.mode === '2p';
  document.documentElement.lang = state.lang === 'bn' ? 'bn' : 'en';
}

function render() {
  applyLang();
  renderBoard();
  renderStatus();
  renderHistory();
  renderStats();
}

function undo() {
  if (state.over || state.snapshots.length === 0) return;
  state.thinkToken++;
  state.chain = null;
  state.selected = null;
  let snap = state.snapshots.pop();
  // In CPU mode, unwind the computer's reply too so it is your turn again.
  if (state.mode === 'cpu' && snap.turn === BLACK && state.snapshots.length > 0) {
    snap = state.snapshots.pop();
  }
  state.board = snap.board;
  state.turn = snap.turn;
  state.history = snap.history;
  state.halfmoveClock = snap.halfmoveClock;
  state.over = null;
  save();
  render();
}

function init() {
  load();
  buildBoard();
  $('modeSelect').addEventListener('change', (e) => {
    state.mode = e.target.value;
    newGame();
  });
  $('diffSelect').addEventListener('change', (e) => {
    state.difficulty = e.target.value;
    save();
    render();
  });
  $('newGameBtn').addEventListener('click', newGame);
  $('undoBtn').addEventListener('click', undo);
  $('langBtn').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'bn' : 'en';
    save();
    render();
  });
  $('soundBtn').addEventListener('click', () => {
    state.sound = !state.sound;
    save();
    render();
  });
  render();
}

document.addEventListener('DOMContentLoaded', init);
