# Checkers BD

A free, fully offline, bilingual (English / বাংলা) checkers game for Bangladesh.
Play classic 8×8 draughts against the computer or a friend on the same device.
No account, no server, no network requests — your games and stats never leave
this device.

## Features

- **Two game modes** — You vs Computer, or two-player pass-and-play.
- **Three computer strengths** — Easy (random), Medium (greedy: prefers
  captures, promotions and advancing), Hard (depth-3 alpha-beta search).
- **Real American checkers rules** — forced captures, chained multi-jumps,
  king promotion (promotion ends the turn), win by capturing all enemy
  pieces or leaving the opponent with no legal move.
- **House draw rule** — 60 moves without a capture ends the game drawn.
- **Move hints** — tap a piece to see its legal destinations; capture
  destinations are ringed. Multi-jump chains stay highlighted until done.
- **Move history** — every move in algebraic notation with capture counts.
- **Career stats** — wins, losses, draws, current and best win streaks,
  persisted in `localStorage`.
- **Resume anytime** — the current game, history and settings persist across
  reloads. Corrupt or outdated saves are sanitized, never fatal.
- **Undo** — rewinds a full round against the computer (your move + its
  reply) or one move in two-player mode.
- **Bilingual UI** — English / বাংলা toggle, persisted, with Bengali digits
  in counts and history.
- **Sound** — small WebAudio move / capture / king / win / lose cues with a
  mute toggle. No audio files are shipped.
- **Mobile friendly** — responsive layout, verified at 390 px with no
  horizontal overflow.

## Rules summary

Red moves first and moves up the board; Black moves down. Men step one
diagonal square forward; kings step one diagonal square in any direction.
Jump an adjacent enemy piece onto the empty square behind it to capture it.
Captures are **mandatory**: when any capture exists, only captures are
legal, and you must keep jumping with the same piece while jumps remain.
A man reaching the far row becomes a king and its turn ends immediately.
Win by capturing all enemy pieces or leaving your opponent with no legal
move. This is a casual game; it is not a tournament or officially
certified product.

## Stack

Plain HTML, CSS and JavaScript — no framework, no build step, no backend.
The rules engine (`logic.js`) is DOM-free and fully unit-tested; the UI
controller (`app.js`) renders the board and owns persistence.

## Run locally

```sh
# Any static server, or just open the file:
open index.html
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Testing

```sh
node tests/test.js    # 42 unit tests for the rules engine + AI
node tests/smoke.js   # 24 headless-Chrome (CDP) UI smoke tests, file:// page
```

The smoke suite spawns `/opt/meta-chromium/chrome` and covers the initial
board, move hints, a full player + computer exchange, undo, two-player
mode, the Bengali toggle and persistence, a seeded double-jump chain
(end-to-end multi-jump UI, including promotion), new game, 390 px layout
and zero console errors.

## Project structure

```
index.html   page shell (all labels via data-i18n)
style.css    responsive styles
logic.js     rules engine + AI (no DOM)
i18n.js      English / বাংলা strings
app.js       UI controller, persistence, sound
tests/
  test.js    node unit tests
  smoke.js   headless-Chrome smoke tests
```

## Limitations

- The computer plays at casual strength only; Hard is a depth-3 search,
  not a championship engine, and there is no opening book or endgame table.
- No online multiplayer — two-player mode is pass-and-play on one device.
- The draw rule (60 capture-free moves) is a house rule, not an official
  tournament rule.
- Sounds need a browser with WebAudio; the game plays silently without it.

## Status

Complete MVP. See `TEST_RESULTS.md` for the verified test run.
