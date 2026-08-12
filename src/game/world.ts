import { coordinateNoise, Rng } from "./rng";
import type { MapLevel, Point, Terrain, Tile } from "./types";

export const WORLD_WIDTH = 60;
export const WORLD_HEIGHT = 42;
export const CAVE_WIDTH = 44;
export const CAVE_HEIGHT = 32;

export interface GeneratedIsland {
  width: number;
  height: number;
  tiles: Tile[];
  wreck: Point;
  caveEntrance: Point;
  reachable: Point[];
  rngState: number;
}

export interface GeneratedCave {
  width: number;
  height: number;
  tiles: Tile[];
  exit: Point;
  reachable: Point[];
  rngState: number;
}

const NEIGHBORS: Point[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

export function tileIndex(x: number, y: number, width = WORLD_WIDTH): number {
  return y * width + x;
}

export function inBounds(x: number, y: number, width = WORLD_WIDTH, height = WORLD_HEIGHT): boolean {
  return x >= 0 && y >= 0 && x < width && y < height;
}

export function isPassableTerrain(terrain: Terrain): boolean {
  return terrain !== "water" && terrain !== "caveWall";
}

export function collectComponent(tiles: Tile[], start: Point, width: number, height: number): Point[] {
  const result: Point[] = [];
  const queue = [start];
  const seen = new Set<number>([tileIndex(start.x, start.y, width)]);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) continue;
    result.push(current);
    for (const direction of NEIGHBORS) {
      const x = current.x + direction.x;
      const y = current.y + direction.y;
      const index = tileIndex(x, y, width);
      if (!inBounds(x, y, width, height) || seen.has(index)) continue;
      const tile = tiles[index];
      if (!tile || !isPassableTerrain(tile.terrain)) continue;
      seen.add(index);
      queue.push({ x, y });
    }
  }
  return result;
}

function largestLandmass(tiles: Tile[], width: number, height: number): Point[] {
  const visited = new Set<number>();
  let largest: Point[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = tileIndex(x, y, width);
      const tile = tiles[index];
      if (!tile || visited.has(index) || !isPassableTerrain(tile.terrain)) continue;
      const component = collectComponent(tiles, { x, y }, width, height);
      for (const point of component) visited.add(tileIndex(point.x, point.y, width));
      if (component.length > largest.length) largest = component;
    }
  }
  return largest;
}

function isCoast(tiles: Tile[], x: number, y: number, width: number, height: number): boolean {
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const neighbor = tiles[tileIndex(x + offsetX, y + offsetY, width)];
      if (!inBounds(x + offsetX, y + offsetY, width, height) || neighbor?.terrain === "water") return true;
    }
  }
  return false;
}

export function generateIsland(seed: string): GeneratedIsland {
  const width = WORLD_WIDTH;
  const height = WORLD_HEIGHT;
  const rng = new Rng(seed);
  const tiles: Tile[] = [];
  const centerX = width / 2 + (rng.next() - 0.5) * 3;
  const centerY = height / 2 + (rng.next() - 0.5) * 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.44);
      const dy = (y - centerY) / (height * 0.4);
      const distance = Math.sqrt(dx * dx + dy * dy);
      const broadNoise = coordinateNoise(seed, Math.floor(x / 3), Math.floor(y / 3)) - 0.5;
      const fineNoise = coordinateNoise(`${seed}:edge`, x, y) - 0.5;
      const edge = 0.91 + broadNoise * 0.14 + fineNoise * 0.05;
      tiles.push({ terrain: distance < edge ? "grass" : "water", explored: false, visible: false });
    }
  }

  const mainLandmass = largestLandmass(tiles, width, height);
  const mainIndices = new Set(mainLandmass.map((point) => tileIndex(point.x, point.y, width)));
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = tiles[index];
    if (tile && tile.terrain !== "water" && !mainIndices.has(index)) tile.terrain = "water";
  }

  for (const point of mainLandmass) {
    const tile = tiles[tileIndex(point.x, point.y, width)];
    if (!tile) continue;
    if (isCoast(tiles, point.x, point.y, width, height)) {
      tile.terrain = "sand";
      continue;
    }
    const terrainRoll = coordinateNoise(`${seed}:terrain`, point.x, point.y);
    const dx = (point.x - centerX) / (width * 0.44);
    const dy = (point.y - centerY) / (height * 0.4);
    const inland = Math.sqrt(dx * dx + dy * dy);
    if (terrainRoll < 0.14 && inland < 0.62) tile.terrain = "rock";
    else if (terrainRoll < 0.47) tile.terrain = "jungle";
    else tile.terrain = "grass";
  }

  const wreck = [...mainLandmass].sort((a, b) => {
    if (b.y !== a.y) return b.y - a.y;
    return Math.abs(a.x - centerX) - Math.abs(b.x - centerX);
  })[0] ?? { x: Math.floor(centerX), y: Math.floor(centerY) };
  const wreckTile = tiles[tileIndex(wreck.x, wreck.y, width)];
  if (wreckTile) wreckTile.terrain = "wreck";

  const reachable = collectComponent(tiles, wreck, width, height);
  const entranceCandidates = reachable.filter((point) => {
    const terrain = tiles[tileIndex(point.x, point.y, width)]?.terrain;
    const distanceFromWreck = Math.max(Math.abs(point.x - wreck.x), Math.abs(point.y - wreck.y));
    return distanceFromWreck > 15 && (terrain === "rock" || terrain === "jungle");
  });
  const fallbackCandidates = reachable.filter(
    (point) => Math.max(Math.abs(point.x - wreck.x), Math.abs(point.y - wreck.y)) > 15,
  );
  const caveEntrance = entranceCandidates[rng.int(entranceCandidates.length)] ?? fallbackCandidates[rng.int(fallbackCandidates.length)];
  if (!caveEntrance) throw new Error("Island generation could not place a cave entrance.");
  const entranceTile = tiles[tileIndex(caveEntrance.x, caveEntrance.y, width)];
  if (entranceTile) entranceTile.terrain = "stairsDown";
  return { width, height, tiles, wreck, caveEntrance, reachable, rngState: rng.state };
}

interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
  center: Point;
}

function carveFloor(tiles: Tile[], x: number, y: number, width: number, height: number): void {
  if (!inBounds(x, y, width, height) || x === 0 || y === 0 || x === width - 1 || y === height - 1) return;
  const tile = tiles[tileIndex(x, y, width)];
  if (tile) tile.terrain = "caveFloor";
}

function carveCorridor(tiles: Tile[], from: Point, to: Point, width: number, height: number, horizontalFirst: boolean): void {
  const carveHorizontal = (startX: number, endX: number, y: number): void => {
    const direction = startX <= endX ? 1 : -1;
    for (let x = startX; x !== endX + direction; x += direction) {
      carveFloor(tiles, x, y, width, height);
      if (y + 1 < height - 1) carveFloor(tiles, x, y + 1, width, height);
    }
  };
  const carveVertical = (startY: number, endY: number, x: number): void => {
    const direction = startY <= endY ? 1 : -1;
    for (let y = startY; y !== endY + direction; y += direction) {
      carveFloor(tiles, x, y, width, height);
      if (x + 1 < width - 1) carveFloor(tiles, x + 1, y, width, height);
    }
  };

  if (horizontalFirst) {
    carveHorizontal(from.x, to.x, from.y);
    carveVertical(from.y, to.y, to.x);
  } else {
    carveVertical(from.y, to.y, from.x);
    carveHorizontal(from.x, to.x, to.y);
  }
}

export function generateCave(seed: string): GeneratedCave {
  const width = CAVE_WIDTH;
  const height = CAVE_HEIGHT;
  for (let layoutAttempt = 0; layoutAttempt < 8; layoutAttempt += 1) {
    const rng = new Rng(layoutAttempt === 0 ? `${seed}:cave` : `${seed}:cave:${layoutAttempt}`);
    const tiles: Tile[] = Array.from({ length: width * height }, () => ({
      terrain: "caveWall" as const,
      explored: false,
      visible: false,
    }));
    const rooms: Room[] = [];

    for (let attempt = 0; attempt < 80 && rooms.length < 11; attempt += 1) {
      const roomWidth = 5 + rng.int(7);
      const roomHeight = 4 + rng.int(5);
      const x = 2 + rng.int(width - roomWidth - 4);
      const y = 2 + rng.int(height - roomHeight - 4);
      const room: Room = {
        x,
        y,
        width: roomWidth,
        height: roomHeight,
        center: { x: x + Math.floor(roomWidth / 2), y: y + Math.floor(roomHeight / 2) },
      };
      const overlaps = rooms.some(
        (other) =>
          room.x - 2 <= other.x + other.width &&
          room.x + room.width + 2 >= other.x &&
          room.y - 2 <= other.y + other.height &&
          room.y + room.height + 2 >= other.y,
      );
      if (overlaps) continue;
      for (let roomY = room.y; roomY < room.y + room.height; roomY += 1) {
        for (let roomX = room.x; roomX < room.x + room.width; roomX += 1) {
          carveFloor(tiles, roomX, roomY, width, height);
        }
      }
      const previous = rooms[rooms.length - 1];
      if (previous) carveCorridor(tiles, previous.center, room.center, width, height, rng.chance(0.5));
      rooms.push(room);
    }
    const exit = rooms[0]?.center;
    if (rooms.length < 5 || !exit) continue;
    const exitTile = tiles[tileIndex(exit.x, exit.y, width)];
    if (exitTile) exitTile.terrain = "stairsUp";
    const reachable = collectComponent(tiles, exit, width, height);
    return { width, height, tiles, exit, reachable, rngState: rng.state };
  }
  throw new Error("Cave generation produced too few chambers.");
}

export function mapLevel(id: MapLevel["id"], width: number, height: number, tiles: Tile[]): MapLevel {
  return { id, width, height, tiles };
}

export function lineBetween(from: Point, to: Point): Point[] {
  const points: Point[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y);
  const sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;

  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubled = error * 2;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}
