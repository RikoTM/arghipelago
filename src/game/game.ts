import { Rng } from "./rng";
import type {
  Actor,
  CaptainConfig,
  CrewOrder,
  EnemyType,
  GameState,
  LevelId,
  MapLevel,
  Pickup,
  PickupType,
  Point,
  RepairPart,
} from "./types";
import { generateCave, generateIsland, inBounds, isPassableTerrain, lineBetween, mapLevel, tileIndex } from "./world";

const DIRECTIONS: Point[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
];

const REPAIR_NAMES: Record<RepairPart, string> = {
  mast: "a mast that is less horizontal than the current one",
  canvas: "enough sailcloth to alarm a modest tent",
  pitch: "a barrel of suspiciously warm pitch",
};

const REPAIR_LABELS: Record<RepairPart, string> = {
  mast: "replacement mast",
  canvas: "sailcloth",
  pitch: "pitch barrel",
};

const REPAIR_SEQUENCE: RepairPart[] = ["mast", "canvas", "pitch"];

const PICKUP_NAMES: Record<PickupType, string> = {
  ...REPAIR_NAMES,
  ammo: "a pouch of dry powder and shot",
  salts: "a bottle of extremely motivational smelling salts",
};

const CREW: Array<{ name: string; role: string; melee: number }> = [
  { name: "Peg-Less Pete", role: "Carpenter, despite the name", melee: 2 },
  { name: "Dr. Marrow", role: "Surgeon and amateur anatomist", melee: 1 },
  { name: "Anne Teak", role: "Gunner, furniture enthusiast", melee: 2 },
];

const ENEMY_NAMES: Record<EnemyType, string[]> = {
  skeleton: ["Skeleton Deckhand", "Bony Bosun", "Undead Swabber"],
  crab: ["Indignant Crab", "Cutlass Crab", "Crab of Unusual Rank"],
  slag: ["Smouldering Slag", "Bilge Slag", "Sulky Slag"],
  bonegunner: ["Skeleton Fusilier", "Dead-Eye Dead Ned", "Powder-Dry Corpse"],
};

function distance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function directionFrom(from: Point, to: Point): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = dx < 0 ? "west" : "east";
  const vertical = dy < 0 ? "north" : "south";
  if (Math.abs(dx) > Math.abs(dy) * 2) return horizontal;
  if (Math.abs(dy) > Math.abs(dx) * 2) return vertical;
  return `${vertical}${horizontal}`;
}

function currentMap(state: GameState): MapLevel {
  return state.levels[state.currentLevel];
}

function actorAt(state: GameState, x: number, y: number, ignoreId?: number): Actor | undefined {
  return state.actors.find(
    (actor) =>
      actor.alive && actor.level === state.currentLevel && actor.id !== ignoreId && actor.x === x && actor.y === y,
  );
}

function captain(state: GameState): Actor {
  const actor = state.actors.find((candidate) => candidate.id === state.captainId);
  if (!actor) throw new Error("The captain has gone missing from the game state.");
  return actor;
}

function addMessage(state: GameState, message: string): void {
  state.messages.push(message);
  if (state.messages.length > 40) state.messages.splice(0, state.messages.length - 40);
}

function blocksSight(state: GameState, point: Point): boolean {
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(point.x, point.y, map.width)]?.terrain;
  return terrain === "jungle" || terrain === "rock" || terrain === "caveWall";
}

export function hasLineOfSight(state: GameState, from: Point, to: Point): boolean {
  const line = lineBetween(from, to);
  for (let index = 1; index < line.length - 1; index += 1) {
    const point = line[index];
    if (point && blocksSight(state, point)) return false;
  }
  return true;
}

