# Arghipelago: A Pirate Roguelike

A browser-first, tile-based traditional roguelike about a shipwrecked captain, a missing crew, and an island with an immediate skeleton problem.

The first playable prototype includes:

- Seeded procedural island generation and fog of war.
- Eight-direction turn-based movement and melee bump attacks.
- A flintlock with targeting, noise, ammunition, and reloading.
- Three recruitable crew members with follow, hold, and rally orders.
- A procedurally generated cave containing a required repair objective.
- Escalating danger, repair objectives, victory, permadeath, and conditional rescue.
- Keyboard and touch controls.
- A monochromatic, crosshatched pen-and-ink sprite renderer.
- Browser-local save and resume.

The broader design and requirements are in `DESIGN.md`.

## Development

Arghipelago targets Node `26.7.0` and npm `11.19.0`. Version files are provided for compatible Node version managers. Node `26.7.0` is also installed as a project development dependency, so the project scripts use the correct runtime even when the system installation is older.

```sh
npm install
npm run dev
```

Open the URL printed by Vite.

Append `?seed=any-seed` to start a default captain immediately on a reproducible island for development and debugging. Add `&level=cave` to start at that seed's cave entrance.

## Verification

```sh
npm test
npm run build
```

Tests exercise deterministic game creation and validate connected procedural terrain across 100 seeds.

## Controls

- Arrow keys, `HJKL`, or keypad `8/4/2/6`: cardinal movement
- `YUBN` or keypad `7/9/1/3`: diagonal movement
- `.` or keypad `5`: wait
- `F`: select a target or fire at the selected target
- `Tab`: cycle visible targets
- `Enter`: fire at the selected target
- `R`: reload the flintlock
- `C`: cycle crew orders
- `A`: order crew to attack the selected target
- `E`: interact with the wreck or cave stairs
- `>`: use cave stairs
- `?`: toggle controls
- `Escape`: cancel targeting

Touch controls appear on mobile and other coarse-pointer devices.
