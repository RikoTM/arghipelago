# Arghipelago: A Pirate Roguelike

## Design Goals and Requirements

Status: Approved direction; prototype implementation in progress

Primary platform: Desktop web browser

Secondary platform: Mobile web browser
Initial scope: The starting island, its caves, and on-land play

## 1. Game Vision

**Arghipelago: A Pirate Roguelike** is a tile-based, turn-based traditional roguelike set in a fictional, fantastical 1600s Caribbean-inspired archipelago. The player is the captain of a shipwrecked pirate crew. Stranded on a procedurally generated island, the captain must keep the surviving crew alive, explore hostile wilderness and caves, recover supplies and ship parts, and repair the wrecked vessel.

The game should combine the tactical clarity and procedural danger of traditional roguelikes with the identity of commanding a small pirate crew. Every turn should present understandable choices, and every expedition away from the wreck should balance discovery, dwindling resources, crew safety, and the risk of permanent loss.

The initial release focuses on proving that the captain-and-crew experience is compelling on one island. Sailing, naval combat, and a persistent multi-island campaign are later goals.

## 2. Design Pillars

### 2.1 Traditional Roguelike Foundations

- Play takes place on a discrete two-dimensional tile grid.
- The world advances only when the player takes a turn or explicitly waits.
- Levels and encounters are procedurally generated for each new run.
- Positioning, terrain, line of sight, resource use, and enemy knowledge drive combat decisions.
- Runs use permadeath by default. Death and failure should be consequential, quick to understand, and followed by a fast restart.
- Rules should interact consistently enough to produce emergent situations rather than relying primarily on scripted sequences.

### 2.2 Captain, Not Lone Hero

- The player directly controls the captain.
- Surviving crew members are persistent companions with distinct capabilities, equipment, health, and dispositions.
- The captain influences companions through orders rather than controlling every crew member turn by turn.
- Orders must create meaningful tactical options without turning play into slow party micromanagement.
- Protecting, positioning, and relying on the crew should be central to success.

### 2.3 A Hostile, Discoverable Island

- Each island should feel geographically coherent rather than like unrelated random rooms.
- Beaches, jungle, rocky heights, ruins, freshwater, wreckage, and cave entrances should create recognizable regions and navigation choices.
- Exploration should reveal useful landmarks, threats, shortcuts, and resources.
- The shipwreck acts as the initial refuge, repair site, and navigational anchor.
- Caves should be more enclosed and dangerous than the surface, with distinct terrain, enemies, rewards, and visibility constraints.

### 2.4 Flintlocks and Cutlasses

- Melee and ranged combat must both be useful and tactically different.
- Melee emphasizes engagement, reach, flanking, chokepoints, and protecting vulnerable crew.
- Firearms are powerful but constrained by ammunition, reload time, noise, and line of fire.
- Bows, thrown weapons, or other quieter ranged options may trade power for reliability or stealth.
- Combat outcomes must be legible: the player should understand attacks, damage, status effects, misses, and enemy reactions.

### 2.5 Seafaring Fantasy, Grounded Rules

- The setting draws from the age of sail without requiring historical simulation.
- Mundane threats such as rival pirates, castaways, wildlife, hunger, and injury coexist with skeletons, sea nymphs, slags, curses, and other maritime fantasy.
- Supernatural elements should feel mysterious and dangerous while still obeying learnable game rules.
- Names, factions, folklore, and geography should be original to the fictional archipelago rather than reproducing real people or islands.

### 2.6 Browser-First Accessibility

- A run should begin quickly without installation, account creation, or mandatory onboarding screens.
- Keyboard play is the desktop standard, with mouse support for inspection and common actions.
- Mobile play must remain fully functional through a touch interface designed for deliberate turn-based input.
- The display should evoke a traditional roguelike while remaining readable to players unfamiliar with ASCII interfaces.

## 3. Target Player Experience

The intended early-run arc is:

1. Wake on the beach beside the wreck with a small group of surviving crew.
2. Assess injuries, salvage nearby supplies, equip the party, and identify what is needed to repair the ship.
3. Establish enough safety around the wreck to use it as a base.
4. Explore the island, marking landmarks and locating food, water, tools, survivors, and cave entrances.
5. Fight or avoid island threats while learning how to direct the crew.
6. Enter increasingly dangerous caves and ruins to recover the critical repair materials.
7. Return to the wreck, complete repairs, and finish the initial-island scenario by making the ship seaworthy.

The player should regularly experience:

- Relief at finding a route, cache, or source of supplies.
- Tension when visibility, ammunition, health, or crew cohesion is low.
- Satisfaction from a well-timed volley, formation order, retreat, or use of terrain.
- Attachment to crew members who survive dangerous expeditions.
- Curiosity about landmarks and threats glimpsed beyond the explored area.
- A clear sense that leaving the island has been earned.

## 4. Initial Scope

### 4.1 Vertical Slice

The first playable milestone is one complete, replayable island scenario. A run begins at the shipwreck and ends when the player repairs the ship, the captain dies, or the remaining crew can no longer continue.

The vertical slice must include:

- One procedurally generated surface island.
- At least one procedurally generated cave network connected to the surface.
- A shipwreck base and a multi-step ship repair objective.
- Turn-based captain movement, interaction, melee combat, and ranged combat.
- A small crew that follows the captain and responds to tactical orders.
- Hostile creatures and humanoid enemies with distinguishable behavior.
- Items, equipment, inventory, health, status effects, and limited resources.
- Fog of war, line of sight, and an exploration map.
- A complete success state, failure state, run summary, and immediate restart path.
- Save and resume for an active run in the same browser.
- Desktop keyboard controls and a usable mobile touch-control layout.

### 4.2 Explicitly Deferred

The initial milestone does not require:

- Sailing between islands.
- Ship-to-ship or naval combat.
- Procedural generation of a full archipelago.
- Ship boarding actions.
- Town economies, ports, or extensive faction diplomacy.
- A long-form metagame or permanent statistical upgrades between runs.
- Multiplayer or online accounts.
- Full historical simulation of sailing, weapons, medicine, or survival.
- Direct turn-by-turn control of every crew member.

These features should not constrain the initial implementation beyond avoiding obvious dead ends in the core data model.

## 5. Core Game Requirements

### 5.1 Turn and Action System

**R-TURN-1:** The game world must not advance while awaiting player input.

**R-TURN-2:** Movement, attacks, item use, interaction, reloading, issuing orders, and waiting must consume defined amounts of game time.

**R-TURN-3:** Actors may have different action speeds, but turn order and multi-turn actions must be communicated clearly.

**R-TURN-4:** Invalid actions must not consume a turn unless the rule is intentional and visibly explained.

**R-TURN-5:** The game must require confirmation before an obviously dangerous contextual action, such as attacking a non-hostile crew member.

### 5.2 World Generation

**R-WORLD-1:** Every new run must generate a new island from a reproducible seed.

**R-WORLD-2:** The island must have a continuous coastline, passable starting beach, shipwreck, inland regions, and one or more cave entrances.

**R-WORLD-3:** Generated worlds must guarantee a traversable path from the starting area to every location required to complete ship repairs.

**R-WORLD-4:** Required resources must not be made permanently inaccessible by generation, enemy placement, or a single random event.

**R-WORLD-5:** The generator must create recognizable terrain regions and landmarks that help players navigate.

**R-WORLD-6:** Surface and cave maps must support terrain-specific movement, cover, visibility, hazards, and encounter placement.

**R-WORLD-7:** The run summary must expose the world seed so a world can be reproduced during testing and optionally replayed.

### 5.3 Exploration and Visibility

**R-EXPLORE-1:** Unseen tiles must be hidden, currently visible tiles clearly shown, and previously seen tiles visually remembered.

**R-EXPLORE-2:** Vision must be blocked or modified by terrain such as walls, dense vegetation, darkness, smoke, and elevation where applicable.

**R-EXPLORE-3:** The player must be able to inspect visible and remembered tiles, actors, items, and terrain.

**R-EXPLORE-4:** Important discovered landmarks, including the wreck and cave entrances, must remain identifiable on the map.

**R-EXPLORE-5:** The interface must provide a readable message log for nearby sounds, combat results, discoveries, and crew reactions.

**R-EXPLORE-6:** Surface exploration should support returning to the wreck without requiring the player to memorize an arbitrary route.

### 5.4 Captain

**R-CAPTAIN-1:** The player must directly move and act as the captain.

**R-CAPTAIN-2:** The captain must have health, combat attributes, equipment, inventory capacity, and a set of command abilities.

**R-CAPTAIN-3:** The captain must be able to perform at least one melee attack and one ranged attack when properly equipped.

**R-CAPTAIN-4:** The captain must be able to interact with terrain features, containers, loot, crew, and the shipwreck.

**R-CAPTAIN-5:** Captain death normally ends the run, but rare items or timely crew actions may rescue an incapacitated captain before death becomes final.

### 5.5 Crew

**R-CREW-1:** A run must begin with the captain alone. Up to three surviving or stranded crew members may be found and recruited while exploring the island.

**R-CREW-2:** Each crew member must have a name, role or specialty, current health, equipment, and at least one trait that affects behavior or capability.