export function updateVisibility(state: GameState): void {
  const map = currentMap(state);
  for (const tile of map.tiles) tile.visible = false;
  const player = captain(state);
  const baseRadius = state.currentLevel === "cave" ? 6 : 8;
  const radius = baseRadius + (state.captainConfig.background === "navigator" ? 2 : 0);

  for (let y = player.y - radius; y <= player.y + radius; y += 1) {
    for (let x = player.x - radius; x <= player.x + radius; x += 1) {
      if (!inBounds(x, y, map.width, map.height) || distance(player, { x, y }) > radius) continue;
      if (!hasLineOfSight(state, player, { x, y })) continue;
      const tile = map.tiles[tileIndex(x, y, map.width)];
      if (!tile) continue;
      tile.visible = true;
      tile.explored = true;
    }
  }
  const entranceTile = state.levels.surface.tiles[
    tileIndex(state.caveEntrance.x, state.caveEntrance.y, state.levels.surface.width)
  ];
  if (state.currentLevel === "surface" && entranceTile?.visible && !state.caveDiscovered) {
    state.caveDiscovered = true;
    addMessage(state, "You discover the cave entrance. It appears to have been expecting you.");
  }
}

function takePlacement(pool: Point[], rng: Rng, predicate: (point: Point) => boolean): Point {
  const choices = pool.filter(predicate);
  const point = choices[rng.int(choices.length)] ?? pool[rng.int(pool.length)];
  if (!point) throw new Error("Island generation did not provide enough placement space.");
  const index = pool.findIndex((candidate) => candidate.x === point.x && candidate.y === point.y);
  if (index >= 0) pool.splice(index, 1);
  return point;
}

function makeEnemy(id: number, type: EnemyType, point: Point, rng: Rng, level: LevelId = "surface"): Actor {
  const health = type === "slag" ? 7 : type === "crab" ? 3 : 5;
  const melee = type === "slag" ? 2 : 1;
  const names = ENEMY_NAMES[type];
  return {
    id,
    level,
    kind: "enemy",
    enemyType: type,
    name: names[rng.int(names.length)] ?? "Unnamed Menace",
    x: point.x,
    y: point.y,
    hp: health,
    maxHp: health,
    melee,
    alive: true,
    alerted: false,
    alertTurns: 0,
  };
}

export function createGame(config: CaptainConfig, seed: string): GameState {
  const island = generateIsland(seed);
  const cave = generateCave(seed);
  const rng = new Rng(island.rngState ^ cave.rngState);
  const privateerHealth = config.background === "privateer" ? 2 : 0;
  const pool = island.reachable.filter(
    (point) =>
      distance(point, island.wreck) > 2 &&
      (point.x !== island.caveEntrance.x || point.y !== island.caveEntrance.y) &&
      island.tiles[tileIndex(point.x, point.y, island.width)]?.terrain !== "water",
  );
  const actors: Actor[] = [
    {
      id: 1,
      level: "surface",
      kind: "captain",
      name: config.name,
      x: island.wreck.x,
      y: island.wreck.y,
      hp: 16 + privateerHealth,
      maxHp: 16 + privateerHealth,
      melee: 2,
      alive: true,
      alerted: true,
      alertTurns: 0,
    },
  ];
  const pickups: Pickup[] = [];
  let nextId = 2;

  for (const [index, recruit] of CREW.entries()) {
    const point = takePlacement(pool, rng, (candidate) => distance(candidate, island.wreck) > 9 + index * 2);
    actors.push({
      id: nextId,
      level: "surface",
      kind: "castaway",
      name: recruit.name,
      role: recruit.role,
      x: point.x,
      y: point.y,
      hp: 8,
      maxHp: 8,
      melee: recruit.melee,
      alive: true,
      alerted: false,
      alertTurns: 0,
    });
    nextId += 1;
  }

  const pickupTypes: PickupType[] = ["mast", "canvas", "ammo", "ammo", "salts"];
  for (const [index, type] of pickupTypes.entries()) {
    const minimumDistance = index < 2 ? 13 + index * 2 : 7;
    const point = takePlacement(pool, rng, (candidate) => distance(candidate, island.wreck) > minimumDistance);
    pickups.push({ id: nextId, level: "surface", type, x: point.x, y: point.y, collected: false });
    nextId += 1;
  }

  const closeEnemyPoint = takePlacement(pool, rng, (point) => {
    const range = distance(point, island.wreck);
    return range >= 8 && range <= 10;
  });
  actors.push(makeEnemy(nextId, "skeleton", closeEnemyPoint, rng));
  nextId += 1;

  const enemyTypes: EnemyType[] = [
    "crab",
    "crab",
    "skeleton",
    "skeleton",
    "slag",
    "bonegunner",
  ];
  for (const type of enemyTypes) {
    const point = takePlacement(pool, rng, (candidate) => distance(candidate, island.wreck) > 12);
    actors.push(makeEnemy(nextId, type, point, rng));
    nextId += 1;
  }

  const cavePool = cave.reachable.filter((point) => distance(point, cave.exit) > 3);
  const pitchPoint = takePlacement(cavePool, rng, (point) => distance(point, cave.exit) > 16);
  pickups.push({ id: nextId, level: "cave", type: "pitch", x: pitchPoint.x, y: pitchPoint.y, collected: false });
  nextId += 1;
  for (const type of ["ammo", "salts"] as const) {
    const point = takePlacement(cavePool, rng, (candidate) => distance(candidate, cave.exit) > 7);
    pickups.push({ id: nextId, level: "cave", type, x: point.x, y: point.y, collected: false });
    nextId += 1;
  }
  for (const type of ["skeleton", "skeleton", "slag", "slag", "bonegunner", "skeleton"] as const) {
    const point = takePlacement(cavePool, rng, (candidate) => distance(candidate, cave.exit) > 5);
    actors.push(makeEnemy(nextId, type, point, rng, "cave"));
    nextId += 1;
  }

  const state: GameState = {
    version: 4,
    seed,
    rngState: rng.state,
    levels: {
      surface: mapLevel("surface", island.width, island.height, island.tiles),
      cave: mapLevel("cave", cave.width, cave.height, cave.tiles),
    },
    currentLevel: "surface",
    actors,
    pickups,
    captainId: 1,
    wreck: island.wreck,
    caveEntrance: island.caveEntrance,
    caveExit: cave.exit,
    caveDiscovered: false,
    turn: 0,
    threat: 0,
    dangerLevel: 0,
    crewOrder: "follow",
    inventory: { loaded: true, ammo: 6, salts: config.background === "surgeon" ? 2 : 1 },
    recoveredParts: { mast: false, canvas: false, pitch: false },
    repairs: { mast: false, canvas: false, pitch: false },
    captainConfig: config,
    messages: [
      `Captain ${config.name} washes ashore with a loaded flintlock and several concerns.`,
      "The ship is in three large pieces and rather more small ones. Find the mast, sailcloth, and a pitch barrel rumored to be underground.",
      `A tar-streaked trail leads ${directionFrom(island.wreck, island.caveEntrance)} from the wreck toward a cave. Possibly the right cave.`,
    ],
    phase: "playing",
    targetId: null,
  };
  updateVisibility(state);
  return state;
}

