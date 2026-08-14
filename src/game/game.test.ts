import { describe, expect, it } from "vitest";
import {
  areActorsHostile,
  commandCrewAttack,
  createGame,
  cycleCrewOrder,
  cycleCrewStance,
  dropArmor,
  dropFirearm,
  dropMeleeWeapon,
  fireFlintlock,
  environmentAt,
  firePitchShot,
  getCaptain,
  getArmorTransferLabel,
  getFaction,
  getMeleeTransferLabel,
  getInteractionLabel,
  getRunSummary,
  inspectMapPoint,
  interact,
  isAttributeCompatible,
  isWet,
  makeDistraction,
  moveCaptain,
  reloadFlintlock,
  throwStone,
  transferFirearm,
  transferMeleeWeapon,
  transferArmor,
  updateVisibility,
  useSmellingSalts,
  useStairs,
  visibleEnemies,
  waitTurn,
} from "./game";
import type { Actor, CaptainConfig, CrewTrait, EnemyAttribute, MeleeWeapon } from "./types";
import { generateCave, generateIsland, isPassableTerrain, tileIndex } from "./world";

const captain: CaptainConfig = {
  name: "Testbeard",
  background: "privateer",
  knack: "duelist",
  coat: "crimson",
};

function pursue(actor: Actor, target: Actor, expiresAtTurn = 100): void {
  actor.enemyAwareness = {
    mode: "pursuing",
    targetId: target.id,
    lastKnownPosition: { x: target.x, y: target.y },
    expiresAtTurn,
  };
}

function routeTo(
  tiles: ReturnType<typeof generateIsland>["tiles"],
  width: number,
  height: number,
  start: { x: number; y: number },
  goal: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const queue = [start];
  const previous = new Map<number, { x: number; y: number } | null>([[tileIndex(start.x, start.y, width), null]]);
  const directions = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ] as const;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor];
    if (!point || (point.x === goal.x && point.y === goal.y)) break;
    for (const [dx, dy] of directions) {
      const next = { x: point.x + dx, y: point.y + dy };
      const index = tileIndex(next.x, next.y, width);
      const tile = tiles[index];
      if (
        next.x < 0 || next.y < 0 || next.x >= width || next.y >= height ||
        previous.has(index) || !tile || !isPassableTerrain(tile.terrain)
      ) continue;
      previous.set(index, point);
      queue.push(next);
    }
  }
  const route: Array<{ x: number; y: number }> = [];
  let point: { x: number; y: number } | null | undefined = goal;
  while (point && (point.x !== start.x || point.y !== start.y)) {
    route.push(point);
    point = previous.get(tileIndex(point.x, point.y, width));
  }
  return route.reverse();
}

describe("island generation", () => {
  it("is deterministic for a seed", () => {
    const first = generateIsland("same-old-island");
    const second = generateIsland("same-old-island");

    expect(first.wreck).toEqual(second.wreck);
    expect(first.tiles.map((tile) => tile.terrain)).toEqual(second.tiles.map((tile) => tile.terrain));
  });

  it("provides enough connected land for all required content across 100 seeds", () => {
    for (let index = 0; index < 100; index += 1) {
      const island = generateIsland(`validation-${index}`);
      const cave = generateCave(`validation-${index}`);
      expect(island.reachable.length).toBeGreaterThan(400);
      expect(cave.reachable.length).toBeGreaterThan(150);
      expect(island.tiles[tileIndex(island.wreck.x, island.wreck.y, island.width)]?.terrain).toBe("wreck");
      expect(island.tiles[tileIndex(island.caveEntrance.x, island.caveEntrance.y, island.width)]?.terrain).toBe("stairsDown");
      expect(cave.tiles[tileIndex(cave.exit.x, cave.exit.y, cave.width)]?.terrain).toBe("stairsUp");
      expect(island.reachable.every((point) => {
        const tile = island.tiles[tileIndex(point.x, point.y, island.width)];
        return tile ? isPassableTerrain(tile.terrain) : false;
      })).toBe(true);

      const state = createGame(captain, `validation-${index}`);
      expect(state.pickups.filter((pickup) => ["mast", "canvas", "pitch"].includes(pickup.type))).toHaveLength(3);
      expect(state.pickups.find((pickup) => pickup.type === "pitch")?.level).toBe("cave");
      expect(state.pickups.filter((pickup) => pickup.type === "pistol")).toHaveLength(1);
      expect(state.pickups.filter((pickup) => pickup.type === "boardingAxe")).toHaveLength(1);
      expect(state.pickups.filter((pickup) => pickup.type === "leatherCoat")).toHaveLength(1);
      expect(state.actors.filter((actor) => actor.kind === "castaway")).toHaveLength(3);
    }
  });

  it("finishes cave placement for seeds that need additional attempts", () => {
    expect(generateCave("step-over-crew").reachable.length).toBeGreaterThan(150);
  });
});

