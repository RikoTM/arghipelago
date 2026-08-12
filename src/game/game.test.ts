import { describe, expect, it } from "vitest";
import { createGame, fireFlintlock, getCaptain, moveCaptain, updateVisibility, useStairs, waitTurn } from "./game";
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
    expect(restored).toEqual(state);
    expect(restored.levels.cave.tiles).toHaveLength(state.levels.cave.width * state.levels.cave.height);
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
});