function damageActor(state: GameState, target: Actor, amount: number, sourceName: string): void {
  target.hp -= amount;
  addMessage(state, `${sourceName} hits ${target.name} for ${amount}.`);
  if (target.hp > 0) return;

  target.alive = false;
  target.hp = 0;
  if (target.kind === "captain") {
    if (state.inventory.salts > 0) {
      state.inventory.salts -= 1;
      target.alive = true;
      target.hp = state.captainConfig.background === "surgeon" ? 5 : 3;
      addMessage(state, "The smelling salts dispute the captain's death on a technicality.");
      return;
    }
    state.phase = "lost";
    addMessage(state, `Captain ${target.name} dies. The island declines to apologize.`);
  } else {
    addMessage(state, `${target.name} is killed.`);
    if (target.id === state.targetId) state.targetId = null;
  }
}

function meleeAttack(state: GameState, attacker: Actor, target: Actor, rng: Rng): void {
  const base = attacker.melee + rng.int(2);
  const duelistBonus = attacker.kind === "captain" && state.captainConfig.knack === "duelist" ? 1 : 0;
  const luckyBonus = attacker.kind === "captain" && state.captainConfig.knack === "lucky" && rng.chance(0.25) ? 1 : 0;
  const damage = base + duelistBonus + luckyBonus;
  if (luckyBonus > 0) addMessage(state, "A fortunate wobble improves the captain's attack.");
  damageActor(state, target, damage, attacker.name);
}

function collectAtCaptain(state: GameState): void {
  const player = captain(state);
  for (const pickup of state.pickups) {
    if (
      pickup.collected ||
      pickup.level !== state.currentLevel ||
      pickup.x !== player.x ||
      pickup.y !== player.y
    ) continue;
    pickup.collected = true;
    if (pickup.type === "ammo") state.inventory.ammo += 4;
    else if (pickup.type === "salts") state.inventory.salts += 1;
    else state.recoveredParts[pickup.type] = true;
    addMessage(state, `You recover ${PICKUP_NAMES[pickup.type]}.`);
  }
}

