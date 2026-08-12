import { describe, expect, it } from "vitest";
import {
  commandCrewAttack,
  createGame,
  cycleCrewOrder,
  fireFlintlock,
  getCaptain,
  getInteractionLabel,
  interact,
  moveCaptain,
  updateVisibility,
  useSmellingSalts,
  useStairs,
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
});

describe("game simulation", () => {
  it("creates repeatable actors, pickups, and state", () => {
    expect(createGame(captain, "repeatable-run")).toEqual(createGame(captain, "repeatable-run"));
  });

  it("round-trips the complete active run through JSON storage", () => {
    const state = createGame(captain, "save-round-trip");
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(restored.version).toBe(5);
    expect(restored).toEqual(state);
    expect(restored.levels.cave.tiles).toHaveLength(state.levels.cave.width * state.levels.cave.height);
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
