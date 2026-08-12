# Repository Guide

## Toolchain

- Use npm and keep `package-lock.json`; this is a single-package project, not a workspace.
- Target Node `26.7.0` and npm `11.19.0`. Project scripts invoke tool files through `node` so the development dependency can supply the pinned Node runtime even when the shell Node is older.
- Install with `npm install`. There are no separate lint, formatter, typecheck, codegen, CI, or pre-commit tasks.

## Commands

- Start Vite: `npm run dev`.
- Run all tests: `npm test`.
- Run one file or test: `npm test -- src/game/game.test.ts` or `npm test -- src/game/game.test.ts -t "test name"`.
- Typecheck and production-build: `npm run build`; the script runs strict `tsc --noEmit` before Vite.
- For a reproducible browser run, open the dev URL with `?seed=<seed>`; add `&level=cave` to start at the cave entrance.

## Architecture And Invariants

- `src/main.ts` owns DOM/input wiring and localStorage; `src/render.ts` owns canvas drawing; `src/game/game.ts`, `world.ts`, `rng.ts`, and `types.ts` are the browser-independent mutable simulation.
- Keep simulation randomness deterministic. Construct `Rng` from the seed or `state.rngState`, then persist its final `state`; do not use `Math.random()` in game or world logic.
- Player actions mutate `GameState` in place. Invalid actions intentionally do not advance `state.turn`; successful turn-consuming actions must flow through `finishTurn` so crew, enemies, escalation, pickups, recruitment, visibility, and RNG state update consistently.
- Surface and cave maps have different dimensions. Always pass the active map's `width` (and `height` where needed) to `tileIndex`/`inBounds`; their defaults are surface dimensions.
- `GameState` is serialized wholesale to localStorage. If its persisted shape changes incompatibly, update both the literal `GameState.version` in `src/game/types.ts`/`src/game/game.ts` and `SAVE_KEY` plus validation in `src/main.ts`.
- Generation and balance changes must preserve deterministic equality, connected required terrain, the cave-only pitch objective, a quiet opening, and direct cave survivability across sampled seeds; these are asserted in `src/game/game.test.ts`.

## Product Constraints

- Keep keyboard and touch paths equivalent and layouts usable on desktop and mobile; touch controls are enabled by narrow viewport or coarse pointer in `src/style.css`.
- Treat `DESIGN.md` as product direction, but trust implemented scripts, types, and tests when it differs from the prototype.