describe("game simulation", () => {
  it("creates repeatable actors, pickups, and state", () => {
    expect(createGame(captain, "repeatable-run")).toEqual(createGame(captain, "repeatable-run"));
  });

  it("assigns unique deterministic crew traits without consuming simulation RNG", () => {
    const first = createGame(captain, "crew-personalities");
    const second = createGame(captain, "crew-personalities");
    const traits = first.actors
      .filter((actor) => actor.kind === "castaway")
      .map((actor) => actor.crewTrait);

    expect(traits).toHaveLength(3);
    expect(new Set(traits).size).toBe(3);
    expect(new Set(traits)).toEqual(new Set<CrewTrait>(["smokeShy", "powderShy", "shipmate"]));
    expect(first.rngState).toBe(second.rngState);
    expect(first.actors).toEqual(second.actors);
  });

  it("starts the captain and castaways with explicit role-appropriate loadouts", () => {
    const state = createGame(captain, "starting-loadouts");
    const player = getCaptain(state);
    const carpenter = state.actors.find((actor) => actor.role?.startsWith("Carpenter"));
    const surgeon = state.actors.find((actor) => actor.role?.startsWith("Surgeon"));
    const gunner = state.actors.find((actor) => actor.role?.startsWith("Gunner"));

    expect(player).toMatchObject({ meleeWeapon: "cutlass", rangedWeapon: "flintlock", rangedLoaded: true, armor: null });
    expect(carpenter).toMatchObject({ meleeWeapon: "cutlass", rangedWeapon: null, rangedLoaded: false, armor: null });
    expect(surgeon).toMatchObject({ meleeWeapon: "knife", rangedWeapon: null, rangedLoaded: false, armor: null });
    expect(gunner).toMatchObject({ meleeWeapon: "cutlass", rangedWeapon: "pistol", rangedLoaded: true, armor: null });
  });

  it("leaves generated firearms on the ground until deliberately picked up", () => {
    const state = createGame(captain, "ground-pistol-cache");
    const player = getCaptain(state);
    const pistol = state.pickups.find((pickup) => pickup.type === "pistol");
    expect(pistol).toBeDefined();
    if (!pistol) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = pistol.x;
    player.y = pistol.y;

    waitTurn(state);

    expect(pistol.collected).toBe(false);
    expect(getInteractionLabel(state)).toBe("Pick up pistol");
    expect(interact(state)).toBe(false);
    expect(state.turn).toBe(1);

    player.rangedWeapon = null;
    player.rangedLoaded = false;
    expect(interact(state)).toBe(true);
    expect(player).toMatchObject({ rangedWeapon: "pistol", rangedLoaded: true });
    expect(pistol.collected).toBe(true);
    expect(state.turn).toBe(2);
  });

  it("drops and retrieves a firearm without losing its loaded state", () => {
    const state = createGame(captain, "ground-firearm-round-trip");
    const player = getCaptain(state);
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });

    expect(dropFirearm(state)).toBe(true);
    const dropped = state.pickups.find(
      (pickup) => !pickup.collected && pickup.type === "flintlock" && pickup.x === player.x && pickup.y === player.y,
    );
    expect(dropped).toMatchObject({ loaded: true, level: "surface" });
    expect(player).toMatchObject({ rangedWeapon: null, rangedLoaded: false });
    expect(getInteractionLabel(state)).toBe("Pick up flintlock");
    expect(dropFirearm(state)).toBe(false);
    expect(state.turn).toBe(1);

    expect(interact(state)).toBe(true);
    expect(player).toMatchObject({ rangedWeapon: "flintlock", rangedLoaded: true });
    expect(dropped?.collected).toBe(true);
    expect(state.turn).toBe(2);
  });

  it("deliberately equips, drops, and retrieves the generated boarding axe", () => {
    const state = createGame(captain, "ground-boarding-axe");
    const player = getCaptain(state);
    const axe = state.pickups.find((pickup) => pickup.type === "boardingAxe");
    expect(axe).toBeDefined();
    if (!axe) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = axe.x;
    player.y = axe.y;

    waitTurn(state);
    expect(axe.collected).toBe(false);
    expect(getInteractionLabel(state)).toBe("Pick up boarding axe");
    expect(interact(state)).toBe(false);

    player.meleeWeapon = null;
    expect(interact(state)).toBe(true);
    expect(player.meleeWeapon).toBe("boardingAxe");
    expect(axe.collected).toBe(true);

    expect(dropMeleeWeapon(state)).toBe(true);
    const dropped = state.pickups.find(
      (pickup) => !pickup.collected && pickup.type === "boardingAxe" && pickup.x === player.x && pickup.y === player.y,
    );
    expect(dropped).toMatchObject({ loaded: false, level: "surface" });
    expect(player.meleeWeapon).toBeNull();
    expect(getInteractionLabel(state)).toBe("Pick up boarding axe");

    expect(interact(state)).toBe(true);
    expect(player.meleeWeapon).toBe("boardingAxe");
    expect(dropped?.collected).toBe(true);
  });

  it("deliberately equips, drops, and retrieves generated armor", () => {
    const state = createGame(captain, "ground-leather-coat");
    const player = getCaptain(state);
    const coat = state.pickups.find((pickup) => pickup.type === "leatherCoat");
    expect(coat).toBeDefined();
    if (!coat) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = coat.x;
    player.y = coat.y;

    waitTurn(state);
    expect(coat.collected).toBe(false);
    expect(getInteractionLabel(state)).toBe("Pick up leather coat");
    expect(interact(state)).toBe(true);
    expect(player.armor).toBe("leatherCoat");
    expect(coat.collected).toBe(true);

    expect(dropArmor(state)).toBe(true);
    const dropped = state.pickups.find(
      (pickup) => !pickup.collected && pickup.type === "leatherCoat" && pickup.x === player.x && pickup.y === player.y,
    );
    expect(dropped).toMatchObject({ loaded: false, level: "surface" });
    expect(player.armor).toBeNull();
    expect(getInteractionLabel(state)).toBe("Pick up leather coat");

    expect(interact(state)).toBe(true);
    expect(player.armor).toBe("leatherCoat");
    expect(dropped?.collected).toBe(true);
  });

  it("round-trips the complete active run through JSON storage", () => {
    const state = createGame(captain, "save-round-trip");
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(restored.version).toBe(19);
    expect(restored.environment).toEqual({ surface: [], cave: [] });
    expect(restored.surfaceWeather.phase).toBe("fair");
    expect(restored).toEqual(state);
    expect(restored.levels.cave.tiles).toHaveLength(state.levels.cave.width * state.levels.cave.height);
  });

  it("does not produce a run summary while play is active", () => {
    expect(getRunSummary(createGame(captain, "unfinished-voyage"))).toBeNull();
  });

  it("summarizes terminal runs from simulation state", () => {
    const state = createGame(captain, "voyage-summary");
    const recruits = state.actors.filter((actor) => actor.kind === "castaway").slice(0, 2);
    const defeated = state.actors.filter((actor) => actor.kind === "enemy").slice(0, 3);
    for (const recruit of recruits) recruit.kind = "crew";
    const casualty = recruits[1];
    if (casualty) casualty.alive = false;
    for (const enemy of defeated) enemy.alive = false;
    state.repairs = { mast: true, canvas: true, pitch: false };
    state.turn = 87;
    state.phase = "lost";

    expect(getRunSummary(state)).toEqual({
      phase: "lost",
      seed: "voyage-summary",
      turns: 87,
      installedRepairs: 2,
      recruitedCrew: 2,
      survivingCrew: 1,
      defeatedEnemies: 3,
    });
  });

  it("recovers repair cargo without installing it or granting victory", () => {
    const state = createGame(captain, "salvage-is-not-shipbuilding");
    const player = getCaptain(state);
    const mast = state.pickups.find((pickup) => pickup.type === "mast");
    expect(mast).toBeDefined();
    if (!mast) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = mast.x;
    player.y = mast.y;

    waitTurn(state);

    expect(mast.collected).toBe(true);
    expect(state.recoveredParts.mast).toBe(true);
    expect(state.threat).toBe(7);
    expect(state.repairs.mast).toBe(false);
    expect(state.phase).toBe("playing");
  });

  it("inspects the wreck without spending a turn when no repair is ready", () => {
    const state = createGame(captain, "honest-shipwright");

    expect(getInteractionLabel(state)).toBe("Inspect wreck");
    expect(interact(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(state.messages.at(-1)).toContain("replacement mast missing; search the island");
    expect(state.messages.at(-1)).toContain("pitch barrel missing; search the cave");
  });

  it("installs one recovered part per turn and wins only after the final turn resolves", () => {
    const state = createGame(captain, "three-part-repair");
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    state.recoveredParts = { mast: true, canvas: true, pitch: true };

    expect(getInteractionLabel(state)).toBe("Fit replacement mast");
    expect(interact(state)).toBe(true);
    expect(state.repairs).toEqual({ mast: true, canvas: false, pitch: false });
    expect(state.turn).toBe(1);
    expect(state.phase).toBe("playing");

    expect(getInteractionLabel(state)).toBe("Fit sailcloth");
    expect(interact(state)).toBe(true);
    expect(state.repairs).toEqual({ mast: true, canvas: true, pitch: false });
    expect(state.turn).toBe(2);
    expect(state.phase).toBe("playing");

    expect(getInteractionLabel(state)).toBe("Fit pitch barrel");
    expect(interact(state)).toBe(true);
    expect(state.repairs).toEqual({ mast: true, canvas: true, pitch: true });
    expect(state.turn).toBe(3);
    expect(state.phase).toBe("won");
  });

  it("does not award victory if the captain dies during the final installation turn", () => {
    const state = createGame(captain, "fatal-shipbuilding");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    for (const actor of state.actors) {
      if (actor.kind === "enemy") actor.alive = actor.id === enemy.id;
    }
    enemy.x = player.x + 1;
    enemy.y = player.y;
    enemy.melee = 99;
    pursue(enemy, player);
    player.hp = 1;
    state.inventory.salts = 0;
    state.recoveredParts = { mast: true, canvas: true, pitch: true };
    state.repairs = { mast: true, canvas: true, pitch: false };

    expect(interact(state)).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.repairs.pitch).toBe(true);
    expect(state.phase).toBe("lost");
    expect(state.messages.some((message) => message.includes("Victory"))).toBe(false);
  });

  it("does not spend a turn interacting away from a feature", () => {
    const state = createGame(captain, "nothing-to-see-here");
    const player = getCaptain(state);
    player.x = state.wreck.x;
    player.y = state.wreck.y - 1;
    const inland = state.levels.surface.tiles[tileIndex(player.x, player.y, state.levels.surface.width)];
    if (inland) inland.terrain = "grass";

    expect(interact(state)).toBe(false);
    expect(state.turn).toBe(0);
  });

  it("hides contents and terrain on unexplored inspection points", () => {
    const state = createGame(captain, "uncharted-inspection");
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    const tile = state.levels.surface.tiles[tileIndex(enemy.x, enemy.y, state.levels.surface.width)];
    expect(tile).toBeDefined();
    if (!tile) return;
    tile.explored = false;
    tile.visible = false;

    expect(inspectMapPoint(state, enemy)).toEqual({
      visibility: "unexplored",
      terrain: null,
      actors: [],
      pickups: [],
      environment: null,
    });
  });

  it("shows static remembered contents without revealing actors through fog", () => {
    const state = createGame(captain, "remembered-inspection");
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    const pickup = state.pickups.find((candidate) => candidate.level === "surface");
    expect(enemy).toBeDefined();
    expect(pickup).toBeDefined();
    if (!enemy || !pickup) return;
    enemy.x = pickup.x;
    enemy.y = pickup.y;
    const tile = state.levels.surface.tiles[tileIndex(pickup.x, pickup.y, state.levels.surface.width)];
    expect(tile).toBeDefined();
    if (!tile) return;
    tile.explored = true;
    tile.visible = false;

    const inspection = inspectMapPoint(state, pickup);
    expect(inspection?.visibility).toBe("remembered");
    expect(inspection?.terrain).toBe(tile.terrain);
    expect(inspection?.actors).toEqual([]);
    expect(inspection?.pickups).toEqual([pickup]);
  });

  it("shows living actors only when their tile is currently visible", () => {
    const state = createGame(captain, "visible-inspection");
    const player = getCaptain(state);
    const inspection = inspectMapPoint(state, player);

    expect(inspection?.visibility).toBe("visible");
    expect(inspection?.actors).toEqual([player]);
  });

  it("uses cave dimensions when inspecting cave tiles", () => {
    const state = createGame(captain, "cave-inspection-width");
    state.currentLevel = "cave";
    const point = { x: state.levels.cave.width - 1, y: state.levels.cave.height - 1 };
    const tile = state.levels.cave.tiles[tileIndex(point.x, point.y, state.levels.cave.width)];
    expect(tile).toBeDefined();
    if (!tile) return;
    tile.explored = true;

    expect(inspectMapPoint(state, point)?.terrain).toBe(tile.terrain);
    expect(inspectMapPoint(state, { x: state.levels.cave.width, y: point.y })).toBeNull();
  });

  it("does not spend a turn on an invalid move into water", () => {
    const state = createGame(captain, "watery-misfortune");
    const player = getCaptain(state);
    const surface = state.levels.surface;
    const directions = [
      [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
    ] as const;
    const blocked = directions.find(([dx, dy]) => {
      const tile = surface.tiles[tileIndex(player.x + dx, player.y + dy, surface.width)];
      return !tile || !isPassableTerrain(tile.terrain);
    });
    expect(blocked).toBeDefined();
    if (!blocked) return;

    expect(moveCaptain(state, blocked[0], blocked[1])).toBe(false);
    expect(state.turn).toBe(0);
  });

  it("uses smelling salts to heal the captain at the cost of a turn", () => {
    const state = createGame(captain, "medicinal-stench");
    const player = getCaptain(state);
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.hp = player.maxHp - 6;

    expect(useSmellingSalts(state)).toBe(true);
    expect(player.hp).toBe(player.maxHp - 2);
    expect(state.inventory.salts).toBe(0);
    expect(state.turn).toBe(1);
  });

  it("gives surgeons stronger manual healing", () => {
    const state = createGame({ ...captain, background: "surgeon" }, "surgeon-salts");
    const player = getCaptain(state);
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.hp = player.maxHp - 8;

    expect(useSmellingSalts(state)).toBe(true);
    expect(player.hp).toBe(player.maxHp - 2);
    expect(state.inventory.salts).toBe(1);
  });

  it("does not waste salts or turns when healing is unavailable", () => {
    const state = createGame(captain, "responsible-medicine");

    expect(useSmellingSalts(state)).toBe(false);
    expect(state.inventory.salts).toBe(1);
    expect(state.turn).toBe(0);

    getCaptain(state).hp -= 1;
    state.inventory.salts = 0;
    expect(useSmellingSalts(state)).toBe(false);
    expect(state.turn).toBe(0);
  });

  it("incapacitates crew for ten rescue turns instead of killing them immediately", () => {
    const state = createGame(captain, "crew-incapacitation");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(crew).toBeDefined();
    expect(slag).toBeDefined();
    if (!crew || !slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.x = 21;
    crew.y = 21;
    crew.hp = 1;
    slag.x = 21;
    slag.y = 20;
    slag.hp = 1;
    pursue(slag, player);

    expect(moveCaptain(state, 1, 0)).toBe(true);

    expect(crew).toMatchObject({ alive: true, hp: 0, incapacitatedTurns: 10 });
    expect(inspectMapPoint(state, crew)?.actors).toContain(crew);
  });

  it("counts down incapacitated crew on later turns and makes death permanent", () => {
    const state = createGame(captain, "crew-bleed-out");
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    crew.kind = "crew";
    crew.hp = 0;
    crew.incapacitatedTurns = 10;

    waitTurn(state);
    expect(crew.incapacitatedTurns).toBe(9);
    for (let turn = 0; turn < 9; turn += 1) waitTurn(state);

    expect(crew).toMatchObject({ alive: false, hp: 0, incapacitatedTurns: 0 });
  });

  it("uses salts on the most urgent adjacent crew member before healing the captain", () => {
    const state = createGame(captain, "crew-field-rescue");
    const player = getCaptain(state);
    const crew = state.actors.filter((actor) => actor.kind === "castaway").slice(0, 2);
    const urgent = crew[0];
    const stable = crew[1];
    expect(urgent).toBeDefined();
    expect(stable).toBeDefined();
    if (!urgent || !stable) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.hp -= 6;
    urgent.kind = "crew";
    urgent.crewTrait = "powderShy";
    urgent.role = "Carpenter";
    urgent.x = player.x + 1;
    urgent.y = player.y;
    urgent.hp = 0;
    urgent.incapacitatedTurns = 2;
    stable.kind = "crew";
    stable.crewTrait = "smokeShy";
    stable.role = "Gunner";
    stable.x = player.x;
    stable.y = player.y + 1;
    stable.hp = 0;
    stable.incapacitatedTurns = 7;
    const captainHealth = player.hp;

    expect(useSmellingSalts(state)).toBe(true);

    expect(urgent).toMatchObject({ hp: 3, incapacitatedTurns: 0 });
    expect(stable).toMatchObject({ hp: 0, incapacitatedTurns: 6 });
    expect(player.hp).toBe(captainHealth);
    expect(state.inventory.salts).toBe(0);
    expect(state.turn).toBe(1);
  });

  it("gives surgeons stronger crew rescues", () => {
    const state = createGame({ ...captain, background: "surgeon" }, "surgeon-rescue");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    crew.kind = "crew";
    crew.x = player.x + 1;
    crew.y = player.y;
    crew.hp = 0;
    crew.incapacitatedTurns = 1;

    expect(useSmellingSalts(state)).toBe(true);
    expect(crew).toMatchObject({ hp: 5, incapacitatedTurns: 0, alive: true });
  });

  it("lets the captain move through downed crew without making them act", () => {
    const state = createGame(captain, "step-over-crew");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    const destination = state.levels.surface.tiles[tileIndex(player.x + 1, player.y, state.levels.surface.width)];
    expect(destination).toBeDefined();
    if (!destination) return;
    destination.terrain = "grass";
    crew.kind = "crew";
    crew.x = player.x + 1;
    crew.y = player.y;
    crew.hp = 0;
    crew.incapacitatedTurns = 10;

    expect(moveCaptain(state, 1, 0)).toBe(true);
    expect(player).toMatchObject({ x: crew.x, y: crew.y });
    expect(crew).toMatchObject({ hp: 0, incapacitatedTurns: 9 });
  });

  it("leaves downed crew behind on stairs while their rescue timer continues", () => {
    const state = createGame(captain, "abandoned-crew");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = state.caveEntrance.x;
    player.y = state.caveEntrance.y;
    crew.kind = "crew";
    crew.level = "surface";
    crew.x = player.x;
    crew.y = player.y;
    crew.hp = 0;
    crew.incapacitatedTurns = 10;

    expect(useStairs(state)).toBe(true);
    expect(player.level).toBe("cave");
    expect(crew).toMatchObject({ level: "surface", incapacitatedTurns: 9 });
  });

  it("provides a quiet opening instead of globally alerting the island", () => {
    const state = createGame(captain, "quiet-opening");
    const surfaceEnemies = state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy");
    const initialPositions = surfaceEnemies.map((enemy) => ({ id: enemy.id, x: enemy.x, y: enemy.y }));

    expect(surfaceEnemies).toHaveLength(7);
    expect(surfaceEnemies.every((enemy) => enemy.enemyAwareness === null)).toBe(true);
    for (let turn = 0; turn < 20; turn += 1) waitTurn(state);

    expect(state.phase).toBe("playing");
    expect(surfaceEnemies.every((enemy) => enemy.enemyAwareness === null)).toBe(true);
    expect(surfaceEnemies.map((enemy) => ({ id: enemy.id, x: enemy.x, y: enemy.y }))).toEqual(initialPositions);
  });

  it("derives symmetric rival factions while keeping castaways neutral", () => {
    const state = createGame(captain, "ecology-factions");
    const player = getCaptain(state);
    const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton");
    const crab = state.actors.find((actor) => actor.enemyType === "crab");
    const slag = state.actors.find((actor) => actor.enemyType === "slag");
    const castaway = state.actors.find((actor) => actor.kind === "castaway");
    expect(skeleton).toBeDefined();
    expect(crab).toBeDefined();
    expect(slag).toBeDefined();
    expect(castaway).toBeDefined();
    if (!skeleton || !crab || !slag || !castaway) return;

    expect(getFaction(player)).toBe("party");
    expect(getFaction(skeleton)).toBe("boneCrew");
    expect(getFaction(crab)).toBe("shoreBrood");
    expect(getFaction(slag)).toBe("cinderkin");
    expect(getFaction(castaway)).toBe("neutral");
    expect(areActorsHostile(skeleton, crab)).toBe(true);
    expect(areActorsHostile(crab, skeleton)).toBe(true);
    expect(areActorsHostile(skeleton, slag)).toBe(true);
    expect(areActorsHostile(skeleton, castaway)).toBe(false);
    expect(areActorsHostile(skeleton, player)).toBe(true);
  });

  it("keeps mutually unaware rival groups dormant", () => {
    const state = createGame(captain, "dormant-ecology");
    const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton" && actor.level === "surface");
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(skeleton).toBeDefined();
    expect(slag).toBeDefined();
    if (!skeleton || !slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== skeleton.id && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    skeleton.x = 25;
    skeleton.y = 20;
    skeleton.enemyAwareness = null;
    slag.x = 27;
    slag.y = 20;
    slag.enemyAwareness = null;
    const positions = [{ x: skeleton.x, y: skeleton.y }, { x: slag.x, y: slag.y }];

    waitTurn(state);

    expect([{ x: skeleton.x, y: skeleton.y }, { x: slag.x, y: slag.y }]).toEqual(positions);
    expect(skeleton.enemyAwareness).toBeNull();
    expect(slag.enemyAwareness).toBeNull();
  });

  it("lets an activated rival provoke and sustain an enemy clash", () => {
    const state = createGame(captain, "engineered-rival-clash");
    const player = getCaptain(state);
    const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton" && actor.level === "surface");
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(skeleton).toBeDefined();
    expect(slag).toBeDefined();
    if (!skeleton || !slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== skeleton.id && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 10;
    player.y = 10;
    skeleton.x = 25;
    skeleton.y = 20;
    skeleton.enemyAwareness = {
      mode: "investigating",
      targetId: player.id,
      lastKnownPosition: { x: 30, y: 20 },
      expiresAtTurn: 100,
    };
    slag.x = 27;
    slag.y = 20;
    slag.enemyAwareness = null;
    const skeletonHealth = skeleton.hp;

    waitTurn(state);

    expect(slag.enemyAwareness).toMatchObject({ mode: "pursuing", targetId: skeleton.id });
    expect(skeleton.hp).toBeLessThan(skeletonHealth);
    expect(skeleton.enemyAwareness).toMatchObject({ mode: "pursuing", targetId: slag.id });
  });

  it("uses smoke to break rival sight while preserving last-known pursuit", () => {
    const state = createGame(captain, "rival-smoke-break");
    const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton" && actor.level === "surface");
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(skeleton).toBeDefined();
    expect(slag).toBeDefined();
    if (!skeleton || !slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== skeleton.id && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    skeleton.x = 20;
    skeleton.y = 20;
    slag.x = 24;
    slag.y = 20;
    pursue(skeleton, slag);
    pursue(slag, skeleton);
    state.environment.surface = [{ x: 22, y: 20, fireTurns: 0, smokeTurns: 3 }];
    const remembered = { ...skeleton.enemyAwareness!.lastKnownPosition };

    waitTurn(state);

    expect(skeleton.enemyAwareness?.lastKnownPosition).toEqual(remembered);
    expect(skeleton.x).toBeGreaterThan(20);
  });

  it("resolves identical lured faction clashes deterministically", () => {
    const setup = (): ReturnType<typeof createGame> => {
      const state = createGame(captain, "repeatable-ecology");
      const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton" && actor.level === "surface");
      const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
      if (!skeleton || !slag) return state;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== skeleton.id && actor.id !== slag.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      getCaptain(state).x = 10;
      getCaptain(state).y = 10;
      skeleton.x = 25;
      skeleton.y = 20;
      skeleton.enemyAwareness = { mode: "investigating", targetId: null, lastKnownPosition: { x: 30, y: 20 }, expiresAtTurn: 100 };
      slag.x = 27;
      slag.y = 20;
      slag.enemyAwareness = null;
      return state;
    };
    const first = setup();
    const second = setup();
    for (let turn = 0; turn < 5; turn += 1) {
      waitTurn(first);
      waitTurn(second);
    }
    expect(first).toEqual(second);
  });

  it("generates one compatible distant special enemy on each initial level", () => {
    const seenAttributes = new Set<EnemyAttribute>();
    for (let index = 0; index < 100; index += 1) {
      const state = createGame(captain, `special-generation-${index}`);
      const surfaceSpecials = state.actors.filter(
        (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyAttribute,
      );
      const caveSpecials = state.actors.filter(
        (actor) => actor.kind === "enemy" && actor.level === "cave" && actor.enemyAttribute,
      );
      expect(surfaceSpecials).toHaveLength(1);
      expect(caveSpecials).toHaveLength(1);
      for (const enemy of [...surfaceSpecials, ...caveSpecials]) {
        expect(enemy.enemyType).toBeDefined();
        expect(enemy.enemyAttribute).toBeDefined();
        if (!enemy.enemyType || !enemy.enemyAttribute) continue;
        expect(isAttributeCompatible(enemy.enemyAttribute, enemy.enemyType)).toBe(true);
        expect(["Keen-Eared", "Ironclad", "Skirmishing", "Riposting"].some((prefix) => enemy.name.startsWith(prefix))).toBe(true);
        seenAttributes.add(enemy.enemyAttribute);
      }
      const closeEnemy = state.actors
        .filter((actor) => actor.kind === "enemy" && actor.level === "surface")
        .sort((a, b) => a.id - b.id)[0];
      expect(closeEnemy?.enemyAttribute).toBeNull();
    }
    expect(seenAttributes).toEqual(new Set(["keenEared", "ironclad", "skirmishing", "riposting"]));
  });

  it("assigns special enemies deterministically without changing ordinary generation", () => {
    const first = createGame(captain, "repeatable-specials");
    const second = createGame(captain, "repeatable-specials");
    expect(first).toEqual(second);
    expect(first.actors.filter((actor) => actor.enemyAttribute)).toHaveLength(2);
  });

  it("makes enemies investigate the location of a deliberate noise", () => {
    const state = createGame(captain, "spatial-distraction");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 26;
    enemy.y = 20;
    enemy.enemyAwareness = null;

    expect(makeDistraction(state)).toBe(true);

    expect(enemy.enemyAwareness).toMatchObject({
      mode: "investigating",
      lastKnownPosition: { x: 20, y: 20 },
      expiresAtTurn: 9,
    });
    expect(enemy).toMatchObject({ x: 25, y: 19 });
    expect(state.turn).toBe(1);
  });

  it("throws a stone to create a remote unattributed lure", () => {
    const state = createGame(captain, "remote-stone-lure");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 28;
    enemy.y = 22;
    enemy.enemyAwareness = null;
    updateVisibility(state);

    expect(throwStone(state, { x: 24, y: 20 })).toBe(true);

    expect(state.turn).toBe(1);
    expect(enemy.enemyAwareness).toMatchObject({
      mode: "investigating",
      targetId: null,
      lastKnownPosition: { x: 24, y: 20 },
    });
  });

  it("does not spend a turn on unseen, distant, or blocked stone throws", () => {
    const state = createGame(captain, "bad-stone-throw");
    const player = getCaptain(state);
    const map = state.levels.surface;
    for (const tile of map.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    updateVisibility(state);

    expect(throwStone(state, { x: 27, y: 20 })).toBe(false);
    const blocker = map.tiles[tileIndex(22, 20, map.width)];
    if (blocker) blocker.terrain = "rock";
    expect(throwStone(state, { x: 24, y: 20 })).toBe(false);
    expect(state.turn).toBe(0);
  });

  it("redirects separated rival factions toward a stone without damaging them", () => {
    const state = createGame(captain, "stone-ecology");
    const player = getCaptain(state);
    const skeleton = state.actors.find((actor) => actor.enemyType === "skeleton" && actor.level === "surface");
    const crab = state.actors.find((actor) => actor.enemyType === "crab" && actor.level === "surface");
    expect(skeleton).toBeDefined();
    expect(crab).toBeDefined();
    if (!skeleton || !crab) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== skeleton.id && actor.id !== crab.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 10;
    player.y = 10;
    skeleton.x = 20;
    skeleton.y = 6;
    skeleton.enemyAwareness = null;
    crab.x = 20;
    crab.y = 14;
    crab.enemyAwareness = null;
    const skeletonHealth = skeleton.hp;
    const crabHealth = crab.hp;
    updateVisibility(state);

    throwStone(state, { x: 16, y: 10 });

    expect(skeleton.hp).toBe(skeletonHealth);
    expect(crab.hp).toBe(crabHealth);
    expect(skeleton.enemyAwareness).toMatchObject({ lastKnownPosition: { x: 16, y: 10 } });
    expect(crab.enemyAwareness).toMatchObject({ lastKnownPosition: { x: 16, y: 10 } });
  });

  it("lets keen-eared specials hear beyond the ordinary sound radius", () => {
    const state = createGame(captain, "keen-hearing");
    const player = getCaptain(state);
    const enemies = state.actors.filter(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
    ).slice(0, 2);
    const keen = enemies[0];
    const ordinary = enemies[1];
    expect(keen).toBeDefined();
    expect(ordinary).toBeDefined();
    if (!keen || !ordinary) return;
    state.actors.filter((actor) => actor.kind === "enemy" && !enemies.includes(actor)).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    keen.x = 28;
    keen.y = 20;
    keen.enemyAttribute = "keenEared";
    keen.enemyAwareness = null;
    ordinary.x = 20;
    ordinary.y = 28;
    ordinary.enemyAttribute = null;
    ordinary.enemyAwareness = null;

    makeDistraction(state);

    expect(keen.enemyAwareness).toMatchObject({ mode: "investigating" });
    expect(ordinary.enemyAwareness).toBeNull();
  });

  it("blocks sound behind sealed cave walls", () => {
    const state = createGame(captain, "sealed-cave-sound");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "cave" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.currentLevel = "cave";
    player.level = "cave";
    player.x = 10;
    player.y = 10;
    enemy.x = 12;
    enemy.y = 10;
    enemy.enemyAwareness = null;
    enemy.enemyAttribute = null;
    for (const actor of state.actors) {
      if (actor.kind === "enemy" && actor.id !== enemy.id) actor.alive = false;
    }
    for (const tile of state.levels.cave.tiles) tile.terrain = "caveFloor";
    for (let y = 0; y < state.levels.cave.height; y += 1) {
      const tile = state.levels.cave.tiles[tileIndex(11, y, state.levels.cave.width)];
      if (tile) tile.terrain = "caveWall";
    }

    makeDistraction(state);

    expect(enemy.enemyAwareness).toBeNull();
  });

  it("carries sound around cave walls when a passage is open", () => {
    const state = createGame(captain, "cave-sound-passage");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "cave" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.currentLevel = "cave";
    player.level = "cave";
    player.x = 10;
    player.y = 10;
    enemy.x = 12;
    enemy.y = 10;
    enemy.enemyAwareness = null;
    enemy.enemyAttribute = null;
    for (const actor of state.actors) {
      if (actor.kind === "enemy" && actor.id !== enemy.id) actor.alive = false;
    }
    for (const tile of state.levels.cave.tiles) tile.terrain = "caveFloor";
    for (let y = 0; y < state.levels.cave.height; y += 1) {
      const tile = state.levels.cave.tiles[tileIndex(11, y, state.levels.cave.width)];
      if (tile) tile.terrain = "caveWall";
    }
    const opening = state.levels.cave.tiles[tileIndex(11, 11, state.levels.cave.width)];
    if (opening) opening.terrain = "caveFloor";

    makeDistraction(state);

    expect(enemy.enemyAwareness).toMatchObject({ mode: "investigating" });
  });

  it("lets keen hearing overcome muffling terrain", () => {
    const ordinaryState = createGame(captain, "muffled-hearing");
    const keenState = createGame(captain, "muffled-hearing");
    const prepare = (state: ReturnType<typeof createGame>, attribute: EnemyAttribute | null): Actor | null => {
      const player = getCaptain(state);
      const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
      if (!enemy) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "caveWall";
      player.x = 20;
      player.y = 20;
      enemy.x = 25;
      enemy.y = 20;
      enemy.enemyAwareness = null;
      enemy.enemyAttribute = attribute;
      const origin = state.levels.surface.tiles[tileIndex(20, 20, state.levels.surface.width)];
      const destination = state.levels.surface.tiles[tileIndex(25, 20, state.levels.surface.width)];
      if (origin) origin.terrain = "grass";
      if (destination) destination.terrain = "grass";
      for (let x = 21; x <= 24; x += 1) {
        const tile = state.levels.surface.tiles[tileIndex(x, 20, state.levels.surface.width)];
        if (tile) tile.terrain = "jungle";
      }
      return enemy;
    };
    const ordinary = prepare(ordinaryState, null);
    const keen = prepare(keenState, "keenEared");
    expect(ordinary).not.toBeNull();
    expect(keen).not.toBeNull();
    if (!ordinary || !keen) return;

    makeDistraction(ordinaryState);
    makeDistraction(keenState);

    expect(ordinary.enemyAwareness).toBeNull();
    expect(keen.enemyAwareness).toMatchObject({ mode: "investigating" });
  });

  it("has ironclad enemies reduce firearm damage", () => {
    const ordinaryState = createGame({ ...captain, knack: "deadeye" }, "ironclad-shot");
    const armoredState = createGame({ ...captain, knack: "deadeye" }, "ironclad-shot");
    const prepare = (state: ReturnType<typeof createGame>, attribute: EnemyAttribute | null): Actor | null => {
      const player = getCaptain(state);
      const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
      if (!target) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      target.x = 22;
      target.y = 20;
      target.hp = 20;
      target.maxHp = 20;
      target.enemyAttribute = attribute;
      state.rngState = 1;
      state.targetId = target.id;
      updateVisibility(state);
      return target;
    };
    const ordinary = prepare(ordinaryState, null);
    const armored = prepare(armoredState, "ironclad");
    expect(ordinary).not.toBeNull();
    expect(armored).not.toBeNull();
    if (!ordinary || !armored) return;

    expect(fireFlintlock(ordinaryState)).toBe(true);
    expect(fireFlintlock(armoredState)).toBe(true);

    expect(armored.hp - ordinary.hp).toBe(2);
    expect(armoredState.messages.some((message) => message.includes("iron plating"))).toBe(true);
  });

  it("uses jungle, rock, and wreck as cover against projectiles from either side", () => {
    const shotStates = ["jungle", "rock", "wreck"].map((terrain) => {
      const open = createGame({ ...captain, knack: "deadeye" }, `captain-cover-${terrain}`);
      const covered = createGame({ ...captain, knack: "deadeye" }, `captain-cover-${terrain}`);
      const prepareCaptainShot = (state: ReturnType<typeof createGame>, cover: boolean): Actor | null => {
        const player = getCaptain(state);
        const target = state.actors.find(
          (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab",
        );
        if (!target) return null;
        state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
          actor.alive = false;
        });
        for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
        player.x = 20;
        player.y = 20;
        target.x = 24;
        target.y = 20;
        target.hp = 20;
        target.maxHp = 20;
        target.enemyAttribute = null;
        if (cover) {
          const targetTile = state.levels.surface.tiles[tileIndex(target.x, target.y, state.levels.surface.width)];
          if (targetTile) targetTile.terrain = terrain as "jungle" | "rock" | "wreck";
        }
        state.rngState = 1;
        state.targetId = target.id;
        updateVisibility(state);
        return target;
      };
      const openTarget = prepareCaptainShot(open, false);
      const coveredTarget = prepareCaptainShot(covered, true);
      expect(openTarget).not.toBeNull();
      expect(coveredTarget).not.toBeNull();
      if (!openTarget || !coveredTarget) return null;
      fireFlintlock(open);
      fireFlintlock(covered);
      return { open, covered, openTarget, coveredTarget };
    });
    for (const result of shotStates) {
      expect(result).not.toBeNull();
      if (!result) continue;
      expect(result.coveredTarget.hp).toBe(result.openTarget.hp + 1);
      expect(result.covered.messages.some((message) => message.includes("terrain cover"))).toBe(true);
    }

    const open = createGame(captain, "enemy-cover-fire");
    const covered = createGame(captain, "enemy-cover-fire");
    const prepareEnemyShot = (state: ReturnType<typeof createGame>, cover: boolean): void => {
      const player = getCaptain(state);
      const gunner = state.actors.find((actor) => actor.enemyType === "bonegunner" && actor.level === "surface");
      if (!gunner) return;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== gunner.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      gunner.x = 25;
      gunner.y = 20;
      gunner.enemyAttribute = null;
      if (cover) {
        const playerTile = state.levels.surface.tiles[tileIndex(player.x, player.y, state.levels.surface.width)];
        if (playerTile) playerTile.terrain = "rock";
      }
      state.rngState = 1;
      pursue(gunner, player);
    };
    prepareEnemyShot(open, false);
    prepareEnemyShot(covered, true);

    waitTurn(open);
    waitTurn(covered);

    expect(getCaptain(covered).hp).toBe(getCaptain(open).hp + 1);
    expect(covered.messages.some((message) => message.includes("terrain cover"))).toBe(true);
  });

  it("applies distinct melee damage from knives, cutlasses, and boarding axes", () => {
    const knifeState = createGame(captain, "melee-weapon-damage");
    const cutlassState = createGame(captain, "melee-weapon-damage");
    const axeState = createGame(captain, "melee-weapon-damage");
    const prepare = (state: ReturnType<typeof createGame>, weapon: MeleeWeapon): Actor | null => {
      const player = getCaptain(state);
      const target = state.actors.find(
        (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
      );
      if (!target) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      player.meleeWeapon = weapon;
      target.x = 21;
      target.y = 20;
      target.hp = 20;
      target.maxHp = 20;
      target.enemyAttribute = null;
      target.enemyAwareness = null;
      state.rngState = 1;
      return target;
    };
    const knifeTarget = prepare(knifeState, "knife");
    const cutlassTarget = prepare(cutlassState, "cutlass");
    const axeTarget = prepare(axeState, "boardingAxe");
    expect(knifeTarget).not.toBeNull();
    expect(cutlassTarget).not.toBeNull();
    expect(axeTarget).not.toBeNull();
    if (!knifeTarget || !cutlassTarget || !axeTarget) return;

    moveCaptain(knifeState, 1, 0);
    moveCaptain(cutlassState, 1, 0);
    moveCaptain(axeState, 1, 0);

    expect(cutlassTarget.hp).toBe(knifeTarget.hp - 1);
    expect(axeTarget.hp).toBe(cutlassTarget.hp - 1);
  });

  it("applies armor-specific melee and projectile damage reduction", () => {
    const meleeOpen = createGame(captain, "melee-armor");
    const meleeArmored = createGame(captain, "melee-armor");
    const prepareMelee = (state: ReturnType<typeof createGame>, armored: boolean): Actor | null => {
      const player = getCaptain(state);
      const enemy = state.actors.find(
        (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
      );
      if (!enemy) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      player.armor = armored ? "leatherCoat" : null;
      enemy.x = 21;
      enemy.y = 20;
      enemy.melee = 3;
      enemy.enemyAttribute = null;
      state.rngState = 1;
      pursue(enemy, player);
      waitTurn(state);
      return player;
    };
    const openMeleeTarget = prepareMelee(meleeOpen, false);
    const armoredMeleeTarget = prepareMelee(meleeArmored, true);
    expect(openMeleeTarget).not.toBeNull();
    expect(armoredMeleeTarget).not.toBeNull();
    if (!openMeleeTarget || !armoredMeleeTarget) return;
    expect(armoredMeleeTarget.hp).toBe(openMeleeTarget.hp + 1);

    const shotOpen = createGame(captain, "projectile-armor");
    const shotLeather = createGame(captain, "projectile-armor");
    const shotPlate = createGame(captain, "projectile-armor");
    const prepareShot = (state: ReturnType<typeof createGame>, armor: "leatherCoat" | "breastplate" | null): Actor | null => {
      const player = getCaptain(state);
      const gunner = state.actors.find((actor) => actor.enemyType === "bonegunner" && actor.level === "surface");
      if (!gunner) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== gunner.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      player.armor = armor;
      gunner.x = 25;
      gunner.y = 20;
      gunner.enemyAttribute = null;
      state.rngState = 1;
      pursue(gunner, player);
      waitTurn(state);
      return player;
    };
    const openShotTarget = prepareShot(shotOpen, null);
    const leatherShotTarget = prepareShot(shotLeather, "leatherCoat");
    const plateShotTarget = prepareShot(shotPlate, "breastplate");
    expect(openShotTarget).not.toBeNull();
    expect(leatherShotTarget).not.toBeNull();
    expect(plateShotTarget).not.toBeNull();
    if (!openShotTarget || !leatherShotTarget || !plateShotTarget) return;
    expect(leatherShotTarget.hp).toBe(openShotTarget.hp);
    expect(plateShotTarget.hp).toBe(openShotTarget.hp + 1);
    expect(shotPlate.messages.some((message) => message.includes("breastplate absorbs"))).toBe(true);
  });

  it("adds melee damage when a same-faction ally is exactly opposite the target", () => {
    const open = createGame({ ...captain, knack: "deadeye" }, "party-flanking");
    const flanked = createGame({ ...captain, knack: "deadeye" }, "party-flanking");
    const prepare = (state: ReturnType<typeof createGame>, opposite: boolean): Actor | null => {
      const player = getCaptain(state);
      const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
      const ally = state.actors.find((actor) => actor.kind === "castaway");
      if (!target || !ally) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      target.x = 21;
      target.y = 20;
      target.hp = 20;
      target.maxHp = 20;
      target.enemyAttribute = null;
      ally.kind = "crew";
      ally.crewAssignment = { order: "hold", targetId: null };
      ally.crewReaction = "brace";
      ally.x = opposite ? 22 : 22;
      ally.y = opposite ? 20 : 21;
      state.rngState = 1;
      return target;
    };
    const openTarget = prepare(open, false);
    const flankedTarget = prepare(flanked, true);
    expect(openTarget).not.toBeNull();
    expect(flankedTarget).not.toBeNull();
    if (!openTarget || !flankedTarget) return;

    moveCaptain(open, 1, 0);
    moveCaptain(flanked, 1, 0);

    expect(flankedTarget.hp).toBe(openTarget.hp - 1);
    expect(flanked.messages.some((message) => message.includes("flanks") && message.includes("ally opposite"))).toBe(true);
  });

  it("grants the same flanking bonus to enemy factions", () => {
    const open = createGame(captain, "enemy-flanking");
    const flanked = createGame(captain, "enemy-flanking");
    const prepare = (state: ReturnType<typeof createGame>, opposite: boolean): Actor | null => {
      const player = getCaptain(state);
      const skeletons = state.actors.filter(
        (actor) => actor.enemyType === "skeleton" && actor.level === "surface",
      ).slice(0, 2);
      const attacker = skeletons[0];
      const ally = skeletons[1];
      if (!attacker || !ally) return null;
      state.actors.filter((actor) => actor.kind === "enemy" && !skeletons.includes(actor)).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      attacker.x = 19;
      attacker.y = 20;
      attacker.enemyAttribute = null;
      ally.x = opposite ? 21 : 22;
      ally.y = opposite ? 20 : 21;
      ally.enemyAttribute = null;
      state.rngState = 1;
      pursue(attacker, player);
      pursue(ally, player);
      return attacker;
    };
    const openAttacker = prepare(open, false);
    const flankingAttacker = prepare(flanked, true);
    expect(openAttacker).not.toBeNull();
    expect(flankingAttacker).not.toBeNull();
    if (!openAttacker || !flankingAttacker) return;

    waitTurn(open);
    waitTurn(flanked);

    const openHit = open.messages.find((message) => message.startsWith(`${openAttacker.name} hits`));
    const flankedHit = flanked.messages.find((message) => message.startsWith(`${flankingAttacker.name} hits`));
    expect(Number(flankedHit?.match(/for (\d+)/)?.[1])).toBe(Number(openHit?.match(/for (\d+)/)?.[1]) + 1);
    expect(flanked.messages.some((message) => message.includes(`${flankingAttacker.name} flanks`))).toBe(true);
  });

  it("has riposting enemies retaliate after surviving melee damage", () => {
    const ordinaryState = createGame(captain, "riposte-comparison");
    const riposteState = createGame(captain, "riposte-comparison");
    const prepare = (state: ReturnType<typeof createGame>, attribute: EnemyAttribute | null): void => {
      const player = getCaptain(state);
      const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
      if (!target) return;
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
        actor.alive = false;
      });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      target.x = 21;
      target.y = 20;
      target.hp = 20;
      target.maxHp = 20;
      target.enemyAttribute = attribute;
      pursue(target, player);
      state.rngState = 1;
    };
    prepare(ordinaryState, null);
    prepare(riposteState, "riposting");

    expect(moveCaptain(ordinaryState, 1, 0)).toBe(true);
    expect(moveCaptain(riposteState, 1, 0)).toBe(true);

    expect(getCaptain(riposteState).hp).toBe(getCaptain(ordinaryState).hp - 1);
    expect(riposteState.messages.some((message) => message.includes("riposte"))).toBe(true);
  });

  it("has skirmishing enemies retreat after making a melee attack", () => {
    const state = createGame(captain, "skirmisher-retreat");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 21;
    enemy.y = 20;
    enemy.enemyAttribute = "skirmishing";
    pursue(enemy, player);
    const health = player.hp;

    waitTurn(state);

    expect(player.hp).toBeLessThan(health);
    expect(Math.max(Math.abs(enemy.x - player.x), Math.abs(enemy.y - player.y))).toBe(2);
  });

  it("does not let investigation track the captain's later movement", () => {
    const state = createGame(captain, "sound-is-not-telepathy");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 26;
    enemy.y = 20;

    makeDistraction(state);
    const heard = enemy.enemyAwareness?.lastKnownPosition;
    player.x = 20;
    player.y = 25;
    waitTurn(state);

    expect(heard).toEqual({ x: 20, y: 20 });
    expect(enemy.enemyAwareness?.lastKnownPosition).toEqual({ x: 20, y: 20 });
  });

  it("keeps sounds isolated to their level", () => {
    const state = createGame(captain, "level-soundproofing");
    const player = getCaptain(state);
    const surfaceEnemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    const caveEnemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "cave");
    expect(surfaceEnemy).toBeDefined();
    expect(caveEnemy).toBeDefined();
    if (!surfaceEnemy || !caveEnemy) return;
    player.x = state.caveEntrance.x;
    player.y = state.caveEntrance.y;
    useStairs(state);
    surfaceEnemy.enemyAwareness = null;
    caveEnemy.x = player.x + 4;
    caveEnemy.y = player.y;
    caveEnemy.enemyAwareness = null;

    makeDistraction(state);

    expect(caveEnemy.enemyAwareness).not.toBeNull();
    expect(surfaceEnemy.enemyAwareness).toBeNull();
  });

  it("expires awareness on inactive levels after the exact memory window", () => {
    const state = createGame(captain, "forgotten-surface-noise");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    enemy.enemyAwareness = {
      mode: "investigating",
      targetId: null,
      lastKnownPosition: { x: enemy.x, y: enemy.y },
      expiresAtTurn: state.turn + 2,
    };
    player.x = state.caveEntrance.x;
    player.y = state.caveEntrance.y;
    useStairs(state);

    expect(enemy.enemyAwareness).not.toBeNull();
    waitTurn(state);
    expect(enemy.enemyAwareness).toBeNull();
  });

  it("flushes concealed crabs from hiding with nearby noise", () => {
    const state = createGame(captain, "noisy-crab-flushing");
    const player = getCaptain(state);
    const crab = state.actors.find((actor) => actor.enemyType === "crab" && actor.level === "surface");
    expect(crab).toBeDefined();
    if (!crab) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== crab.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crab.x = 25;
    crab.y = 20;
    crab.enemyAwareness = null;

    expect(visibleEnemies(state)).not.toContain(crab);
    makeDistraction(state);

    expect(crab.enemyAwareness).toMatchObject({ mode: "investigating" });
    expect(visibleEnemies(state)).toContain(crab);
  });

  it("keeps the opening quiet, then makes repeated waiting attract reinforcements", () => {
    const state = createGame(captain, "restless-reinforcements");
    const initialCount = state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy").length;
    for (let turn = 0; turn < 11; turn += 1) waitTurn(state);
    expect(state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy")).toHaveLength(initialCount);
    expect(state.dangerLevel).toBe(0);

    waitTurn(state);

    expect(state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy")).toHaveLength(initialCount + 1);
    expect(state.dangerLevel).toBe(1);
    expect(state.lastEscalationTurn).toBe(12);
    expect(state.messages.some((message) => message.includes("recent activity"))).toBe(true);
    expect(state.phase).toBe("playing");
  });

  it("still escalates from elapsed time without accumulated attention", () => {
    const state = createGame(captain, "timed-reinforcements");
    const initialCount = state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy").length;
    state.turn = 59;
    state.threat = 0;

    waitTurn(state);

    expect(state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy")).toHaveLength(initialCount + 1);
    expect(state.lastEscalationTurn).toBe(60);
  });

  it("lets gunfire trigger an early escalation after the opening cooldown", () => {
    const state = createGame(captain, "noisy-reinforcements");
    const player = getCaptain(state);
    const target = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
    );
    expect(target).toBeDefined();
    if (!target) return;
    const initialCount = state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy").length;
    const targetTile = state.levels.surface.tiles[tileIndex(player.x + 2, player.y, state.levels.surface.width)];
    expect(targetTile).toBeDefined();
    if (!targetTile) return;
    targetTile.terrain = "grass";
    target.x = player.x + 2;
    target.y = player.y;
    target.hp = 20;
    target.maxHp = 20;
    target.enemyAwareness = null;
    state.turn = 11;
    state.targetId = target.id;
    updateVisibility(state);

    expect(fireFlintlock(state)).toBe(true);

    expect(state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy")).toHaveLength(initialCount + 1);
    expect(state.dangerLevel).toBe(1);
    expect(state.lastEscalationTurn).toBe(12);
  });

  it("keeps a direct opening expedition to the cave survivable across seeds", () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const state = createGame(captain, `opening-expedition-${seed}`);
      const player = getCaptain(state);
      const surface = state.levels.surface;
      const route = routeTo(surface.tiles, surface.width, surface.height, player, state.caveEntrance);
      expect(route.length).toBeGreaterThan(0);
      for (const step of route) {
        let attempts = 0;
        while ((player.x !== step.x || player.y !== step.y) && state.phase === "playing" && attempts < 8) {
          moveCaptain(state, Math.sign(step.x - player.x), Math.sign(step.y - player.y));
          attempts += 1;
        }
        expect(attempts).toBeLessThan(8);
        if (state.phase !== "playing") break;
      }
      expect(state.phase, `captain died before reaching the cave on seed ${seed}`).toBe("playing");
      expect(player).toMatchObject(state.caveEntrance);
    }
  });

  it("fires, makes noise, and requires a reload", () => {
    const state = createGame(captain, "shooting-gallery");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.level === "surface" && actor.kind === "enemy");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    enemy.x = player.x + 2;
    enemy.y = player.y;
    enemy.enemyAwareness = null;
    updateVisibility(state);
    state.targetId = enemy.id;

    expect(fireFlintlock(state)).toBe(true);
    expect(player.rangedLoaded).toBe(false);
    expect(state.threat).toBeGreaterThan(6);
    expect(environmentAt(state, "surface", player)).toMatchObject({ fireTurns: 0, smokeTurns: 2 });
    expect(fireFlintlock(state)).toBe(false);
  });

  it("rejects pitch shots without recovered pitch or a valid shot", () => {
    const state = createGame(captain, "invalid-pitch-shot");
    const player = getCaptain(state);
    const loaded = player.rangedLoaded;

    expect(firePitchShot(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(player.rangedLoaded).toBe(loaded);

    state.recoveredParts.pitch = true;
    expect(firePitchShot(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(player.rangedLoaded).toBe(loaded);
  });

  it("uses recovered pitch for a guaranteed incendiary shot without consuming the repair", () => {
    const state = createGame(captain, "incendiary-shot");
    const player = getCaptain(state);
    const target = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab",
    );
    expect(target).toBeDefined();
    if (!target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    target.x = 24;
    target.y = 20;
    target.hp = 20;
    target.maxHp = 20;
    target.enemyAwareness = null;
    state.recoveredParts.pitch = true;
    state.targetId = target.id;
    updateVisibility(state);

    expect(firePitchShot(state)).toBe(true);

    expect(target.hp).toBe(18);
    expect(state.recoveredParts.pitch).toBe(true);
    expect(player.rangedLoaded).toBe(false);
    expect(state.turn).toBe(1);
    expect(environmentAt(state, "surface", { x: 24, y: 20 })).toMatchObject({ fireTurns: 2, smokeTurns: 4 });
    expect(environmentAt(state, "surface", player)).toMatchObject({ fireTurns: 0, smokeTurns: 2 });
    expect(target.enemyAwareness).not.toBeNull();
  });

  it("orders crew to pursue the selected visible enemy", () => {
    const state = createGame(captain, "crew-pursuit");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    expect(crew).toBeDefined();
    expect(target).toBeDefined();
    if (!crew || !target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    for (let x = 20; x <= 27; x += 1) {
      const tile = state.levels.surface.tiles[tileIndex(x, 20, state.levels.surface.width)];
      if (tile) tile.terrain = "grass";
    }
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.x = 21;
    crew.y = 20;
    target.x = 27;
    target.y = 20;
    target.enemyAwareness = null;
    state.targetId = target.id;
    updateVisibility(state);

    expect(commandCrewAttack(state)).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.lastCrewOrder).toBe("attack");
    expect(crew.crewAssignment).toEqual({ order: "attack", targetId: target.id });
    expect(Math.max(Math.abs(crew.x - target.x), Math.abs(crew.y - target.y))).toBe(5);
  });

  it("returns crew to follow after they defeat their ordered target", () => {
    const state = createGame(captain, "crew-finishes-the-job");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    expect(crew).toBeDefined();
    expect(target).toBeDefined();
    if (!crew || !target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    const positions = [
      { x: 20, y: 20 },
      { x: 21, y: 20 },
      { x: 22, y: 20 },
    ];
    for (const position of positions) {
      const tile = state.levels.surface.tiles[tileIndex(position.x, position.y, state.levels.surface.width)];
      if (tile) tile.terrain = "grass";
    }
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.x = 21;
    crew.y = 20;
    target.x = 22;
    target.y = 20;
    target.hp = 1;
    state.targetId = target.id;
    updateVisibility(state);

    expect(commandCrewAttack(state)).toBe(true);
    expect(target.alive).toBe(false);
    expect(crew.crewAssignment).toEqual({ order: "follow", targetId: null });
  });

  it("does not spend a turn on an attack order without crew or a selected target", () => {
    const state = createGame(captain, "orders-require-pirates");

    expect(commandCrewAttack(state)).toBe(false);
    expect(state.turn).toBe(0);

    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    crew.kind = "crew";
    crew.x = state.wreck.x + 1;
    crew.y = state.wreck.y;

    expect(commandCrewAttack(state)).toBe(false);
    expect(state.turn).toBe(0);
  });

  it("cancels an attack assignment when cycling to a standard crew order", () => {
    const state = createGame(captain, "belay-that-order");
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    crew.kind = "crew";
    crew.level = "surface";
    crew.x = state.wreck.x + 1;
    crew.y = state.wreck.y;
    state.lastCrewOrder = "attack";
    crew.crewAssignment = {
      order: "attack",
      targetId: state.actors.find((actor) => actor.kind === "enemy")?.id ?? null,
    };

    expect(cycleCrewOrder(state)).toBe("follow");
    expect(crew.crewAssignment).toEqual({ order: "follow", targetId: null });
  });

  it("passes the captain's firearm to adjacent crew and recovers it from a casualty", () => {
    const state = createGame(captain, "firearm-handoff");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway" && actor.rangedWeapon === null);
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.crewAssignment = { order: "follow", targetId: null };
    crew.x = 21;
    crew.y = 20;

    expect(transferFirearm(state)).toBe(true);
    expect(player).toMatchObject({ rangedWeapon: null, rangedLoaded: false });
    expect(crew).toMatchObject({ rangedWeapon: "flintlock", rangedLoaded: true });
    expect(state.turn).toBe(1);
    expect(fireFlintlock(state)).toBe(false);
    expect(state.turn).toBe(1);

    crew.alive = false;
    expect(transferFirearm(state)).toBe(true);
    expect(player).toMatchObject({ rangedWeapon: "flintlock", rangedLoaded: true });
    expect(crew).toMatchObject({ rangedWeapon: null, rangedLoaded: false });
    expect(state.turn).toBe(2);
  });

  it("swaps melee weapons with adjacent crew and recovers one from a casualty", () => {
    const state = createGame(captain, "melee-handoff");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway" && actor.role?.startsWith("Surgeon"));
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = 20;
    player.y = 20;
    player.meleeWeapon = "boardingAxe";
    crew.kind = "crew";
    crew.crewAssignment = { order: "follow", targetId: null };
    crew.x = 21;
    crew.y = 20;

    expect(getMeleeTransferLabel(state)).toBe(`Swap for knife with ${crew.name}`);
    expect(transferMeleeWeapon(state)).toBe(true);
    expect(player.meleeWeapon).toBe("knife");
    expect(crew.meleeWeapon).toBe("boardingAxe");
    expect(state.turn).toBe(1);

    player.meleeWeapon = null;
    crew.alive = false;
    expect(getMeleeTransferLabel(state)).toBe(`Retrieve boarding axe from ${crew.name}`);
    expect(transferMeleeWeapon(state)).toBe(true);
    expect(player.meleeWeapon).toBe("boardingAxe");
    expect(crew.meleeWeapon).toBeNull();
    expect(state.turn).toBe(2);
  });

  it("swaps armor with adjacent crew and recovers it from a casualty", () => {
    const state = createGame(captain, "armor-handoff");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = 20;
    player.y = 20;
    player.armor = "breastplate";
    crew.kind = "crew";
    crew.crewAssignment = { order: "follow", targetId: null };
    crew.armor = "leatherCoat";
    crew.x = 21;
    crew.y = 20;

    expect(getArmorTransferLabel(state)).toBe(`Swap for leather coat with ${crew.name}`);
    expect(transferArmor(state)).toBe(true);
    expect(player.armor).toBe("leatherCoat");
    expect(crew.armor).toBe("breastplate");
    expect(state.turn).toBe(1);

    player.armor = null;
    crew.alive = false;
    expect(getArmorTransferLabel(state)).toBe(`Retrieve breastplate from ${crew.name}`);
    expect(transferArmor(state)).toBe(true);
    expect(player.armor).toBe("breastplate");
    expect(crew.armor).toBeNull();
    expect(state.turn).toBe(2);
  });

  it("does not spend a turn transferring equipment without adjacent crew", () => {
    const state = createGame(captain, "lonely-equipment-manager");

    expect(transferFirearm(state)).toBe(false);
    expect(transferMeleeWeapon(state)).toBe(false);
    expect(transferArmor(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(getCaptain(state).rangedWeapon).toBe("flintlock");
  });

  it("lets an equipped non-gunner use the ranged stance with lower training", () => {
    const state = createGame(captain, "armed-carpenter");
    const player = getCaptain(state);
    const crew = state.actors.find(
      (actor) => actor.kind === "castaway" && actor.role?.startsWith("Carpenter"),
    );
    const target = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
    );
    expect(crew).toBeDefined();
    expect(target).toBeDefined();
    if (!crew || !target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.crewTrait = "shipmate";
    crew.crewAssignment = { order: "follow", targetId: null };
    crew.x = 21;
    crew.y = 20;
    target.x = 26;
    target.y = 20;
    target.hp = 20;
    target.maxHp = 20;
    target.enemyAwareness = null;
    state.targetId = target.id;
    updateVisibility(state);

    expect(transferFirearm(state)).toBe(true);
    expect(cycleCrewStance(state)).toBe("ranged");
    expect(commandCrewAttack(state)).toBe(true);

    expect(crew.rangedWeapon).toBe("flintlock");
    expect(crew.rangedLoaded).toBe(false);
    expect(state.messages.some((message) => message.includes(`${crew.name} fires a flintlock`))).toBe(true);
  });

  it("has a ranged gunner fire and reload from the party's shot supply", () => {
    const state = createGame(captain, "crew-pistol-drill");
    const player = getCaptain(state);
    const gunner = state.actors.find((actor) => actor.kind === "castaway" && actor.role?.startsWith("Gunner"));
    const target = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
    );
    expect(gunner).toBeDefined();
    expect(target).toBeDefined();
    if (!gunner || !target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    gunner.kind = "crew";
    gunner.crewTrait = "shipmate";
    gunner.crewAssignment = { order: "follow", targetId: null };
    gunner.x = 21;
    gunner.y = 20;
    target.x = 26;
    target.y = 20;
    target.hp = 20;
    target.maxHp = 20;
    target.enemyAwareness = null;
    state.targetId = target.id;
    updateVisibility(state);

    expect(cycleCrewStance(state)).toBe("ranged");
    expect(gunner.crewStance).toBe("ranged");
    expect(commandCrewAttack(state)).toBe(true);
    expect(gunner.rangedLoaded).toBe(false);
    expect(state.messages.some((message) => message.includes(`${gunner.name} fires`))).toBe(true);
    expect(state.threat).toBeGreaterThan(10);

    const ammoBeforeReload = state.inventory.ammo;
    waitTurn(state);
    expect(gunner.rangedLoaded).toBe(true);
    expect(state.inventory.ammo).toBe(ammoBeforeReload - 1);
  });

  it("has crew in the avoid stance retreat instead of making opportunistic melee attacks", () => {
    const state = createGame(captain, "crew-avoids-trouble");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    const target = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType === "skeleton",
    );
    expect(crew).toBeDefined();
    expect(target).toBeDefined();
    if (!crew || !target) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== target.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.crewAssignment = { order: "follow", targetId: null };
    crew.crewStance = "avoid";
    crew.x = 21;
    crew.y = 20;
    target.x = 22;
    target.y = 20;
    target.hp = 20;
    target.maxHp = 20;
    target.enemyAwareness = null;
    const originalPosition = { x: crew.x, y: crew.y };

    waitTurn(state);

    expect(crew).not.toMatchObject(originalPosition);
    expect(target.hp).toBe(20);
  });

  it("has powder-shy crew brace after audible hostile gunfire without repeated lockout", () => {
    const state = createGame(captain, "powder-shy-brace");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    const gunner = state.actors.find((actor) => actor.enemyType === "bonegunner" && actor.level === "surface");
    expect(crew).toBeDefined();
    expect(gunner).toBeDefined();
    if (!crew || !gunner) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== gunner.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.crewTrait = "powderShy";
    crew.role = "Carpenter";
    crew.x = 21;
    crew.y = 20;
    gunner.x = 24;
    gunner.y = 20;
    gunner.enemyAttribute = null;
    gunner.wetUntilTurn = 0;
    pursue(gunner, player);

    waitTurn(state);

    expect(crew.crewReaction).toBe("brace");
    const position = { x: crew.x, y: crew.y };
    waitTurn(state);
    expect(crew.crewReaction).toBeNull();
    expect({ x: crew.x, y: crew.y }).toEqual(position);
    expect(crew.reactionCooldownUntilTurn).toBeGreaterThan(state.turn);
  });

  it("uses Rally to cancel a pending crew reaction", () => {
    const state = createGame(captain, "rally-steadies-crew");
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    crew.kind = "crew";
    crew.x = state.wreck.x + 1;
    crew.y = state.wreck.y;
    crew.crewReaction = "brace";
    crew.crewAssignment = { order: "hold", targetId: null };
    state.lastCrewOrder = "hold";

    expect(cycleCrewOrder(state)).toBe("rally");
    expect(crew.crewReaction).toBeNull();
  });

  it("delivers orders only to active crew reached through terrain and rain", () => {
    const state = createGame(captain, "spatial-crew-orders");
    const player = getCaptain(state);
    const crew = state.actors.filter((actor) => actor.kind === "castaway");
    const audible = crew[0];
    const rainMuffled = crew[1];
    const terrainMuffled = crew[2];
    expect(audible).toBeDefined();
    expect(rainMuffled).toBeDefined();
    expect(terrainMuffled).toBeDefined();
    if (!audible || !rainMuffled || !terrainMuffled) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "caveWall";
    player.x = 20;
    player.y = 20;
    audible.kind = "crew";
    audible.x = 20;
    audible.y = 24;
    rainMuffled.kind = "crew";
    rainMuffled.x = 20;
    rainMuffled.y = 25;
    terrainMuffled.kind = "crew";
    terrainMuffled.x = 24;
    terrainMuffled.y = 20;
    for (const member of crew) member.crewAssignment = { order: "follow", targetId: null };
    for (let y = 20; y <= 25; y += 1) {
      const tile = state.levels.surface.tiles[tileIndex(20, y, state.levels.surface.width)];
      if (tile) tile.terrain = "grass";
    }
    for (let x = 21; x <= 23; x += 1) {
      const tile = state.levels.surface.tiles[tileIndex(x, 20, state.levels.surface.width)];
      if (tile) tile.terrain = "jungle";
    }
    const terrainDestination = state.levels.surface.tiles[tileIndex(24, 20, state.levels.surface.width)];
    if (terrainDestination) terrainDestination.terrain = "grass";
    state.surfaceWeather = { phase: "rain", transitionTurn: 100, cycle: 0 };

    expect(cycleCrewOrder(state)).toBe("hold");

    expect(audible.crewAssignment).toEqual({ order: "hold", targetId: null });
    expect(rainMuffled.crewAssignment).toEqual({ order: "follow", targetId: null });
    expect(terrainMuffled.crewAssignment).toEqual({ order: "follow", targetId: null });
    expect(state.messages.at(-1)).toContain("1 of 3 crewmates hear it");
  });

  it("lets only Rally recipients shake off a pending reaction", () => {
    const state = createGame(captain, "selective-rally");
    const player = getCaptain(state);
    const crew = state.actors.filter((actor) => actor.kind === "castaway").slice(0, 2);
    const nearby = crew[0];
    const distant = crew[1];
    expect(nearby).toBeDefined();
    expect(distant).toBeDefined();
    if (!nearby || !distant) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    nearby.kind = "crew";
    nearby.x = 21;
    nearby.y = 20;
    distant.kind = "crew";
    distant.x = 28;
    distant.y = 20;
    for (const member of crew) {
      member.crewAssignment = { order: "hold", targetId: null };
      member.crewReaction = "brace";
    }
    state.lastCrewOrder = "hold";

    expect(cycleCrewOrder(state)).toBe("rally");

    expect(nearby.crewAssignment).toEqual({ order: "rally", targetId: null });
    expect(nearby.reactionCooldownUntilTurn).toBe(0);
    expect(distant.crewAssignment).toEqual({ order: "hold", targetId: null });
    expect(distant.reactionCooldownUntilTurn).toBeGreaterThan(state.turn);
  });

  it("has smoke-shy crew withdraw from hazards unless wet", () => {
    const dry = createGame(captain, "smoke-shy-withdrawal");
    const wet = createGame(captain, "smoke-shy-withdrawal");
    const prepare = (state: ReturnType<typeof createGame>, wetCrew: boolean): Actor | null => {
      const player = getCaptain(state);
      const crew = state.actors.find((actor) => actor.kind === "castaway");
      if (!crew) return null;
      state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      crew.kind = "crew";
      crew.crewTrait = "smokeShy";
      crew.x = 22;
      crew.y = 20;
      crew.wetUntilTurn = wetCrew ? 10 : 0;
      state.environment.surface = [{ x: 22, y: 20, fireTurns: 2, smokeTurns: 4 }];
      return crew;
    };
    const dryCrew = prepare(dry, false);
    const wetCrew = prepare(wet, true);
    expect(dryCrew).not.toBeNull();
    expect(wetCrew).not.toBeNull();
    if (!dryCrew || !wetCrew) return;

    waitTurn(dry);
    waitTurn(wet);

    expect(dryCrew).not.toMatchObject({ x: 22, y: 20 });
    expect(wetCrew).toMatchObject({ x: 22, y: 20 });
  });

  it("has Shipmates stabilize an adjacent casualty once without spending salts", () => {
    const state = createGame(captain, "shipmate-stabilization");
    const player = getCaptain(state);
    const crew = state.actors.filter((actor) => actor.kind === "castaway").slice(0, 2);
    const helper = crew[0];
    const casualty = crew[1];
    expect(helper).toBeDefined();
    expect(casualty).toBeDefined();
    if (!helper || !casualty) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    player.x = 20;
    player.y = 20;
    helper.kind = "crew";
    helper.crewTrait = "shipmate";
    helper.role = "Carpenter";
    helper.x = 21;
    helper.y = 20;
    casualty.kind = "crew";
    casualty.x = 22;
    casualty.y = 20;
    casualty.hp = 0;
    casualty.incapacitatedTurns = 3;
    casualty.stabilized = false;
    const salts = state.inventory.salts;

    waitTurn(state);

    expect(casualty.stabilized).toBe(true);
    expect(casualty.incapacitatedTurns).toBe(4);
    expect(state.inventory.salts).toBe(salts);
    waitTurn(state);
    expect(casualty.incapacitatedTurns).toBe(3);
  });

  it("routes following crew around obstacles even when the first step moves away", () => {
    const state = createGame(captain, "crew-navigation");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    for (let y = 0; y <= 25; y += 1) {
      const tile = state.levels.surface.tiles[tileIndex(23, y, state.levels.surface.width)];
      if (tile) tile.terrain = "water";
    }
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.x = 24;
    crew.y = 20;

    waitTurn(state);

    expect(crew).toMatchObject({ x: 24, y: 21 });
  });

  it("routes pursuing enemies around obstacles", () => {
    const state = createGame(captain, "enemy-navigation");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    for (let y = 0; y <= 25; y += 1) {
      const tile = state.levels.surface.tiles[tileIndex(23, y, state.levels.surface.width)];
      if (tile) tile.terrain = "water";
    }
    player.x = 20;
    player.y = 20;
    enemy.x = 24;
    enemy.y = 20;
    pursue(enemy, player);

    waitTurn(state);

    expect(enemy).toMatchObject({ x: 24, y: 21 });
  });

  it("leaves actors stationary when no route is available", () => {
    const state = createGame(captain, "blocked-navigation");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    crew.kind = "crew";
    crew.x = 24;
    crew.y = 20;
    for (let y = crew.y - 1; y <= crew.y + 1; y += 1) {
      for (let x = crew.x - 1; x <= crew.x + 1; x += 1) {
        if (x === crew.x && y === crew.y) continue;
        const tile = state.levels.surface.tiles[tileIndex(x, y, state.levels.surface.width)];
        if (tile) tile.terrain = "water";
      }
    }

    waitTurn(state);

    expect(crew).toMatchObject({ x: 24, y: 20 });
  });

  it("resolves identical pathfinding turns deterministically", () => {
    const first = createGame(captain, "repeatable-navigation");
    const second = createGame(captain, "repeatable-navigation");
    for (let turn = 0; turn < 20; turn += 1) {
      waitTurn(first);
      waitTurn(second);
    }

    expect(first).toEqual(second);
  });

  it("keeps crabs concealed until the captain approaches their tile", () => {
    const state = createGame(captain, "crab-ambush");
    const player = getCaptain(state);
    const crab = state.actors.find((actor) => actor.enemyType === "crab" && actor.level === "surface");
    expect(crab).toBeDefined();
    if (!crab) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== crab.id).forEach((actor) => {
      actor.alive = false;
    });
    const crabTile = state.levels.surface.tiles[tileIndex(player.x + 1, player.y, state.levels.surface.width)];
    expect(crabTile).toBeDefined();
    if (!crabTile) return;
    crabTile.terrain = "sand";
    crab.x = player.x + 1;
    crab.y = player.y;
    crab.enemyAwareness = null;
    updateVisibility(state);

    expect(visibleEnemies(state)).not.toContain(crab);
    expect(inspectMapPoint(state, crab)?.actors).toEqual([]);
    state.targetId = crab.id;
    expect(fireFlintlock(state)).toBe(false);
    expect(state.turn).toBe(0);

    expect(moveCaptain(state, 1, 0)).toBe(true);
    expect(player).not.toMatchObject({ x: crab.x, y: crab.y });
    expect(crab.enemyAwareness).toMatchObject({ mode: "pursuing" });
    expect(state.turn).toBe(1);
    expect(inspectMapPoint(state, crab)?.actors).toEqual([crab]);
  });

  it("has bonegunners retreat from close combat when space is available", () => {
    const state = createGame(captain, "bonegunner-retreat");
    const player = getCaptain(state);
    const gunner = state.actors.find((actor) => actor.enemyType === "bonegunner" && actor.level === "surface");
    expect(gunner).toBeDefined();
    if (!gunner) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== gunner.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    gunner.x = 21;
    gunner.y = 20;
    pursue(gunner, player);

    waitTurn(state);

    expect(Math.max(Math.abs(gunner.x - player.x), Math.abs(gunner.y - player.y))).toBe(2);
    expect(player.hp).toBe(player.maxHp);
  });

  it("has slain bonegunners deterministically drop an unloaded flintlock and possible shot", () => {
    const first = createGame(captain, "bonegunner-loot");
    const second = createGame(captain, "bonegunner-loot");
    const defeatGunner = (state: ReturnType<typeof createGame>) => {
      const player = getCaptain(state);
      const gunner = state.actors.find((actor) => actor.enemyType === "bonegunner" && actor.level === "surface");
      if (!gunner) return [];
      state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== gunner.id).forEach((actor) => {
        actor.alive = false;
      });
      state.pickups.forEach((pickup) => { pickup.collected = true; });
      for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
      player.x = 20;
      player.y = 20;
      gunner.x = 21;
      gunner.y = 20;
      gunner.hp = 1;
      gunner.enemyAttribute = null;
      gunner.enemyAwareness = null;
      moveCaptain(state, 1, 0);
      return state.pickups.filter(
        (pickup) => !pickup.collected && pickup.x === gunner.x && pickup.y === gunner.y,
      );
    };

    const firstDrops = defeatGunner(first);
    const secondDrops = defeatGunner(second);

    expect(firstDrops).toEqual(secondDrops);
    expect(firstDrops).toContainEqual(expect.objectContaining({ type: "flintlock", loaded: false }));
    expect(first.messages.some((message) => message.includes("drops a weathered flintlock"))).toBe(true);
  });

  it("recovers a breastplate from a slain ironclad enemy", () => {
    const state = createGame(captain, "ironclad-armor-loot");
    const player = getCaptain(state);
    const enemy = state.actors.find(
      (actor) => actor.enemyType === "skeleton" && actor.level === "surface",
    );
    expect(enemy).toBeDefined();
    if (!enemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== enemy.id).forEach((actor) => {
      actor.alive = false;
    });
    state.pickups.forEach((pickup) => { pickup.collected = true; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 21;
    enemy.y = 20;
    enemy.hp = 1;
    enemy.enemyAttribute = "ironclad";
    enemy.enemyAwareness = null;

    moveCaptain(state, 1, 0);

    expect(state.pickups).toContainEqual(expect.objectContaining({
      type: "breastplate",
      x: enemy.x,
      y: enemy.y,
      collected: false,
    }));
  });

  it("leaves no loot behind when a volatile slag bursts", () => {
    const state = createGame(captain, "slag-destroys-loot");
    const player = getCaptain(state);
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(slag).toBeDefined();
    if (!slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    state.pickups.forEach((pickup) => { pickup.collected = true; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    slag.x = 21;
    slag.y = 20;
    slag.hp = 1;
    slag.enemyAwareness = null;

    moveCaptain(state, 1, 0);

    expect(state.pickups.filter((pickup) => !pickup.collected)).toEqual([]);
  });

  it("makes slain slags damage every adjacent actor", () => {
    const state = createGame(captain, "slag-burst");
    const player = getCaptain(state);
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(slag).toBeDefined();
    expect(crew).toBeDefined();
    if (!slag || !crew) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    slag.x = 21;
    slag.y = 20;
    slag.hp = 1;
    pursue(slag, player);
    crew.kind = "crew";
    crew.x = 21;
    crew.y = 21;
    const playerHealth = player.hp;
    const crewHealth = crew.hp;

    expect(moveCaptain(state, 1, 0)).toBe(true);

    expect(slag.alive).toBe(false);
    expect(player.hp).toBe(playerHealth - 2);
    expect(crew.hp).toBe(crewHealth - 2);
  });

  it("resolves adjacent slag chain bursts without repeating dead explosions", () => {
    const state = createGame(captain, "slag-chain");
    const player = getCaptain(state);
    const first = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    const second = state.actors.find(
      (actor) => actor.kind === "enemy" && actor.level === "surface" && actor.id !== first?.id,
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) return;
    second.enemyType = "slag";
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== first.id && actor.id !== second.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    first.x = 21;
    first.y = 20;
    first.hp = 1;
    pursue(first, player);
    second.x = 22;
    second.y = 20;
    second.hp = 1;
    pursue(second, player);
    const playerHealth = player.hp;

    expect(moveCaptain(state, 1, 0)).toBe(true);

    expect(first.alive).toBe(false);
    expect(second.alive).toBe(false);
    expect(player.hp).toBe(playerHealth - 2);
    expect(state.messages.filter((message) => message.includes("bursts in a ring"))).toHaveLength(2);
  });

  it("creates smoke and one safe jungle fire when a surface slag dies", () => {
    const state = createGame(captain, "slag-ignition");
    const player = getCaptain(state);
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(slag).toBeDefined();
    if (!slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    slag.x = 21;
    slag.y = 20;
    slag.hp = 1;
    slag.enemyAttribute = null;
    pursue(slag, player);
    const jungle = state.levels.surface.tiles[tileIndex(22, 20, state.levels.surface.width)];
    if (jungle) jungle.terrain = "jungle";

    moveCaptain(state, 1, 0);

    expect(environmentAt(state, "surface", { x: 21, y: 20 })).toMatchObject({ fireTurns: 0, smokeTurns: 4 });
    expect(state.environment.surface.filter((effect) => effect.fireTurns > 0)).toHaveLength(1);
    expect(state.environment.surface.find((effect) => effect.fireTurns > 0)).toMatchObject({
      x: 22,
      y: 20,
      fireTurns: 2,
      smokeTurns: 4,
    });
  });

  it("spreads fire one jungle tile per generation and burns jungle into grass", () => {
    const state = createGame(captain, "fire-front");
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    for (let x = 20; x <= 22; x += 1) {
      const tile = state.levels.surface.tiles[tileIndex(x, 20, state.levels.surface.width)];
      if (tile) tile.terrain = "jungle";
    }
    state.environment.surface = [{ x: 20, y: 20, fireTurns: 2, smokeTurns: 4 }];

    waitTurn(state);
    const firstChild = state.environment.surface.find((effect) => effect.x !== 20 && effect.fireTurns > 0);
    expect(firstChild).toBeDefined();
    expect(state.environment.surface.filter((effect) => effect.fireTurns === 3)).toHaveLength(1);

    waitTurn(state);
    const sourceTile = state.levels.surface.tiles[tileIndex(20, 20, state.levels.surface.width)];
    expect(sourceTile?.terrain).toBe("grass");
    expect(state.environment.surface.filter((effect) => effect.fireTurns === 3)).toHaveLength(0);

    waitTurn(state);
    expect(state.environment.surface.filter((effect) => effect.fireTurns === 3)).toHaveLength(1);
    expect(environmentAt(state, "surface", { x: 20, y: 20 })).toMatchObject({ fireTurns: 0, smokeTurns: 1 });
  });

  it("damages actors standing in fire while slags remain immune", () => {
    const state = createGame(captain, "fire-damage");
    const player = getCaptain(state);
    const slag = state.actors.find((actor) => actor.enemyType === "slag" && actor.level === "surface");
    expect(slag).toBeDefined();
    if (!slag) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.id !== slag.id).forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    slag.x = 30;
    slag.y = 20;
    slag.enemyAwareness = null;
    state.environment.surface = [
      { x: 20, y: 20, fireTurns: 2, smokeTurns: 4 },
      { x: 30, y: 20, fireTurns: 2, smokeTurns: 4 },
    ];
    const playerHealth = player.hp;
    const slagHealth = slag.hp;

    waitTurn(state);

    expect(player.hp).toBe(playerHealth - 2);
    expect(slag.hp).toBe(slagHealth);
  });

  it("uses smoke to block sight and conceal distant occupants", () => {
    const state = createGame(captain, "smoke-screen");
    const player = getCaptain(state);
    const enemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
    expect(enemy).toBeDefined();
    if (!enemy) return;
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    enemy.x = 23;
    enemy.y = 20;
    enemy.enemyAwareness = null;
    state.environment.surface = [{ x: 23, y: 20, fireTurns: 0, smokeTurns: 3 }];
    updateVisibility(state);

    expect(state.levels.surface.tiles[tileIndex(23, 20, state.levels.surface.width)]?.visible).toBe(true);
    expect(visibleEnemies(state)).not.toContain(enemy);
    expect(inspectMapPoint(state, enemy)?.actors).toEqual([]);
    expect(inspectMapPoint(state, enemy)?.environment).toMatchObject({ smokeTurns: 3 });
  });

  it("pauses environmental effects on inactive levels", () => {
    const state = createGame(captain, "paused-cave-fire");
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    state.environment.cave = [{ x: state.caveExit.x, y: state.caveExit.y, fireTurns: 2, smokeTurns: 5 }];

    waitTurn(state);
    expect(state.environment.cave[0]).toMatchObject({ fireTurns: 2, smokeTurns: 5 });
  });

  it("warns before deterministic rain and does not perturb simulation RNG", () => {
    const state = createGame(captain, "weather-schedule");
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    const warningTurn = state.surfaceWeather.transitionTurn;
    expect(warningTurn).toBeGreaterThanOrEqual(45);
    expect(warningTurn).toBeLessThanOrEqual(64);
    for (let turn = 0; turn < warningTurn - 1; turn += 1) waitTurn(state);
    state.threat = 0;
    state.lastEscalationTurn = state.turn;
    const rngState = state.rngState;
    waitTurn(state);

    expect(state.surfaceWeather.phase).toBe("squallWarning");
    expect(state.surfaceWeather.transitionTurn).toBe(warningTurn + 3);
    expect(state.rngState).toBe(rngState);
    for (let turn = 0; turn < 3; turn += 1) waitTurn(state);
    expect(state.surfaceWeather.phase).toBe("rain");
    expect(state.turn).toBeGreaterThanOrEqual(48);
  });

  it("wets exposed surface actors during rain but shelters jungle and cave actors", () => {
    const state = createGame(captain, "rain-exposure");
    const player = getCaptain(state);
    const exposed = state.actors.find((actor) => actor.kind === "castaway");
    const sheltered = state.actors.filter((actor) => actor.kind === "castaway")[1];
    const caveEnemy = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "cave");
    expect(exposed).toBeDefined();
    expect(sheltered).toBeDefined();
    expect(caveEnemy).toBeDefined();
    if (!exposed || !sheltered || !caveEnemy) return;
    state.actors.filter((actor) => actor.kind === "enemy" && actor.level === "surface").forEach((actor) => {
      actor.alive = false;
    });
    for (const tile of state.levels.surface.tiles) tile.terrain = "grass";
    player.x = 20;
    player.y = 20;
    exposed.x = 21;
    exposed.y = 20;
    sheltered.x = 22;
    sheltered.y = 20;
    const shelter = state.levels.surface.tiles[tileIndex(22, 20, state.levels.surface.width)];
    if (shelter) shelter.terrain = "jungle";
    state.surfaceWeather = { phase: "rain", transitionTurn: 100, cycle: 0 };

    waitTurn(state);

    expect(isWet(state, player)).toBe(true);
    expect(isWet(state, exposed)).toBe(true);
    expect(isWet(state, sheltered)).toBe(false);
    expect(isWet(state, caveEnemy)).toBe(false);
  });

  it("extinguishes surface fire and smoke during rain while cave hazards continue", () => {
    const state = createGame(captain, "rain-extinguishing");
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    state.surfaceWeather = { phase: "rain", transitionTurn: 100, cycle: 0 };
    state.environment.surface = [{ x: state.wreck.x, y: state.wreck.y, fireTurns: 3, smokeTurns: 5 }];
    state.environment.cave = [{ x: state.caveExit.x, y: state.caveExit.y, fireTurns: 3, smokeTurns: 6 }];

    waitTurn(state);

    expect(state.environment.surface).toEqual([]);
    expect(state.environment.cave[0]).toMatchObject({ fireTurns: 3, smokeTurns: 6 });
  });

  it("rejects firing and reloading while the captain is wet without spending resources", () => {
    const state = createGame(captain, "wet-powder");
    const player = getCaptain(state);
    const target = state.actors.find((actor) => actor.kind === "enemy" && actor.level === "surface" && actor.enemyType !== "crab");
    expect(target).toBeDefined();
    if (!target) return;
    player.wetUntilTurn = 5;
    target.x = player.x + 2;
    target.y = player.y;
    state.targetId = target.id;
    updateVisibility(state);
    const rngState = state.rngState;

    expect(fireFlintlock(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(player.rangedLoaded).toBe(true);
    player.rangedLoaded = false;
    expect(reloadFlintlock(state)).toBe(false);
    expect(state.turn).toBe(0);
    expect(state.inventory.ammo).toBe(6);
    expect(state.rngState).toBe(rngState);
  });

  it("douses the nearby party at the surf for one turn of tactical protection", () => {
    const state = createGame(captain, "surf-dousing");
    const player = getCaptain(state);
    const crew = state.actors.find((actor) => actor.kind === "castaway");
    expect(crew).toBeDefined();
    if (!crew) return;
    state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
    const map = state.levels.surface;
    player.x = 20;
    player.y = 20;
    const sand = map.tiles[tileIndex(20, 20, map.width)];
    const water = map.tiles[tileIndex(20, 19, map.width)];
    if (sand) sand.terrain = "sand";
    if (water) water.terrain = "water";
    crew.kind = "crew";
    crew.x = 21;
    crew.y = 20;

    expect(getInteractionLabel(state)).toBe("Douse in surf");
    expect(interact(state)).toBe(true);
    expect(state.turn).toBe(1);
    expect(isWet(state, player)).toBe(true);
    expect(isWet(state, crew)).toBe(true);
  });

  it("reduces environmental fire damage for wet actors", () => {
    const dry = createGame(captain, "wet-fire-resistance");
    const wet = createGame(captain, "wet-fire-resistance");
    for (const state of [dry, wet]) {
      state.actors.filter((actor) => actor.kind === "enemy").forEach((actor) => { actor.alive = false; });
      const player = getCaptain(state);
      state.environment.surface = [{ x: player.x, y: player.y, fireTurns: 2, smokeTurns: 4 }];
    }
    getCaptain(wet).wetUntilTurn = 5;

    waitTurn(dry);
    waitTurn(wet);

    expect(getCaptain(wet).hp).toBe(getCaptain(dry).hp + 1);
  });

  it("transitions between the surface and cave without activating enemies on the other level", () => {
    const state = createGame(captain, "subterranean-test");
    const player = getCaptain(state);
    const surfaceEnemy = state.actors.find((actor) => actor.level === "surface" && actor.kind === "enemy");
    expect(surfaceEnemy).toBeDefined();
    if (!surfaceEnemy) return;
    const originalEnemyPosition = { x: surfaceEnemy.x, y: surfaceEnemy.y };
    player.x = state.caveEntrance.x;
    player.y = state.caveEntrance.y;

    expect(useStairs(state)).toBe(true);
    expect(state.currentLevel).toBe("cave");
    expect(player.level).toBe("cave");
    expect({ x: surfaceEnemy.x, y: surfaceEnemy.y }).toEqual(originalEnemyPosition);
    expect(useStairs(state)).toBe(true);
    expect(state.currentLevel).toBe("surface");
    expect(player).toMatchObject({ level: "surface", x: state.caveEntrance.x, y: state.caveEntrance.y });
  });

  it("uses the contextual interaction to traverse cave stairs", () => {
    const state = createGame(captain, "contextual-stairs");
    const player = getCaptain(state);
    player.x = state.caveEntrance.x;
    player.y = state.caveEntrance.y;

    expect(getInteractionLabel(state)).toBe("Descend cave");
    expect(interact(state)).toBe(true);
    expect(state.currentLevel).toBe("cave");
    expect(getInteractionLabel(state)).toBe("Climb outside");
  });
});