function recruitNearby(state: GameState): void {
  const player = captain(state);
  const currentCrew = state.actors.filter((actor) => actor.alive && actor.kind === "crew").length;
  if (currentCrew >= 3) return;
  for (const actor of state.actors) {
    if (
      actor.alive &&
      actor.level === state.currentLevel &&
      actor.kind === "castaway" &&
      distance(player, actor) <= 1
    ) {
      actor.kind = "crew";
      actor.alerted = true;
      addMessage(state, `${actor.name} joins the crew. ${actor.role ?? "Qualifications remain hazy."}`);
      return;
    }
  }
}

function tryMoveActor(state: GameState, actor: Actor, x: number, y: number): boolean {
  const map = currentMap(state);
  if (actor.level !== state.currentLevel || !inBounds(x, y, map.width, map.height)) return false;
  const tile = map.tiles[tileIndex(x, y, map.width)];
  if (!tile || !isPassableTerrain(tile.terrain) || actorAt(state, x, y, actor.id)) return false;
  actor.x = x;
  actor.y = y;
  return true;
}

function bestStepToward(state: GameState, actor: Actor, destination: Point): Point | null {
  const map = currentMap(state);
  const choices = DIRECTIONS.map((direction) => ({ x: actor.x + direction.x, y: actor.y + direction.y }))
    .filter((point) => {
      if (!inBounds(point.x, point.y, map.width, map.height)) return false;
      const tile = map.tiles[tileIndex(point.x, point.y, map.width)];
      return Boolean(tile && isPassableTerrain(tile.terrain) && !actorAt(state, point.x, point.y, actor.id));
    })
    .sort((a, b) => distance(a, destination) - distance(b, destination));
  return choices[0] ?? null;
}

function runCrewTurns(state: GameState, rng: Rng): void {
  const player = captain(state);
  for (const crew of state.actors.filter(
    (actor) => actor.alive && actor.level === state.currentLevel && actor.kind === "crew",
  )) {
    const adjacentEnemy = state.actors.find(
      (actor) =>
        actor.alive && actor.level === state.currentLevel && actor.kind === "enemy" && distance(crew, actor) <= 1,
    );
    if (adjacentEnemy && state.crewOrder !== "rally") {
      meleeAttack(state, crew, adjacentEnemy, rng);
      continue;
    }
    if (state.crewOrder === "hold") continue;
    const desiredDistance = state.crewOrder === "rally" ? 1 : 2;
    if (distance(crew, player) > desiredDistance) {
      const step = bestStepToward(state, crew, player);
      if (step) tryMoveActor(state, crew, step.x, step.y);
    }
  }
}

function runEnemyTurns(state: GameState, rng: Rng): void {
  const player = captain(state);
  const possibleTargets = (): Actor[] =>
    state.actors.filter(
      (actor) =>
        actor.alive &&
        actor.level === state.currentLevel &&
        (actor.kind === "captain" || actor.kind === "crew"),
    );

  for (const enemy of state.actors.filter(
    (actor) => actor.alive && actor.level === state.currentLevel && actor.kind === "enemy",
  )) {
    const targets = possibleTargets().sort((a, b) => distance(enemy, a) - distance(enemy, b));
    const target = targets[0];
    if (!target) continue;
    const detectionRange = enemy.enemyType === "bonegunner" ? 7 : enemy.enemyType === "crab" ? 4 : 5;
    if (distance(enemy, player) <= detectionRange && hasLineOfSight(state, enemy, player)) {
      enemy.alerted = true;
      enemy.alertTurns = 10;
    } else if (enemy.alerted) {
      enemy.alertTurns -= 1;
      if (enemy.alertTurns <= 0 && distance(enemy, player) > detectionRange) enemy.alerted = false;
    }
    if (!enemy.alerted) continue;

    if (distance(enemy, target) <= 1) {
      meleeAttack(state, enemy, target, rng);
      if (state.phase !== "playing") return;
      continue;
    }

    if (enemy.enemyType === "bonegunner" && distance(enemy, target) <= 5 && hasLineOfSight(state, enemy, target)) {
      if (rng.chance(0.65)) damageActor(state, target, 2, enemy.name);
      else addMessage(state, `${enemy.name} fires. A nearby tree is gravely inconvenienced.`);
      if (state.phase !== "playing") return;
      continue;
    }

    const step = bestStepToward(state, enemy, target);
    if (step) tryMoveActor(state, enemy, step.x, step.y);
  }
}

