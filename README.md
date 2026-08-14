# Arghipelago: A Pirate Roguelike

A browser-first, tile-based traditional roguelike about a shipwrecked captain, a missing crew, and an island with an immediate skeleton problem.

The first playable prototype includes:

- Seeded procedural island generation and fog of war.
- Eight-direction turn-based movement and melee bump attacks.
- A flintlock with targeting, noise, ammunition, and reloading.
- Three recruitable crew members with spatially delivered orders and close, ranged, and avoid stances.
- Per-actor melee and ranged loadouts with adjacent equipment transfer.
- Persistent ground firearms with deliberate pickup and dropping.
- Melee weapon damage properties and a discoverable boarding axe.
- Deterministic enemy loot: bonegunners drop firearms, while skeletons and crabs may drop supplies or blades.
- Bonegunners telegraph dry-powder openings by spending a turn reloading after each shot.
- Leather and breastplate armor with physical damage reduction and ironclad enemy drops.
- Armed crew fire and reload from party shot, with gunners receiving better accuracy.
- Seeded crew traits with hazard, blast, and rescue reactions.
- Deterministic special enemies with distinct reactive attributes.
- Spatial noise and terrain-aware enemy investigation.
- Terrain cover and faction-symmetric melee flanking.
- Deterministic squalls, rain, wet powder, and coastal dousing.
- A procedurally generated cave containing a required repair objective.
- Danger that escalates with time, waiting, noise, and repair progress.
- A shipwreck refuge where a nearby, conscious party can recover after clearing local threats.
- Repair objectives, victory, permadeath, and conditional rescue.
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
- `S`: use smelling salts to rescue adjacent crew or restore vigor
- `D`: make a deliberate noise to lure nearby enemies
- `P`: fire a pitch-soaked shot after recovering the pitch barrel
- `T`: enter inspection mode or throw a stone at the selected visible tile
- `C`: cycle crew orders
- `V`: cycle crew combat stances
- `I`: open the keyboard-accessible equipment menu for adjacent trades and drops
- `A`: order crew to attack the selected target
- `E`: interact with the wreck or cave stairs
- `X`: inspect the map; movement keys move the inspection cursor
- `>`: use cave stairs
- `?`: toggle controls
- `Escape`: cancel targeting

After a run ends, `Enter` retries the same captain and seed; `N` returns to captain creation.

Mouse hover or click inspects map tiles. Touch controls appear on mobile and other coarse-pointer devices; tap the map or use Inspect map, then move the cursor with the direction pad.
