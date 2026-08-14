import { coordinateNoise } from "./game/rng";
import { environmentAt, getCaptain, getCurrentMap, isEnemyConcealed, isIncapacitated, isWet } from "./game/game";
import type { Actor, Coat, GameState, MapLevel, PickupType, Point, Terrain } from "./game/types";
import { tileIndex } from "./game/world";

const TILE_SIZE = 32;
export const VIEW_COLUMNS = 20;
export const VIEW_ROWS = 13;

const INK = "#1e2522";
const PALE_INK = "#57594f";
const PAPER = "#d8caa9";
const SHADOW_PAPER = "#aa9d80";
const DARK_PAPER = "#817762";
const SEA = "#aab8b0";

const COAT_COLORS: Record<Coat, string> = {
  crimson: "#783d35",
  navy: "#394d59",
  moss: "#56604b",
};

type SpriteKind = Terrain | PickupType | "captain" | "crew" | "crewDown" | "castaway" | "skeleton" | "crab" | "slag" | "bonegunner";

export interface Renderer {
  draw(state: GameState, cursor?: Point | null): void;
}

interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function getMapCamera(map: MapLevel, focus: Point, cursor: Point | null = null): Point {
  const maximumX = Math.max(0, map.width - VIEW_COLUMNS);
  const maximumY = Math.max(0, map.height - VIEW_ROWS);
  let x = Math.max(0, Math.min(maximumX, focus.x - Math.floor(VIEW_COLUMNS / 2)));
  let y = Math.max(0, Math.min(maximumY, focus.y - Math.floor(VIEW_ROWS / 2)));
  if (cursor) {
    if (cursor.x < x) x = cursor.x;
    else if (cursor.x >= x + VIEW_COLUMNS) x = cursor.x - VIEW_COLUMNS + 1;
    if (cursor.y < y) y = cursor.y;
    else if (cursor.y >= y + VIEW_ROWS) y = cursor.y - VIEW_ROWS + 1;
  }
  return {
    x: Math.max(0, Math.min(maximumX, x)),
    y: Math.max(0, Math.min(maximumY, y)),
  };
}

export function worldPointFromClient(
  client: Point,
  rect: CanvasRect,
  camera: Point,
  map: MapLevel,
): Point | null {
  const relativeX = client.x - rect.left;
  const relativeY = client.y - rect.top;
  if (rect.width <= 0 || rect.height <= 0 || relativeX < 0 || relativeY < 0 || relativeX >= rect.width || relativeY >= rect.height) {
    return null;
  }
  const point = {
    x: camera.x + Math.floor((relativeX / rect.width) * VIEW_COLUMNS),
    y: camera.y + Math.floor((relativeY / rect.height) * VIEW_ROWS),
  };
  return point.x < map.width && point.y < map.height ? point : null;
}

export function moveInspectionCursor(point: Point, dx: number, dy: number, map: MapLevel): Point {
  return {
    x: Math.max(0, Math.min(map.width - 1, point.x + Math.sign(dx))),
    y: Math.max(0, Math.min(map.height - 1, point.y + Math.sign(dy))),
  };
}

function hatch(context: CanvasRenderingContext2D, spacing: number, color: string, reverse = false): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.globalAlpha = 0.4;
  for (let offset = -TILE_SIZE; offset < TILE_SIZE * 2; offset += spacing) {
    context.beginPath();
    if (reverse) {
      context.moveTo(TILE_SIZE - offset, 0);
      context.lineTo(-offset, TILE_SIZE);
    } else {
      context.moveTo(offset, 0);
      context.lineTo(offset - TILE_SIZE, TILE_SIZE);
    }
    context.stroke();
  }
  context.restore();
}

function inkLine(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  width = 2,
  color = INK,
): void {
  const first = points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first[0], first[1]);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) context.lineTo(point[0], point[1]);
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.stroke();
}