**R-CREW-3:** Crew members must navigate around one another, avoid known hazards when practical, and follow orders without requiring movement input for each member.

**R-CREW-4:** The player must be able to inspect each crew member's state and understand why they cannot follow an order.

**R-CREW-5:** Crew members may be injured, incapacitated, or killed. These outcomes must be visible and affect the player's available tactics.

**R-CREW-6:** Crew members must not casually block the captain in a way that causes routine navigation deadlocks.

**R-CREW-7:** The initial command set must include equivalents of:

- **Follow:** Stay near and move with the captain.
- **Hold:** Defend the current position.
- **Attack:** Focus on a selected target or hostile area.
- **Rally:** Disengage and move toward the captain or a selected safe point.
- **Stance:** Prefer close combat, ranged combat, or avoiding engagement.

**R-CREW-8:** Issuing a command must have a clear time cost, range, and feedback. Crew may fail to hear or execute an order for an understandable reason.

### 5.6 Combat

**R-COMBAT-1:** Combat must occur on the exploration grid without switching to a separate battle scene.

**R-COMBAT-2:** Melee attacks must account for weapon properties, actor capability, target defenses, and relevant positioning or terrain modifiers.

**R-COMBAT-3:** Ranged attacks must require a valid target and line of fire. Intervening actors and terrain must have predictable effects.

**R-COMBAT-4:** Black-powder firearms must be powerful, noisy, ammunition-limited, and require reloading that consumes one or more actions.

**R-COMBAT-5:** Noise from gunfire and other loud actions must be capable of alerting or attracting nearby enemies.

**R-COMBAT-6:** Friendly fire risk must be communicated before a ranged attack is committed.

**R-COMBAT-7:** The player must be able to retreat, break line of sight, use chokepoints, and avoid at least some encounters.

**R-COMBAT-8:** Damage, misses, critical effects, death, and status changes must be presented in the map display or message log.

**R-COMBAT-9:** Initial status effects should remain concise and tactically relevant, such as bleeding, stunned, poisoned, burning, wet, or frightened.

**R-COMBAT-10:** Enemy behavior must differ by archetype. At minimum, the initial slice should demonstrate a melee pursuer, ranged attacker, ambusher, and supernatural enemy.

### 5.7 Items and Resources

**R-ITEM-1:** Actors must be able to carry, equip, use, drop, and transfer applicable items.

**R-ITEM-2:** Equipment must include at least melee weapons, ranged weapons, ammunition, clothing or armor, and utility items.

**R-ITEM-3:** Consumable resources must include ways to recover from injuries and sustain expeditions away from the wreck.

**R-ITEM-4:** Inventory limits must create decisions without requiring constant low-value item shuffling.

**R-ITEM-5:** Item descriptions must communicate mechanical effects before use when the captain could reasonably know them.

**R-ITEM-6:** Critical ship-repair items must be clearly distinguished from optional loot and must not be accidentally destroyed or irretrievably discarded.

### 5.8 Shipwreck and Repair Objective

**R-REPAIR-1:** The wreck must function as the run's initial base, a recognizable landmark, and the location where repairs are completed.

**R-REPAIR-2:** Repairing the ship must require multiple categories of supplies found through different kinds of exploration, including at least one cave objective.

**R-REPAIR-3:** The player must be able to inspect the wreck to see completed repairs, missing requirements, and useful hints about where to search.

**R-REPAIR-4:** Progress returned to the wreck must be retained during the run.

**R-REPAIR-5:** Completing all repairs must trigger an unambiguous victory sequence and run summary.

**R-REPAIR-6:** The objective structure should allow different ordering or methods for obtaining at least some repair resources.

### 5.9 Survival and Rest

**R-SURVIVAL-1:** The initial slice may track expedition pressure such as hunger, thirst, fatigue, injury, or daylight, but should include no more than three global survival meters.

**R-SURVIVAL-2:** Survival systems must create route and resource decisions rather than frequent repetitive maintenance.

**R-SURVIVAL-3:** Resting or recovering must advance time and expose the party to an appropriate cost or risk.

**R-SURVIVAL-4:** A run must not become silently unwinnable because a survival resource was consumed; the game must signal severe danger and provide a reasonable recovery path.

### 5.10 Enemies and Ecology

**R-ENEMY-1:** Enemy placement must account for terrain, region, and faction rather than being uniformly random.

**R-ENEMY-2:** Enemies must have states such as unaware, suspicious, alert, pursuing, retreating, or guarding where appropriate.

**R-ENEMY-3:** Hostile and non-hostile actors must be visually distinguishable, subject to uncertainty when intentionally disguised or unknown.