function spawnEscalation(state: GameState, rng: Rng): void {
  if (state.turn === 0 || state.turn % 60 !== 0) return;
  state.dangerLevel += 1;
  addMessage(
    state,
    state.currentLevel === "cave"
      ? "Something deeper in the cave has noticed how long this is taking."
      : "Something in the jungle has noticed how long this is taking.",
  );
  const player = captain(state);
  const map = currentMap(state);
  const candidates: Point[] = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = map.tiles[tileIndex(x, y, map.width)];
      if (
        tile &&
        isPassableTerrain(tile.terrain) &&
        !tile.visible &&
        !actorAt(state, x, y) &&
        distance(player, { x, y }) > 9
      ) {
        candidates.push({ x, y });
      }
    }
  }
  const point = candidates[rng.int(candidates.length)];
  if (!point) return;
  const types: EnemyType[] = state.currentLevel === "cave"
    ? ["skeleton", "slag", "bonegunner"]
    : ["skeleton", "crab", "slag", "bonegunner"];
  const type = types[rng.int(types.length)] ?? "skeleton";
  const nextId = Math.max(...state.actors.map((actor) => actor.id), ...state.pickups.map((pickup) => pickup.id)) + 1;
  const enemy = makeEnemy(nextId, type, point, rng, state.currentLevel);
  state.actors.push(enemy);
}

function finishTurn(state: GameState, noise = 0): void {
  if (state.phase !== "playing") return;
  const rng = new Rng(state.rngState);
  state.turn += 1;
  state.threat = Math.max(0, state.threat - 1);
  if (noise > 0) {
    state.threat += noise;
    const player = captain(state);
    for (const enemy of state.actors) {
      if (
        enemy.alive &&
        enemy.level === state.currentLevel &&
        enemy.kind === "enemy" &&
        distance(player, enemy) <= noise
      ) {
        enemy.alerted = true;
        enemy.alertTurns = Math.max(enemy.alertTurns, 8);
      }
    }
  }
  runCrewTurns(state, rng);
  runEnemyTurns(state, rng);
  spawnEscalation(state, rng);
  state.rngState = rng.state;
  if (state.phase === "playing") {
    collectAtCaptain(state);
    recruitNearby(state);
  }
  updateVisibility(state);
}

export function moveCaptain(state: GameState, dx: number, dy: number): boolean {
  if (state.phase !== "playing" || (dx === 0 && dy === 0)) return false;
  const player = captain(state);
  const map = currentMap(state);
  const x = player.x + Math.sign(dx);
  const y = player.y + Math.sign(dy);
  if (!inBounds(x, y, map.width, map.height)) return false;
  const tile = map.tiles[tileIndex(x, y, map.width)];
  if (!tile || !isPassableTerrain(tile.terrain)) {
    const message = tile?.terrain === "water"
      ? "You cannot swim while carrying this much leadership."
      : tile?.terrain === "caveWall"
        ? "The cave wall remains unmoved by your authority."
        : "That way is blocked.";
    addMessage(state, message);
    return false;
  }

  const occupant = actorAt(state, x, y, player.id);
  if (occupant) {
    if (occupant.kind === "enemy") {
      const rng = new Rng(state.rngState);
      meleeAttack(state, player, occupant, rng);
      state.rngState = rng.state;
      finishTurn(state);
      return true;
    }
    if (occupant.kind === "castaway") {
      recruitNearby(state);
      const previous = { x: player.x, y: player.y };
      player.x = occupant.x;
      player.y = occupant.y;
      occupant.x = previous.x;
      occupant.y = previous.y;
      finishTurn(state);
      return true;
    }
    if (occupant.kind === "crew") {
      const previous = { x: player.x, y: player.y };
      player.x = occupant.x;
      player.y = occupant.y;
      occupant.x = previous.x;
      occupant.y = previous.y;
      finishTurn(state);
      return true;
    }
    addMessage(state, `${occupant.name} politely occupies that particular bit of island.`);
    return false;
  }

  player.x = x;
  player.y = y;
  collectAtCaptain(state);
  recruitNearby(state);
  finishTurn(state);
  return true;
}

