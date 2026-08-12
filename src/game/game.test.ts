import { describe, expect, it } from "vitest";
import {
  commandCrewAttack,
  createGame,
  cycleCrewOrder,
  fireFlintlock,
  getCaptain,
  getInteractionLabel,
  getRunSummary,
  inspectMapPoint,
  interact,
  moveCaptain,
  updateVisibility,
  useSmellingSalts,
  useStairs,
  visibleEnemies,
  waitTurn,
} from "./game";
import type { CaptainConfig } from "./types";
import { generateCave, generateIsland, isPassableTerrain, tileIndex } from "./world";

const captain: CaptainConfig = {
  name: "Testbeard",
  background: "privateer",
  knack: "duelist",
  coat: "crimson",
};

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

  it("round-trips the complete active run through JSON storage", () => {
    const state = createGame(captain, "save-round-trip");
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(restored.version).toBe(6);
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
    enemy.alerted = true;
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
    slag.alerted = true;

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
    urgent.x = player.x + 1;
    urgent.y = player.y;
    urgent.hp = 0;
    urgent.incapacitatedTurns = 2;
    stable.kind = "crew";
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
    expect(surfaceEnemies.every((enemy) => !enemy.alerted)).toBe(true);
    for (let turn = 0; turn < 20; turn += 1) waitTurn(state);

    expect(state.phase).toBe("playing");
    expect(surfaceEnemies.every((enemy) => !enemy.alerted)).toBe(true);
    expect(surfaceEnemies.map((enemy) => ({ id: enemy.id, x: enemy.x, y: enemy.y }))).toEqual(initialPositions);
  });

  it("delays reinforcement spawns until turn 60", () => {
    const state = createGame(captain, "slow-reinforcements");
    const initialCount = state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy").length;
    for (let turn = 0; turn < 59; turn += 1) waitTurn(state);
    expect(state.actors.filter((actor) => actor.level === "surface" && actor.kind === "enemy")).toHaveLength(initialCount);
    expect(state.phase).toBe("playing");
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
    enemy.alerted = false;
    updateVisibility(state);
    state.targetId = enemy.id;

    expect(fireFlintlock(state)).toBe(true);
    expect(state.inventory.loaded).toBe(false);
    expect(state.threat).toBeGreaterThan(6);
    expect(fireFlintlock(state)).toBe(false);
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
    target.alerted = false;
    state.targetId = target.id;
    updateVisibility(state);

    expect(commandCrewAttack(state)).toBe(true);
    expect(state.turn).toBe(1);
    expect(state.crewOrder).toBe("attack");
    expect(state.crewTargetId).toBe(target.id);
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
    expect(state.crewOrder).toBe("follow");
    expect(state.crewTargetId).toBeNull();
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
    state.crewOrder = "attack";
    state.crewTargetId = state.actors.find((actor) => actor.kind === "enemy")?.id ?? null;

    expect(cycleCrewOrder(state)).toBe("follow");
    expect(state.crewTargetId).toBeNull();
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
    enemy.alerted = true;
    enemy.alertTurns = 10;

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
    crab.alerted = false;
    crab.alertTurns = 0;
    updateVisibility(state);

    expect(visibleEnemies(state)).not.toContain(crab);
    expect(inspectMapPoint(state, crab)?.actors).toEqual([]);
    state.targetId = crab.id;
    expect(fireFlintlock(state)).toBe(false);
    expect(state.turn).toBe(0);

    expect(moveCaptain(state, 1, 0)).toBe(true);
    expect(player).not.toMatchObject({ x: crab.x, y: crab.y });
    expect(crab.alerted).toBe(true);
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
    gunner.alerted = true;
    gunner.alertTurns = 10;

    waitTurn(state);

    expect(Math.max(Math.abs(gunner.x - player.x), Math.abs(gunner.y - player.y))).toBe(2);
    expect(player.hp).toBe(player.maxHp);
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
    slag.alerted = true;
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
    first.alerted = true;
    second.x = 22;
    second.y = 20;
    second.hp = 1;
    second.alerted = true;
    const playerHealth = player.hp;

    expect(moveCaptain(state, 1, 0)).toBe(true);

    expect(first.alive).toBe(false);
    expect(second.alive).toBe(false);
    expect(player.hp).toBe(playerHealth - 2);
    expect(state.messages.filter((message) => message.includes("bursts in a ring"))).toHaveLength(2);
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