**R-ENEMY-4:** The starting area must provide enough safety and information for a new player to make an initial plan before facing lethal pressure.

**R-ENEMY-5:** The initial content set should mix pirate-themed and fantasy threats. Candidate archetypes include rival buccaneers, feral castaways, skeleton sailors, sea nymphs, slags, giant crabs, snakes, and cave vermin.

**R-ENEMY-6:** Fantasy creatures must have specific, learnable mechanics rather than differing only in health and damage.

## 6. Interface and Control Requirements

### 6.1 Information Layout

The desktop interface should reserve clear regions for:

- The tile map as the primary focus.
- Captain health, currently equipped weapons, ammunition, and important conditions.
- Compact status for each active crew member.
- Current objective or ship repair progress.
- Recent messages and combat results.
- Contextual action, target, and command prompts.

The map must use readable, sprite-based tiles rendered like monochromatic pen-and-ink sketches. Crosshatching, line weight, silhouette, and sparse accent colors should distinguish terrain and actors; meaning must not depend on color alone.

### 6.2 Desktop Controls

**R-UI-DESKTOP-1:** All required game actions must be available from the keyboard.

**R-UI-DESKTOP-2:** Movement must support eight directions plus waiting through a documented layout, with remapping treated as a desirable follow-up.

**R-UI-DESKTOP-3:** Mouse input must support inspection and may support movement, targeting, menus, and contextual actions.

**R-UI-DESKTOP-4:** Common actions must require few inputs, while dangerous or irreversible actions must use confirmation where appropriate.

### 6.3 Mobile Controls

**R-UI-MOBILE-1:** The game must be playable in a modern mobile browser without a hardware keyboard.

**R-UI-MOBILE-2:** Touch movement must support deliberate eight-direction input and waiting without relying on imprecise taps on small map tiles.

**R-UI-MOBILE-3:** Targeting, inspection, inventory, and crew commands must have touch-accessible controls with adequate hit areas.

**R-UI-MOBILE-4:** The layout must adapt to a smaller viewport without hiding critical health, threat, or targeting information.

**R-UI-MOBILE-5:** Browser scrolling, zooming, and navigation gestures must not routinely cause accidental game actions.

### 6.4 Accessibility

**R-A11Y-1:** Text and essential interface elements must meet WCAG 2.2 AA contrast guidance where practical for game content.

**R-A11Y-2:** Information conveyed by color must also use shape, icon, label, pattern, or another cue.

**R-A11Y-3:** The player must be able to adjust text size and reduce or disable nonessential animation and screen shake.

**R-A11Y-4:** Inputs must not require rapid timing, holding multiple keys, or reflex gestures.

**R-A11Y-5:** Sound may reinforce events but must not be the only way to detect tactically important information.

## 7. Presentation and Tone

- Visual direction should be readable, high-contrast, and evocative of weathered charts, ink, timber, salt, jungle, and torchlit stone.
- The game should use characterful sprite art in a monochromatic, crosshatched sketch style. It should evoke an illustrated ship's log or engraved field guide rather than conventional full-color pixel art.
- A warm paper ground, near-black ink, weathered sepia, and one or two restrained status accents should form the main palette.
- Sprites may be drawn at a deliberately low logical resolution, but outlines and hatching should feel hand-inked rather than blocky. Readability at a glance has priority over detail.
- Writing should be adventurous, wry, and somewhat humorous without taking the setting too seriously. Jokes should arise from character, pirate misfortune, item descriptions, and absurd situations rather than undermining every danger or crew loss.
- Period flavor should be selective and understandable. Interface text must favor clarity over dense nautical dialect.
- The setting may use the spelling "pyrate" as occasional in-world flavor, not as a substitute for clear everyday terminology.
- Music and sound should reinforce place and tactical events, especially gunshots, enemy alerts, crew acknowledgements, and nearby unseen activity.

## 8. Technical and Quality Requirements

No framework or rendering technology is selected by this document. The implementation must satisfy these constraints:

**R-TECH-1:** The primary build must run in current stable desktop versions of Chrome, Firefox, Safari, and Edge.

**R-TECH-2:** Mobile support must target current stable Safari on iOS and Chrome on Android.

**R-TECH-3:** Core simulation rules must be separable from rendering and input so they can be tested without a browser display.

**R-TECH-4:** The game simulation must support deterministic execution from a seed and an ordered sequence of player actions, excluding presentation-only effects.

**R-TECH-5:** Saving must use browser-local storage and preserve one active run across refreshes and browser restarts.

**R-TECH-6:** Save data must include a version and fail safely when corrupt or incompatible, without preventing a new run.