export function waitTurn(state: GameState): void {
  if (state.phase !== "playing") return;
  addMessage(state, "You wait with professional intensity.");
  finishTurn(state);
}

export function reloadFlintlock(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  if (state.inventory.loaded) {
    addMessage(state, "The flintlock is already loaded. Overachieving here would be unwise.");
    return false;
  }
  if (state.inventory.ammo <= 0) {
    addMessage(state, "You possess no powder or shot, only confidence.");
    return false;
  }
  state.inventory.ammo -= 1;
  state.inventory.loaded = true;
  addMessage(state, "You reload the flintlock. Nothing explodes prematurely.");
  finishTurn(state);
  return true;
}

export function visibleEnemies(state: GameState): Actor[] {
  const player = captain(state);
  const map = currentMap(state);
  return state.actors
    .filter((actor) => {
      const tile = map.tiles[tileIndex(actor.x, actor.y, map.width)];
      return actor.alive && actor.level === state.currentLevel && actor.kind === "enemy" && tile?.visible && distance(player, actor) <= 8;
    })
    .sort((a, b) => distance(player, a) - distance(player, b));
}

export function cycleTarget(state: GameState): Actor | null {
  const enemies = visibleEnemies(state);
  if (enemies.length === 0) {
    state.targetId = null;
    addMessage(state, "There is nothing suitable to shoot. This is probably temporary.");
    return null;
  }
  const currentIndex = enemies.findIndex((enemy) => enemy.id === state.targetId);
  const target = enemies[(currentIndex + 1) % enemies.length] ?? enemies[0] ?? null;
  state.targetId = target?.id ?? null;
  return target;
}

export function fireFlintlock(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  let target = state.actors.find(
    (actor) =>
      actor.id === state.targetId &&
      actor.alive &&
      actor.level === state.currentLevel &&
      actor.kind === "enemy",
  );
  if (!target) target = visibleEnemies(state)[0];
  if (!target || distance(player, target) > 8 || !hasLineOfSight(state, player, target)) {
    addMessage(state, "No clear target presents itself.");
    return false;
  }
  if (!state.inventory.loaded) {
    addMessage(state, "The flintlock clicks with devastating sarcasm. Reload it.");
    return false;
  }

  const interveningCrew = state.actors.find((actor) => {
    if (!actor.alive || actor.level !== state.currentLevel || actor.kind !== "crew") return false;
    return lineBetween(player, target as Actor).slice(1, -1).some((point) => point.x === actor.x && point.y === actor.y);
  });
  if (interveningCrew) {
    addMessage(state, `${interveningCrew.name} is in the line of fire and would prefer not to be.`);
    return false;
  }

  const rng = new Rng(state.rngState);
  state.inventory.loaded = false;
  const accuracy = state.captainConfig.knack === "deadeye" ? 0.95 : state.captainConfig.knack === "lucky" ? 0.85 : 0.78;
  if (rng.chance(accuracy)) {
    damageActor(state, target, 5 + rng.int(3), player.name);
  } else {
    addMessage(state, `${player.name} fires and decisively defeats some foliage.`);
  }
  state.rngState = rng.state;
  finishTurn(state, 10);
  return true;
}

const ORDER_SEQUENCE: CrewOrder[] = ["follow", "hold", "rally"];

export function cycleCrewOrder(state: GameState): CrewOrder {
  const crewCount = state.actors.filter(
    (actor) => actor.alive && actor.level === state.currentLevel && actor.kind === "crew",
  ).length;
  if (crewCount === 0) {
    addMessage(state, "You issue a crisp order to nobody in particular.");
    return state.crewOrder;
  }
  const index = ORDER_SEQUENCE.indexOf(state.crewOrder);
  state.crewOrder = ORDER_SEQUENCE[(index + 1) % ORDER_SEQUENCE.length] ?? "follow";
  addMessage(state, `Crew order: ${state.crewOrder}. The crew look approximately convinced.`);
  finishTurn(state);
  return state.crewOrder;
}