function drawTerrain(context: CanvasRenderingContext2D, terrain: Terrain): void {
  context.fillStyle = terrain === "water" ? SEA : terrain === "caveWall" ? "#4a4c44" : terrain === "caveFloor" || terrain === "stairsUp" ? "#a69c83" : PAPER;
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);

  if (terrain === "water") {
    inkLine(context, [[1, 10], [8, 8], [15, 11], [23, 8], [31, 10]], 1, PALE_INK);
    inkLine(context, [[-3, 22], [4, 20], [12, 23], [20, 19], [28, 22], [35, 20]], 1, PALE_INK);
    return;
  }
  if (terrain === "caveWall") {
    inkLine(context, [[0, 8], [8, 5], [16, 9], [25, 4], [32, 7]], 2, "#191f1d");
    inkLine(context, [[0, 22], [7, 17], [15, 21], [22, 15], [32, 19]], 2, "#191f1d");
    hatch(context, 4, "#171c1a", true);
    return;
  }
  if (terrain === "caveFloor") {
    const cracks: Array<Array<[number, number]>> = [
      [[2, 25], [9, 20], [15, 23]],
      [[21, 7], [25, 12], [31, 10]],
    ];
    for (const crack of cracks) inkLine(context, crack, 1, PALE_INK);
    context.fillStyle = PALE_INK;
    context.fillRect(7, 8, 2, 1);
    context.fillRect(25, 26, 2, 1);
    return;
  }
  if (terrain === "stairsDown" || terrain === "stairsUp") {
    context.fillStyle = terrain === "stairsDown" ? "#8e846e" : "#a69c83";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    hatch(context, 7, PALE_INK);
    for (let step = 0; step < 4; step += 1) {
      const inset = 5 + step * 3;
      inkLine(context, [[inset, 8 + step * 5], [TILE_SIZE - inset, 8 + step * 5]], 2);
    }
    inkLine(context, terrain === "stairsDown" ? [[25, 5], [28, 9], [25, 13]] : [[7, 13], [4, 9], [7, 5]], 2);
    return;
  }
  if (terrain === "sand") {
    context.fillStyle = PALE_INK;
    const grains: Array<[number, number]> = [[5, 7], [15, 17], [26, 8], [8, 27], [25, 25]];
    for (const [x, y] of grains) context.fillRect(x, y, 1, 1);
    inkLine(context, [[2, 30], [10, 29], [19, 30], [31, 28]], 1, "#887d67");
    return;
  }
  if (terrain === "grass") {
    inkLine(context, [[5, 28], [7, 23], [8, 28], [11, 21], [11, 28]], 1, PALE_INK);
    inkLine(context, [[22, 12], [24, 7], [25, 13], [29, 6]], 1, PALE_INK);
    return;
  }
  if (terrain === "trail") {
    context.fillStyle = "#c5b48f";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    inkLine(context, [[0, 7], [8, 10], [17, 8], [25, 11], [32, 9]], 1, PALE_INK);
    inkLine(context, [[0, 24], [8, 21], [17, 23], [25, 20], [32, 22]], 1, PALE_INK);
    context.fillStyle = INK;
    context.globalAlpha = 0.45;
    context.fillRect(7, 15, 5, 2);
    context.fillRect(21, 14, 4, 2);
    context.globalAlpha = 1;
    return;
  }
  if (terrain === "spring") {
    context.fillStyle = "#b9b79d";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    context.fillStyle = SEA;
    context.beginPath();
    context.ellipse(16, 18, 12, 8, -0.1, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1;
    context.stroke();
    inkLine(context, [[4, 28], [7, 21], [9, 28], [12, 23]], 1, PALE_INK);
    inkLine(context, [[24, 11], [26, 5], [28, 12], [31, 7]], 1, PALE_INK);
    return;
  }
  if (terrain === "ruins") {
    context.fillStyle = "#b0a58b";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    inkLine(context, [[2, 29], [5, 13], [12, 13], [12, 7], [19, 7], [19, 17], [27, 17], [30, 29]], 3);
    inkLine(context, [[5, 24], [12, 20], [19, 24], [27, 21]], 1, PALE_INK);
    hatch(context, 6, PALE_INK, true);
    return;
  }
  if (terrain === "jungle") {
    context.fillStyle = "#b5aa8d";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    inkLine(context, [[3, 31], [7, 17], [4, 10], [12, 18], [15, 5], [18, 17], [26, 9], [24, 20], [30, 27]], 2);
    inkLine(context, [[0, 26], [9, 21], [17, 27], [25, 19], [32, 23]], 1);
    hatch(context, 7, PALE_INK);
    return;
  }
  if (terrain === "rock") {
    context.fillStyle = "#b0a58b";
    context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    inkLine(context, [[1, 29], [6, 14], [13, 9], [17, 15], [23, 6], [31, 27]], 2);
    inkLine(context, [[6, 25], [15, 17], [20, 27], [31, 21]], 1, PALE_INK);
    hatch(context, 5, PALE_INK, true);
    return;
  }
  if (terrain === "wreck") {
    inkLine(context, [[1, 24], [7, 27], [25, 26], [31, 21]], 2);
    inkLine(context, [[7, 26], [8, 11], [17, 23], [26, 9], [25, 26]], 2);
    inkLine(context, [[9, 14], [24, 13], [17, 23]], 1);
    hatch(context, 6, PALE_INK);
  }
}