**R-TECH-7:** The game must pause safely when its browser tab loses focus; elapsed real time must not advance the simulation.

**R-TECH-8:** Initial loading should remain reasonable on typical consumer broadband and should not require a server after static assets are loaded.

**R-TECH-9:** Normal play should maintain responsive input and rendering on a typical modern laptop and mid-range mobile device.

**R-TECH-10:** Procedural generation tests must check reachability, required-objective placement, valid start conditions, and absence of blocking generation failures across many seeds.

**R-TECH-11:** Automated tests must cover core turn resolution, combat rules, line of sight, crew orders, save round trips, and deterministic replay.

**R-TECH-12:** Development builds must provide a way to start a known seed and inspect enough state to reproduce generation and simulation bugs.

## 9. Initial Content Budget

The first balanced vertical slice should aim for enough variety to validate the systems without requiring a campaign-sized content set:

| Content | Initial target |
| --- | ---: |
| Surface island biome set | 1 coherent set with 4-6 terrain regions |
| Cave themes | 1-2 |
| Crew roles | 4-6 |
| Crew traits | 8-12 |
| Enemy archetypes | 8-12 |
| Melee weapon families | 4-6 |
| Ranged weapon families | 3-4 |
| Utility and consumable item types | 12-20 |
| Tactical status effects | 4-6 |
| Ship repair objective categories | 3-5 |
| Major landmarks or encounter sites | 5-8 |

These are planning ranges, not promises. Each addition should have a distinct tactical or exploratory purpose.

## 10. Success Criteria for the First Playable Milestone

The initial-island slice is successful when:

1. A first-time player can start, move, inspect the world, attack, and issue a basic crew order using in-game guidance.
2. A complete run can proceed from shipwreck to repaired ship without developer tools.
3. At least 100 automated generation seeds produce valid, completable objective layouts with no unreachable required areas.
4. Melee, firearm use, retreat, terrain, and at least three crew orders are all useful during ordinary play.
5. The captain and crew can navigate surface and cave maps without recurring pathfinding deadlocks.
6. A saved run can be refreshed and resumed at the same deterministic game state.
7. The complete scenario is usable with keyboard-only desktop input and touch-only mobile input.
8. Failure communicates its cause, presents a useful run summary and seed, and allows a new run to begin immediately.
9. Multiple runs produce meaningfully different routes, encounters, resource pressures, and tactical stories.
10. Playtesting supports the central claim: commanding a pirate crew makes this feel distinct from controlling a lone roguelike hero.

## 11. Design Risks

### Crew Friction

Companion AI can create frustration through blocked movement, wasted ammunition, unwanted aggression, or failure to obey. Orders, defaults, path swapping, and explanations should be prototyped before adding many crew abilities.

### Procedural Coherence

A geographically plausible island is harder to generate than a conventional room-and-corridor dungeon. Generation should be built as constrained stages with validation and repair, not as unconstrained random placement.

### Mobile Input Density

Traditional roguelikes expose many actions and status details. Mobile support will fail if it merely overlays a small virtual keyboard. The touch command flow should be prototyped alongside desktop controls.

### Survival Busywork

Food, water, fatigue, wounds, ammunition, and crew morale could overwhelm tactical play. New resource systems should be added only when they create decisions not already represented by another system.

### Scope Expansion

Sailing and the broader archipelago are central to the fantasy but not needed to prove the first-island gameplay. They should remain outside the first milestone until on-land exploration, crew command, and combat are satisfying.

## 12. Approved Design Decisions

The initial implementation will use these reviewed decisions:

1. **Visual representation:** readable sprite-based tiles in a mostly monochromatic, crosshatched pen-and-ink style, presented through an atmospheric pirate-themed interface.
2. **Crew scale:** the captain begins alone and may find and recruit up to three crew members during the run.
3. **Crew control:** the player directly controls only the captain; crew members use predictable AI and respond to orders.
4. **Failure model:** captain death normally ends the run, but rare items or timely crew intervention may rescue an incapacitated captain.
5. **Survival depth:** light pressure centered on wounds, abstract supplies, and ammunition rather than detailed food and water bookkeeping.
6. **Time pressure:** danger escalates in response to time, resting, noise, or progress, but there is no fixed deadline.
7. **Character creation:** the player chooses a captain name, appearance, background, and defining knack.
8. **Progression:** runs may unlock new backgrounds, items, lore, and challenges, but not permanent statistical advantages.
9. **Fantasy level:** supernatural threats and absurdities are visible from the beginning rather than being reserved for a late reveal.
10. **Scenario length:** a successful first-island run should take roughly 60-90 minutes once the player understands the game.