export function getCaptain(state: GameState): Actor {
  return captain(state);
}

function nextRecoveredRepair(state: GameState): RepairPart | null {
  return REPAIR_SEQUENCE.find((part) => state.recoveredParts[part] && !state.repairs[part]) ?? null;
}

function isAtWreck(state: GameState): boolean {
  const player = captain(state);
  return state.currentLevel === "surface" && player.x === state.wreck.x && player.y === state.wreck.y;
}

function inspectWreck(state: GameState): void {
  const tally = REPAIR_SEQUENCE.map((part) => {
    if (state.repairs[part]) return `${REPAIR_LABELS[part]} installed`;
    if (state.recoveredParts[part]) return `${REPAIR_LABELS[part]} recovered and ready to fit`;
    const location = part === "pitch" ? "search the cave" : "search the island";
    return `${REPAIR_LABELS[part]} missing; ${location}`;
  });
  addMessage(state, `Shipwright's tally: ${tally.join("; ")}.`);
}

export function getInteractionLabel(state: GameState): string {
  const player = captain(state);
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown") return "Descend cave";
  if (terrain === "stairsUp") return "Climb outside";
  if (isAtWreck(state)) {
    const part = nextRecoveredRepair(state);
    return part ? `Fit ${REPAIR_LABELS[part]}` : "Inspect wreck";
  }
  return "Inspect surroundings";
}

export function interact(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown" || terrain === "stairsUp") return useStairs(state);
  if (!isAtWreck(state)) {
    addMessage(state, "There is nothing here requiring the captain's personal attention.");
    return false;
  }

  const part = nextRecoveredRepair(state);
  if (!part) {
    inspectWreck(state);
    return false;
  }

  state.repairs[part] = true;
  addMessage(state, `You fit the ${REPAIR_LABELS[part]}. The ship looks incrementally less doomed.`);
  finishTurn(state);
  if (state.phase === "playing" && REPAIR_SEQUENCE.every((repair) => state.repairs[repair])) {
    state.phase = "won";
    addMessage(state, "The ship is seaworthy, in the broad and legally nonbinding sense. Victory!");
  }
  return true;
}

export function useStairs(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  const destinationLevel: LevelId | null = terrain === "stairsDown" ? "cave" : terrain === "stairsUp" ? "surface" : null;
  if (!destinationLevel) {
    addMessage(state, "There are no stairs here, only a mild change in elevation at best.");
    return false;
  }

  const destination = destinationLevel === "cave" ? state.caveExit : state.caveEntrance;
  const travellingActors = state.actors.filter(
    (actor) =>
      actor.alive &&
      actor.level === state.currentLevel &&
      (actor.kind === "captain" || actor.kind === "crew") &&
      (actor.kind === "captain" || state.crewOrder !== "hold"),
  );
  state.currentLevel = destinationLevel;
  const playerActor = travellingActors.find((actor) => actor.kind === "captain");
  if (!playerActor) throw new Error("The travelling party has misplaced its captain.");
  playerActor.level = destinationLevel;
  playerActor.x = destination.x;
  playerActor.y = destination.y;
  for (const actor of travellingActors.filter((candidate) => candidate.kind === "crew")) {
    actor.level = destinationLevel;
    const position = DIRECTIONS.map((direction) => ({
      x: destination.x + direction.x,
      y: destination.y + direction.y,
    })).find((point) => {
      const destinationMap = currentMap(state);
      const tile = destinationMap.tiles[tileIndex(point.x, point.y, destinationMap.width)];
      return tile && isPassableTerrain(tile.terrain) && !actorAt(state, point.x, point.y, actor.id);
    });
    actor.x = position?.x ?? destination.x;
    actor.y = position?.y ?? destination.y;
  }
  state.targetId = null;
  addMessage(
    state,
    destinationLevel === "cave"
      ? "You descend into the cave. It smells of damp stone, old bones, and poor decisions."
      : "You climb back into daylight with a renewed appreciation for sky.",
  );
  finishTurn(state);
  return true;
}

export function getCurrentMap(state: GameState): MapLevel {
  return currentMap(state);
}