function drawPerson(context: CanvasRenderingContext2D, coat: string, hat = true): void {
  context.fillStyle = PAPER;
  context.beginPath();
  context.arc(16, 10, 5, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = coat;
  context.beginPath();
  context.moveTo(10, 17);
  context.lineTo(7, 29);
  context.lineTo(25, 29);
  context.lineTo(22, 17);
  context.closePath();
  context.fill();
  context.stroke();
  inkLine(context, [[10, 19], [4, 25]], 2);
  inkLine(context, [[22, 19], [28, 23]], 2);
  inkLine(context, [[13, 29], [12, 31]], 2);
  inkLine(context, [[19, 29], [21, 31]], 2);
  if (hat) {
    context.fillStyle = INK;
    context.beginPath();
    context.moveTo(8, 8);
    context.lineTo(12, 2);
    context.lineTo(16, 6);
    context.lineTo(20, 2);
    context.lineTo(25, 9);
    context.closePath();
    context.fill();
  }
  hatch(context, 6, INK);
}

function drawSkeleton(context: CanvasRenderingContext2D, armed: boolean): void {
  context.fillStyle = PAPER;
  context.beginPath();
  context.arc(16, 8, 6, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = INK;
  context.fillRect(12, 6, 2, 2);
  context.fillRect(18, 6, 2, 2);
  inkLine(context, [[13, 11], [19, 11]], 1);
  inkLine(context, [[16, 14], [16, 27]], 2);
  inkLine(context, [[10, 17], [22, 17]], 2);
  inkLine(context, [[11, 20], [21, 20]], 1);
  inkLine(context, [[16, 27], [11, 31]], 2);
  inkLine(context, [[16, 27], [22, 31]], 2);
  if (armed) inkLine(context, [[21, 17], [31, 14]], 3);
}

function drawDownedCrew(context: CanvasRenderingContext2D): void {
  context.fillStyle = "#585a50";
  context.beginPath();
  context.ellipse(18, 23, 11, 5, -0.15, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = INK;
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = PAPER;
  context.beginPath();
  context.arc(7, 22, 4, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  inkLine(context, [[10, 21], [27, 16]], 2);
  inkLine(context, [[16, 25], [26, 29]], 2);
}

function drawCreature(context: CanvasRenderingContext2D, kind: "crab" | "slag"): void {
  if (kind === "crab") {
    context.fillStyle = "#a78e73";
    context.beginPath();
    context.ellipse(16, 20, 9, 6, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.stroke();
    inkLine(context, [[8, 19], [3, 14], [1, 9], [7, 12]], 2);
    inkLine(context, [[24, 19], [29, 14], [31, 9], [25, 12]], 2);
    inkLine(context, [[10, 24], [4, 29]], 2);
    inkLine(context, [[14, 25], [11, 31]], 2);
    inkLine(context, [[22, 24], [28, 29]], 2);
    inkLine(context, [[18, 25], [21, 31]], 2);
    context.fillStyle = INK;
    context.fillRect(11, 17, 2, 2);
    context.fillRect(19, 17, 2, 2);
  } else {
    context.fillStyle = "#5c5b51";
    context.beginPath();
    context.moveTo(5, 28);
    context.quadraticCurveTo(3, 19, 10, 16);
    context.quadraticCurveTo(7, 8, 15, 5);
    context.quadraticCurveTo(18, 11, 22, 12);
    context.quadraticCurveTo(30, 18, 27, 28);
    context.closePath();
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.stroke();
    hatch(context, 4, "#c0b393", true);
    context.fillStyle = PAPER;
    context.fillRect(12, 17, 3, 2);
    context.fillRect(20, 17, 3, 2);
  }
}

function drawPickup(context: CanvasRenderingContext2D, type: PickupType): void {
  context.fillStyle = "#ad9a77";
  context.strokeStyle = INK;
  context.lineWidth = 2;
  if (type === "mast") {
    inkLine(context, [[5, 28], [27, 4]], 4);
    inkLine(context, [[10, 24], [21, 26]], 2);
  } else if (type === "canvas") {
    context.beginPath();
    context.moveTo(7, 6);
    context.lineTo(26, 10);
    context.lineTo(23, 27);
    context.lineTo(5, 23);
    context.closePath();
    context.fill();
    context.stroke();
    hatch(context, 5, INK);
  } else if (type === "pitch") {
    context.fillRect(9, 8, 14, 20);
    context.strokeRect(9, 8, 14, 20);
    inkLine(context, [[9, 13], [23, 13]], 1);
    inkLine(context, [[9, 23], [23, 23]], 1);
  } else if (type === "leatherCoat" || type === "breastplate") {
    context.beginPath();
    context.moveTo(9, 7);
    context.lineTo(16, 10);
    context.lineTo(23, 7);
    context.lineTo(27, 25);
    context.lineTo(21, 29);
    context.lineTo(11, 29);
    context.lineTo(5, 25);
    context.closePath();
    context.fill();
    context.stroke();
    if (type === "breastplate") {
      inkLine(context, [[10, 13], [22, 13], [24, 24], [16, 27], [8, 24], [10, 13]], 2);
      hatch(context, 5, INK, true);
    } else {
      inkLine(context, [[9, 14], [23, 20]], 1);
      inkLine(context, [[8, 22], [21, 27]], 1);
    }
  } else if (type === "cutlass" || type === "knife" || type === "boardingAxe") {
    if (type === "boardingAxe") {
      inkLine(context, [[8, 29], [20, 8]], 3);
      context.beginPath();
      context.moveTo(17, 7);
      context.lineTo(27, 5);
      context.lineTo(24, 15);
      context.lineTo(19, 12);
      context.closePath();
      context.fill();
      context.stroke();
    } else {
      const bladeEnd = type === "cutlass" ? 27 : 23;
      inkLine(context, [[8, 26], [bladeEnd, 7]], type === "cutlass" ? 3 : 2);
      inkLine(context, [[7, 23], [12, 28]], 2);
    }
  } else if (type === "flintlock" || type === "pistol") {
    const stockEnd = type === "flintlock" ? 4 : 8;
    const barrelEnd = type === "flintlock" ? 29 : 25;
    inkLine(context, [[stockEnd, 23], [13, 17], [barrelEnd, 9]], 3);
    inkLine(context, [[12, 18], [15, 25], [20, 24]], 2);
    inkLine(context, [[17, 15], [20, 19]], 1);
  } else if (type === "ammo") {
    context.beginPath();
    context.arc(16, 19, 8, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    inkLine(context, [[12, 13], [13, 7], [19, 7], [20, 13]], 2);
    context.fillStyle = INK;
    context.fillRect(15, 17, 2, 2);
  } else {
    context.fillRect(11, 9, 10, 19);
    context.strokeRect(11, 9, 10, 19);
    context.fillStyle = INK;
    context.fillRect(13, 5, 6, 5);
    inkLine(context, [[13, 17], [19, 17]], 1);
  }
}

function makeSprite(kind: SpriteKind, coat: Coat): HTMLCanvasElement {
  const sprite = document.createElement("canvas");
  sprite.width = TILE_SIZE;
  sprite.height = TILE_SIZE;
  const context = sprite.getContext("2d");
  if (!context) throw new Error("Canvas rendering is unavailable.");

  if (["water", "sand", "grass", "trail", "spring", "ruins", "jungle", "rock", "wreck", "caveWall", "caveFloor", "stairsDown", "stairsUp"].includes(kind)) {
    drawTerrain(context, kind as Terrain);
  } else if (kind === "captain") drawPerson(context, COAT_COLORS[coat]);
  else if (kind === "crew") drawPerson(context, "#585a50", false);
  else if (kind === "crewDown") drawDownedCrew(context);
  else if (kind === "castaway") drawPerson(context, "#8b8069", false);
  else if (kind === "skeleton") drawSkeleton(context, false);
  else if (kind === "bonegunner") drawSkeleton(context, true);
  else if (kind === "crab" || kind === "slag") drawCreature(context, kind);
  else drawPickup(context, kind as PickupType);
  return sprite;
}

function actorSprite(actor: Actor): SpriteKind {
  if (isIncapacitated(actor)) return "crewDown";
  if (actor.kind !== "enemy") return actor.kind;
  return actor.enemyType ?? "skeleton";
}

function drawEnvironment(context: CanvasRenderingContext2D, fireTurns: number, smokeTurns: number, x: number, y: number): void {
  context.save();
  context.translate(x, y);
  if (fireTurns > 0) {
    context.fillStyle = "#8c3f36";
    context.strokeStyle = INK;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(7, 31);
    context.quadraticCurveTo(4, 20, 12, 13);
    context.quadraticCurveTo(11, 23, 17, 18);
    context.quadraticCurveTo(24, 10, 25, 29);
    context.closePath();
    context.fill();
    context.stroke();
  }
  if (smokeTurns > 0) {
    context.strokeStyle = "rgba(30, 37, 34, 0.72)";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(3, 24);
    context.bezierCurveTo(10, 17, 2, 11, 12, 6);
    context.moveTo(15, 29);
    context.bezierCurveTo(25, 23, 15, 14, 29, 9);
    context.stroke();
  }
  context.restore();
}

function drawBurningMarker(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.translate(x + 20, y + 18);
  context.fillStyle = "#8c3f36";
  context.strokeStyle = INK;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(1, 12);
  context.quadraticCurveTo(-1, 6, 4, 3);
  context.quadraticCurveTo(4, 8, 8, 5);
  context.quadraticCurveTo(13, 9, 10, 14);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const maybeContext = canvas.getContext("2d");
  if (!maybeContext) throw new Error("Canvas rendering is unavailable.");
  const context: CanvasRenderingContext2D = maybeContext;
  context.imageSmoothingEnabled = false;
  const sprites = new Map<string, HTMLCanvasElement>();

  function sprite(kind: SpriteKind, coat: Coat): HTMLCanvasElement {
    const key = `${kind}:${coat}`;
    let value = sprites.get(key);
    if (!value) {
      value = makeSprite(kind, coat);
      sprites.set(key, value);
    }
    return value;
  }

  function draw(state: GameState, cursor: Point | null = null): void {
    const player = getCaptain(state);
    const map = getCurrentMap(state);
    const camera = getMapCamera(map, player, cursor);
    const cameraX = camera.x;
    const cameraY = camera.y;
    context.fillStyle = INK;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let viewY = 0; viewY < VIEW_ROWS; viewY += 1) {
      for (let viewX = 0; viewX < VIEW_COLUMNS; viewX += 1) {
        const worldX = cameraX + viewX;
        const worldY = cameraY + viewY;
        const tile = map.tiles[tileIndex(worldX, worldY, map.width)];
        const screenX = viewX * TILE_SIZE;
        const screenY = viewY * TILE_SIZE;
        if (!tile?.explored) {
          context.fillStyle = "#222923";
          context.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          continue;
        }
        context.drawImage(sprite(tile.terrain, state.captainConfig.coat), screenX, screenY);
        if (!tile.visible) {
          context.fillStyle = "rgba(35, 39, 33, 0.6)";
          context.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        } else {
          const grain = coordinateNoise(`${state.seed}:${state.currentLevel}`, worldX, worldY);
          context.fillStyle = grain > 0.5 ? "rgba(255,255,255,0.025)" : "rgba(20,20,16,0.025)";
          context.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          const environment = environmentAt(state, state.currentLevel, { x: worldX, y: worldY });
          if (environment) drawEnvironment(context, environment.fireTurns, environment.smokeTurns, screenX, screenY);
        }
      }
    }

    if (state.currentLevel === "surface" && state.surfaceWeather.phase === "rain") {
      context.save();
      context.strokeStyle = "rgba(57, 77, 89, 0.35)";
      context.lineWidth = 1;
      for (let y = 4; y < canvas.height; y += 24) {
        for (let x = (y / 24 % 2) * 12; x < canvas.width; x += 32) {
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x - 5, y + 10);
          context.stroke();
        }
      }
      context.restore();
    }

    for (const pickup of state.pickups) {
      const tile = map.tiles[tileIndex(pickup.x, pickup.y, map.width)];
      const environment = environmentAt(state, state.currentLevel, pickup);
      const obscured = Boolean(environment?.smokeTurns) && Math.max(Math.abs(pickup.x - player.x), Math.abs(pickup.y - player.y)) > 1;
      if (pickup.collected || pickup.level !== state.currentLevel || !tile?.visible || obscured) continue;
      context.drawImage(
        sprite(pickup.type, state.captainConfig.coat),
        (pickup.x - cameraX) * TILE_SIZE,
        (pickup.y - cameraY) * TILE_SIZE,
      );
    }

    const drawableActors = state.actors
      .filter((actor) => actor.alive && actor.level === state.currentLevel && !isEnemyConcealed(actor))
      .sort((a, b) => Number(isIncapacitated(b)) - Number(isIncapacitated(a)));
    for (const actor of drawableActors) {
      const tile = map.tiles[tileIndex(actor.x, actor.y, map.width)];
      const environment = environmentAt(state, state.currentLevel, actor);
      const obscured = Boolean(environment?.smokeTurns) && Math.max(Math.abs(actor.x - player.x), Math.abs(actor.y - player.y)) > 1;
      if (!tile?.visible || (obscured && actor.kind !== "captain")) continue;
      const screenX = (actor.x - cameraX) * TILE_SIZE;
      const screenY = (actor.y - cameraY) * TILE_SIZE;
      if (actor.id === state.targetId) {
        context.strokeStyle = "#8c3f36";
        context.lineWidth = 2;
        context.strokeRect(screenX + 2, screenY + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        inkLine(context, [[screenX, screenY], [screenX + 7, screenY + 7]], 2, "#8c3f36");
        inkLine(
          context,
          [[screenX + TILE_SIZE, screenY], [screenX + TILE_SIZE - 7, screenY + 7]],
          2,
          "#8c3f36",
        );
      }
      context.drawImage(sprite(actorSprite(actor), state.captainConfig.coat), screenX, screenY);
      if (actor.burningTurns > 0) drawBurningMarker(context, screenX, screenY);
      if (actor.kind === "enemy" && actor.enemyAttribute) {
        context.fillStyle = PAPER;
        context.strokeStyle = INK;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(screenX + 26, screenY + 3);
        context.lineTo(screenX + 30, screenY + 7);
        context.lineTo(screenX + 26, screenY + 11);
        context.lineTo(screenX + 22, screenY + 7);
        context.closePath();
        context.fill();
        context.stroke();
      }
      const rivalTarget = actor.enemyAwareness?.targetId === null
        ? null
        : state.actors.find(
            (candidate) =>
              candidate.id === actor.enemyAwareness?.targetId &&
              candidate.kind === "enemy" &&
              candidate.alive &&
              candidate.level === state.currentLevel,
          );
      if (rivalTarget) {
        inkLine(context, [[screenX + 2, screenY + 3], [screenX + 10, screenY + 11]], 2, PAPER);
        inkLine(context, [[screenX + 10, screenY + 3], [screenX + 2, screenY + 11]], 2, PAPER);
        inkLine(context, [[screenX + 2, screenY + 3], [screenX + 10, screenY + 11]], 1, INK);
        inkLine(context, [[screenX + 10, screenY + 3], [screenX + 2, screenY + 11]], 1, INK);
      }
      if (isWet(state, actor)) {
        context.fillStyle = "#394d59";
        context.strokeStyle = PAPER;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(screenX + 5, screenY + 4);
        context.quadraticCurveTo(screenX + 1, screenY + 9, screenX + 5, screenY + 12);
        context.quadraticCurveTo(screenX + 9, screenY + 9, screenX + 5, screenY + 4);
        context.fill();
        context.stroke();
      }
      if (actor.kind === "crew" && actor.crewReaction === "brace") {
        context.fillStyle = PAPER;
        context.strokeStyle = INK;
        context.lineWidth = 2;
        context.fillRect(screenX + 22, screenY + 22, 8, 8);
        context.strokeRect(screenX + 22, screenY + 22, 8, 8);
      }
      if (actor.hp < actor.maxHp) {
        context.fillStyle = "#2e302b";
        context.fillRect(screenX + 4, screenY + 1, 24, 3);
        context.fillStyle = "#8c3f36";
        context.fillRect(screenX + 4, screenY + 1, Math.ceil(24 * (actor.hp / actor.maxHp)), 3);
      }
    }

    if (cursor) {
      const screenX = (cursor.x - cameraX) * TILE_SIZE;
      const screenY = (cursor.y - cameraY) * TILE_SIZE;
      if (screenX >= 0 && screenY >= 0 && screenX < canvas.width && screenY < canvas.height) {
        context.save();
        context.strokeStyle = PAPER;
        context.lineWidth = 5;
        context.strokeRect(screenX + 3, screenY + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        context.strokeStyle = INK;
        context.lineWidth = 2;
        context.setLineDash([5, 3]);
        context.strokeRect(screenX + 3, screenY + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        context.restore();
      }
    }

    context.strokeStyle = DARK_PAPER;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  }

  return { draw };
}

export const palette = { ink: INK, paper: PAPER, shadowPaper: SHADOW_PAPER };
