# Checkers BD — Test Results (2026-10-30, 17:00 slot)

## Unit tests — 42/42 pass

`node tests/test.js` — rules engine (`logic.js`) + AI, no DOM:

- Initial position: 12 red / 12 black, all on dark squares, 7 moves per side,
  all quiet, symmetric evaluation 0.
- Quiet move applies cleanly and does not mutate the input board.
- Forced capture: when a capture and a quiet move both exist, only captures
  are legal.
- Single jump removes the captured piece.
- Multi-jump: a double-capture sequence is generated, applies both removals,
  and crowns on the last row.
- Promotion ends the chain: a man crowned mid-sequence does not continue
  jumping as a king in the same turn.
- Men move forward only (2 moves from centre); kings move all 4 diagonals;
  kings capture backward.
- Continuation moves are offered from the landing square after a partial jump.
- Win detection: no pieces, no legal moves; draw at 120 capture-free
  half-moves; initial position is not over.
- AI (Easy / Medium / Hard) always returns a legal move, including on a
  capture position.
- Algebraic notation: a1, h8, d5.

## Headless-Chrome smoke tests — 24/24 pass

`node tests/smoke.js` — raw CDP against `/opt/meta-chromium/chrome`,
`file://` page, zero console/page errors:

- Title/heading, 64 cells, 24 pieces (12 red / 12 black), "Your turn" status.
- Selecting the corner red man shows exactly 1 hint destination.
- Playing a move produces a player + computer history exchange, 24 pieces
  remain, turn returns to the player.
- Undo rewinds the full round (history empty again).
- Two-player mode disables the difficulty select and shows "Red's turn".
- Bengali toggle switches the heading to চেকার্স and persists
  `"lang":"bn"` in `localStorage`.
- Seeded double-jump scenario: capture hint ringed, chain continues to the
  second landing, history records `×2`, both black pieces captured, "Red
  wins" shown.
- New game restores 24 pieces; 390 px viewport has no horizontal overflow.

## Repairs made during testing (2 cycles)

1. Multi-jump history bug: the chain-completion path recorded `to` from a
   field the chain object does not carry (`done.to` was `undefined`),
   throwing inside the history renderer. Fixed by recording the final
   landing (`done.pos`). Found by the seeded double-jump smoke scenario.
2. Save robustness: saves written by the buggy build (history entries
   without `to`) crashed the renderer on the next load. `load()` now
   sanitizes history entries (game + snapshots) instead of trusting them.

After both fixes the full suite passes twice consecutively, including
against the previously stale browser profile that carried the corrupt save.
