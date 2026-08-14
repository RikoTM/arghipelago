import { coordinateNoise, Rng } from "./rng";
import type {
  Actor,
  ArmorType,
  CaptainConfig,
  CrewOrder,
  CrewStance,
  CrewTrait,
  EnemyAttribute,
  EnemyType,
  EnvironmentalTile,
  Faction,
  GameState,
  LevelId,
  MapLevel,
  MeleeWeapon,
  Pickup,
  PickupType,
  Point,
  RangedWeapon,
  RepairPart,
  Terrain,
  WeatherPhase,
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

const INCAPACITATION_TURNS = 10;
const INVESTIGATION_MEMORY = 8;
const PURSUIT_MEMORY = 10;
const FIRE_TURNS = 3;
const FIRE_SMOKE_TURNS = 5;
const FIRE_DAMAGE = 2;
const MUZZLE_SMOKE_TURNS = 3;
const RAIN_WET_TURNS = 2;
const DOUSE_WET_TURNS = 4;
const ATTENTION_ESCALATION_THRESHOLD = 10;
const ESCALATION_COOLDOWN_TURNS = 12;
const BASE_ESCALATION_INTERVAL = 60;
const MIN_ESCALATION_INTERVAL = 35;
const WAIT_ATTENTION = 2;
const REPAIR_RECOVERY_ATTENTION = 6;
const REPAIR_INSTALL_ATTENTION = 4;
const WRECK_RECOVERY_ATTENTION = 3;
const WRECK_RECOVERY_AMOUNT = 2;
const WRECK_RECOVERY_RADIUS = 2;
const WRECK_SAFETY_RADIUS = 6;
const AMMO_PER_POUCH = 4;
const SUPPLY_SLOT_CAPACITY = 4;

type SoundKind = "gunfire" | "slagBurst" | "command" | "distraction" | "fireSpread";

interface SoundEvent {
  kind: SoundKind;
  sourceActorId: number | null;
  level: LevelId;
  origin: Point;
  radius: number;
}

interface DamageSource {
  actor: Actor | null;
  label: string;
}

const SOUND_RADIUS: Record<SoundKind, number> = {
  gunfire: 10,
  slagBurst: 6,
  command: 6,
  distraction: 6,
  fireSpread: 3,
};

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
  flintlock: "a weathered flintlock",
  pistol: "a compact boarding pistol",
  cutlass: "a serviceable cutlass",
  knife: "a sharp rigging knife",
  boardingAxe: "a heavy boarding axe",
  leatherCoat: "a salt-stiffened leather coat",
  breastplate: "a battered steel breastplate",
};

const MELEE_WEAPON_DAMAGE: Record<MeleeWeapon, number> = {
  knife: 0,
  cutlass: 1,
  boardingAxe: 2,
};

const ARMOR_DEFENSE: Record<ArmorType, { melee: number; projectile: number }> = {
  leatherCoat: { melee: 1, projectile: 0 },
  breastplate: { melee: 1, projectile: 2 },
};

const CREW: Array<{
  name: string;
  role: string;
  melee: number;
  meleeWeapon: MeleeWeapon;
  rangedWeapon: RangedWeapon | null;
}> = [
  { name: "Peg-Less Pete", role: "Carpenter, despite the name", melee: 1, meleeWeapon: "cutlass", rangedWeapon: null },
  { name: "Dr. Marrow", role: "Surgeon and amateur anatomist", melee: 1, meleeWeapon: "knife", rangedWeapon: null },
  { name: "Anne Teak", role: "Gunner, furniture enthusiast", melee: 1, meleeWeapon: "cutlass", rangedWeapon: "pistol" },
];

const ENEMY_NAMES: Record<EnemyType, string[]> = {
  skeleton: ["Skeleton Deckhand", "Bony Bosun", "Undead Swabber"],
  crab: ["Indignant Crab", "Cutlass Crab", "Crab of Unusual Rank"],
  slag: ["Smouldering Slag", "Bilge Slag", "Sulky Slag"],
  bonegunner: ["Skeleton Fusilier", "Dead-Eye Dead Ned", "Powder-Dry Corpse"],
};

const ATTRIBUTE_NAMES: Record<EnemyAttribute, string> = {
  keenEared: "Keen-Eared",
  ironclad: "Ironclad",
  skirmishing: "Skirmishing",
  riposting: "Riposting",
};

const ATTRIBUTE_COMPATIBILITY: Record<EnemyAttribute, EnemyType[]> = {
  keenEared: ["skeleton", "slag", "bonegunner"],
  ironclad: ["skeleton", "crab", "slag", "bonegunner"],
  skirmishing: ["skeleton", "crab", "slag"],
  riposting: ["skeleton", "crab", "bonegunner"],
};

const ENEMY_ATTRIBUTES = Object.keys(ATTRIBUTE_NAMES) as EnemyAttribute[];

const RAIN_EXPOSED_TERRAIN: Terrain[] = ["sand", "grass", "trail", "spring", "ruins", "rock"];
const CREW_TRAITS: CrewTrait[] = ["smokeShy", "powderShy", "shipmate"];

export interface MapInspection {
  visibility: "unexplored" | "remembered" | "visible";
  terrain: Terrain | null;
  actors: Actor[];
  pickups: Pickup[];
  environment: EnvironmentalTile | null;
}

export interface RunSummary {
  phase: "won" | "lost";
  seed: string;
  turns: number;
  installedRepairs: number;
  recruitedCrew: number;
  survivingCrew: number;
  defeatedEnemies: number;
}

export function isEnemyConcealed(actor: Actor): boolean {
  return actor.kind === "enemy" && actor.enemyType === "crab" && actor.enemyAwareness === null;
}

export function isIncapacitated(actor: Actor): boolean {
  return actor.alive && actor.kind === "crew" && actor.incapacitatedTurns > 0;
}

export function getFaction(actor: Actor): Faction {
  if (actor.kind === "captain" || actor.kind === "crew") return "party";
  if (actor.kind !== "enemy") return "neutral";
  if (actor.enemyType === "crab") return "shoreBrood";
  if (actor.enemyType === "slag") return "cinderkin";
  return "boneCrew";
}

export function areActorsHostile(first: Actor, second: Actor): boolean {
  const firstFaction = getFaction(first);
  const secondFaction = getFaction(second);
  return firstFaction !== "neutral" && secondFaction !== "neutral" && firstFaction !== secondFaction;
}

export function isWet(state: GameState, actor: Actor): boolean {
  return actor.wetUntilTurn > state.turn;
}

export function getRunSummary(state: GameState): RunSummary | null {
  if (state.phase === "playing") return null;
  const recruitedCrew = state.actors.filter((actor) => actor.kind === "crew");
  return {
    phase: state.phase,
    seed: state.seed,
    turns: state.turn,
    installedRepairs: Object.values(state.repairs).filter(Boolean).length,
    recruitedCrew: recruitedCrew.length,
    survivingCrew: recruitedCrew.filter((actor) => actor.alive).length,
    defeatedEnemies: state.actors.filter((actor) => actor.kind === "enemy" && !actor.alive).length,
  };
}

function canAct(actor: Actor): boolean {
  return actor.alive && !isIncapacitated(actor);
}

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
      canAct(actor) && actor.level === state.currentLevel && actor.id !== ignoreId && actor.x === x && actor.y === y,
  );
}

function livingActorAt(state: GameState, x: number, y: number): Actor | undefined {
  return state.actors.find(
    (actor) => actor.alive && actor.level === state.currentLevel && actor.x === x && actor.y === y,
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

export function environmentAt(state: GameState, level: LevelId, point: Point): EnvironmentalTile | null {
  return state.environment[level].find((effect) => effect.x === point.x && effect.y === point.y) ?? null;
}

function addEnvironment(
  state: GameState,
  level: LevelId,
  point: Point,
  fireTurns: number,
  smokeTurns: number,
): EnvironmentalTile {
  const existing = environmentAt(state, level, point);
  if (existing) {
    existing.fireTurns = Math.max(existing.fireTurns, fireTurns);
    existing.smokeTurns = Math.max(existing.smokeTurns, smokeTurns);
    return existing;
  }
  const effect = { x: point.x, y: point.y, fireTurns, smokeTurns };
  state.environment[level].push(effect);
  const map = state.levels[level];
  state.environment[level].sort((a, b) => tileIndex(a.x, a.y, map.width) - tileIndex(b.x, b.y, map.width));
  return effect;
}

function smokeBlocksSight(state: GameState, point: Point): boolean {
  return (environmentAt(state, state.currentLevel, point)?.smokeTurns ?? 0) > 0;
}

function blocksSight(state: GameState, point: Point): boolean {
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(point.x, point.y, map.width)]?.terrain;
  return terrain === "jungle" || terrain === "rock" || terrain === "caveWall" || smokeBlocksSight(state, point);
}

export function hasLineOfSight(state: GameState, from: Point, to: Point): boolean {
  if (smokeBlocksSight(state, from) && distance(from, to) > 1) return false;
  const line = lineBetween(from, to);
  for (let index = 1; index < line.length - 1; index += 1) {
    const point = line[index];
    if (point && blocksSight(state, point)) return false;
  }
  return true;
}

function canSeeActor(state: GameState, observer: Point, target: Point): boolean {
  return hasLineOfSight(state, observer, target) && (!smokeBlocksSight(state, target) || distance(observer, target) <= 1);
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

export function inspectMapPoint(state: GameState, point: Point): MapInspection | null {
  const map = currentMap(state);
  if (!inBounds(point.x, point.y, map.width, map.height)) return null;
  const tile = map.tiles[tileIndex(point.x, point.y, map.width)];
  if (!tile?.explored) {
    return { visibility: "unexplored", terrain: null, actors: [], pickups: [], environment: null };
  }
  const visible = tile.visible;
  return {
    visibility: visible ? "visible" : "remembered",
    terrain: tile.terrain,
    environment: visible ? environmentAt(state, state.currentLevel, point) : null,
    actors: visible
      ? state.actors.filter(
          (actor) =>
            actor.alive &&
            actor.level === state.currentLevel &&
            !isEnemyConcealed(actor) &&
            actor.x === point.x &&
            actor.y === point.y &&
            (!smokeBlocksSight(state, point) || distance(captain(state), point) <= 1 || actor.kind === "captain"),
        )
      : [],
    pickups: state.pickups.filter(
      (pickup) =>
        !pickup.collected &&
        pickup.level === state.currentLevel &&
        pickup.x === point.x &&
        pickup.y === point.y &&
        (!smokeBlocksSight(state, point) || distance(captain(state), point) <= 1),
    ),
  };
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
    enemyAttribute: null,
    crewTrait: null,
    crewAssignment: null,
    crewStance: null,
    meleeWeapon: null,
    rangedWeapon: type === "bonegunner" ? "flintlock" : null,
    rangedLoaded: type === "bonegunner",
    armor: null,
    crewReaction: null,
    reactionCooldownUntilTurn: 0,
    stabilized: false,
    name: names[rng.int(names.length)] ?? "Unnamed Menace",
    x: point.x,
    y: point.y,
    hp: health,
    maxHp: health,
    melee,
    alive: true,
    incapacitatedTurns: 0,
    wetUntilTurn: 0,
    enemyAwareness: null,
  };
}

export function isAttributeCompatible(attribute: EnemyAttribute, type: EnemyType): boolean {
  return ATTRIBUTE_COMPATIBILITY[attribute].includes(type);
}

function assignEnemyAttribute(enemy: Actor, rng: Rng): void {
  if (enemy.kind !== "enemy" || !enemy.enemyType || enemy.enemyAttribute) return;
  const compatible = ENEMY_ATTRIBUTES.filter((attribute) => isAttributeCompatible(attribute, enemy.enemyType as EnemyType));
  const attribute = compatible[rng.int(compatible.length)];
  if (!attribute) return;
  enemy.enemyAttribute = attribute;
  enemy.name = `${ATTRIBUTE_NAMES[attribute]} ${enemy.name}`;
}

function assignInitialSpecials(seed: string, actors: Actor[], wreck: Point, caveExit: Point): void {
  const surfaceCandidates = actors
    .filter(
      (actor) =>
        actor.kind === "enemy" &&
        actor.level === "surface" &&
        distance(actor, wreck) > 12,
    )
    .sort((a, b) => a.id - b.id);
  const surfaceRng = new Rng(`${seed}:special:surface`);
  const surfaceEnemy = surfaceCandidates[surfaceRng.int(surfaceCandidates.length)];
  if (surfaceEnemy) assignEnemyAttribute(surfaceEnemy, surfaceRng);

  const caveEnemies = actors
    .filter((actor) => actor.kind === "enemy" && actor.level === "cave")
    .sort((a, b) => a.id - b.id);
  const distantCaveEnemies = caveEnemies.filter((actor) => distance(actor, caveExit) > 9);
  const caveCandidates = distantCaveEnemies.length > 0
    ? distantCaveEnemies
    : [...caveEnemies].sort((a, b) => distance(b, caveExit) - distance(a, caveExit) || a.id - b.id);
  const caveRng = new Rng(`${seed}:special:cave`);
  const caveEnemy = caveCandidates[caveRng.int(caveCandidates.length)];
  if (caveEnemy) assignEnemyAttribute(caveEnemy, caveRng);
}

function assignCrewTraits(seed: string, actors: Actor[]): void {
  const rng = new Rng(`${seed}:crew-traits:v1`);
  const traits = [...CREW_TRAITS];
  for (let index = traits.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.int(index + 1);
    const current = traits[index];
    const other = traits[swapIndex];
    if (current === undefined || other === undefined) continue;
    traits[index] = other;
    traits[swapIndex] = current;
  }
  const castaways = actors.filter((actor) => actor.kind === "castaway").sort((a, b) => a.id - b.id);
  for (const [index, castaway] of castaways.entries()) castaway.crewTrait = traits[index] ?? "shipmate";
}

export function createGame(config: CaptainConfig, seed: string): GameState {
  const island = generateIsland(seed);
  const cave = generateCave(seed);
  const rng = new Rng(island.rngState ^ cave.rngState);
  const privateerHealth = config.background === "privateer" ? 2 : 0;
  const landmarkIndices = new Set(Object.values(island.landmarks).map((point) => tileIndex(point.x, point.y, island.width)));
  const pool = island.reachable.filter(
    (point) =>
      distance(point, island.wreck) > 2 &&
      (point.x !== island.caveEntrance.x || point.y !== island.caveEntrance.y) &&
      !landmarkIndices.has(tileIndex(point.x, point.y, island.width)) &&
      island.tiles[tileIndex(point.x, point.y, island.width)]?.terrain !== "water",
  );
  const actors: Actor[] = [
    {
      id: 1,
      level: "surface",
      kind: "captain",
      enemyAttribute: null,
      crewTrait: null,
      crewAssignment: null,
      crewStance: null,
      meleeWeapon: "cutlass",
      rangedWeapon: "flintlock",
      rangedLoaded: true,
      armor: null,
      crewReaction: null,
      reactionCooldownUntilTurn: 0,
      stabilized: false,
      name: config.name,
      x: island.wreck.x,
      y: island.wreck.y,
      hp: 16 + privateerHealth,
      maxHp: 16 + privateerHealth,
      melee: 1,
      alive: true,
      incapacitatedTurns: 0,
      wetUntilTurn: 0,
      enemyAwareness: null,
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
      enemyAttribute: null,
      crewTrait: null,
      crewAssignment: null,
      crewStance: "close",
      meleeWeapon: recruit.meleeWeapon,
      rangedWeapon: recruit.rangedWeapon,
      rangedLoaded: recruit.rangedWeapon !== null,
      armor: null,
      crewReaction: null,
      reactionCooldownUntilTurn: 0,
      stabilized: false,
      name: recruit.name,
      role: recruit.role,
      x: point.x,
      y: point.y,
      hp: 8,
      maxHp: 8,
      melee: recruit.melee,
      alive: true,
      incapacitatedTurns: 0,
      wetUntilTurn: 0,
      enemyAwareness: null,
    });
    nextId += 1;
  }

  const pickupTypes: PickupType[] = ["mast", "canvas", "ammo", "ammo", "salts", "pistol", "boardingAxe", "leatherCoat"];
  for (const [index, type] of pickupTypes.entries()) {
    const minimumDistance = index < 2 ? 13 + index * 2 : 7;
    const point = takePlacement(pool, rng, (candidate) => distance(candidate, island.wreck) > minimumDistance);
    pickups.push({
      id: nextId,
      level: "surface",
      type,
      x: point.x,
      y: point.y,
      collected: false,
      loaded: type === "pistol" || type === "flintlock",
    });
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
  pickups.push({ id: nextId, level: "cave", type: "pitch", x: pitchPoint.x, y: pitchPoint.y, collected: false, loaded: false });
  nextId += 1;
  for (const type of ["ammo", "salts"] as const) {
    const point = takePlacement(cavePool, rng, (candidate) => distance(candidate, cave.exit) > 7);
    pickups.push({ id: nextId, level: "cave", type, x: point.x, y: point.y, collected: false, loaded: false });
    nextId += 1;
  }
  for (const type of ["skeleton", "skeleton", "slag", "slag", "bonegunner", "skeleton"] as const) {
    const point = takePlacement(cavePool, rng, (candidate) => distance(candidate, cave.exit) > 5);
    actors.push(makeEnemy(nextId, type, point, rng, "cave"));
    nextId += 1;
  }
  assignInitialSpecials(seed, actors, island.wreck, cave.exit);
  assignCrewTraits(seed, actors);

  const state: GameState = {
    version: 19,
    seed,
    rngState: rng.state,
    levels: {
      surface: mapLevel("surface", island.width, island.height, island.tiles),
      cave: mapLevel("cave", cave.width, cave.height, cave.tiles),
    },
    environment: { surface: [], cave: [] },
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
    lastEscalationTurn: 0,
    surfaceWeather: {
      phase: "fair",
      transitionTurn: 45 + new Rng(`${seed}:weather:0:fair`).int(20),
      cycle: 0,
    },
    lastCrewOrder: "follow",
    lastCrewStance: "close",
    inventory: { ammo: 6, salts: config.background === "surgeon" ? 2 : 1 },
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

function makeSound(kind: SoundKind, actor: Actor): SoundEvent {
  return {
    kind,
    sourceActorId: actor.id,
    level: actor.level,
    origin: { x: actor.x, y: actor.y },
    radius: SOUND_RADIUS[kind],
  };
}

function makeEnvironmentalSound(kind: SoundKind, level: LevelId, origin: Point): SoundEvent {
  return { kind, sourceActorId: null, level, origin: { ...origin }, radius: SOUND_RADIUS[kind] };
}

function addMuzzleSmoke(state: GameState, shooter: Actor): void {
  addEnvironment(state, shooter.level, shooter, 0, MUZZLE_SMOKE_TURNS + (shooter.level === "cave" ? 1 : 0));
}

function weatherDuration(seed: string, cycle: number, phase: WeatherPhase): number {
  const rng = new Rng(`${seed}:weather:${cycle}:${phase}`);
  if (phase === "squallWarning") return 3;
  if (phase === "rain") return 8 + rng.int(5);
  return 32 + rng.int(20);
}

function advanceWeather(state: GameState): void {
  if (state.turn < state.surfaceWeather.transitionTurn) return;
  const previous = state.surfaceWeather.phase;
  if (previous === "fair") state.surfaceWeather.phase = "squallWarning";
  else if (previous === "squallWarning") state.surfaceWeather.phase = "rain";
  else {
    state.surfaceWeather.phase = "fair";
    state.surfaceWeather.cycle += 1;
  }
  state.surfaceWeather.transitionTurn = state.turn + weatherDuration(
    state.seed,
    state.surfaceWeather.cycle,
    state.surfaceWeather.phase,
  );
  if (state.currentLevel === "surface") {
    const message = state.surfaceWeather.phase === "rain"
      ? "The squall breaks. Heavy rain hammers the island and drowns exposed flame."
      : state.surfaceWeather.phase === "squallWarning"
        ? "The wind turns cold and the horizon gathers an unreasonable amount of cloud."
        : "The rain passes, leaving the island steaming and offended.";
    addMessage(state, message);
  }
}

function applyRain(state: GameState): void {
  if (state.surfaceWeather.phase !== "rain") return;
  const surface = state.levels.surface;
  for (const actor of state.actors) {
    if (!actor.alive || actor.level !== "surface") continue;
    const terrain = surface.tiles[tileIndex(actor.x, actor.y, surface.width)]?.terrain;
    if (terrain && RAIN_EXPOSED_TERRAIN.includes(terrain)) {
      actor.wetUntilTurn = Math.max(actor.wetUntilTurn, state.turn + RAIN_WET_TURNS);
    }
  }
  state.environment.surface = [];
}

function livingActorAtLevel(state: GameState, level: LevelId, point: Point): Actor | undefined {
  return state.actors.find(
    (actor) => actor.alive && actor.level === level && actor.x === point.x && actor.y === point.y,
  );
}

function igniteFromSlag(state: GameState, slag: Actor): void {
  const smokeTurns = FIRE_SMOKE_TURNS + (slag.level === "cave" ? 1 : 0);
  if (slag.level === "surface" && state.surfaceWeather.phase === "rain") return;
  addEnvironment(state, slag.level, slag, 0, smokeTurns);
  const map = state.levels[slag.level];
  const candidates = DIRECTIONS.map((direction) => ({ x: slag.x + direction.x, y: slag.y + direction.y }))
    .filter((point) => {
      if (!inBounds(point.x, point.y, map.width, map.height) || livingActorAtLevel(state, slag.level, point)) return false;
      return map.tiles[tileIndex(point.x, point.y, map.width)]?.terrain === "jungle";
    })
    .sort((a, b) => {
      const noiseA = coordinateNoise(`${state.seed}:fire:${slag.level}:${slag.x}:${slag.y}`, a.x, a.y);
      const noiseB = coordinateNoise(`${state.seed}:fire:${slag.level}:${slag.x}:${slag.y}`, b.x, b.y);
      return noiseA - noiseB || tileIndex(a.x, a.y, map.width) - tileIndex(b.x, b.y, map.width);
    });
  const ignition = candidates[0];
  if (ignition) addEnvironment(state, slag.level, ignition, FIRE_TURNS, smokeTurns);
}

function nextEntityId(state: GameState): number {
  return Math.max(...state.actors.map((actor) => actor.id), ...state.pickups.map((pickup) => pickup.id)) + 1;
}

function addGroundPickup(
  state: GameState,
  level: LevelId,
  point: Point,
  type: PickupType,
  loaded = false,
): Pickup {
  const pickup: Pickup = {
    id: nextEntityId(state),
    level,
    type,
    x: point.x,
    y: point.y,
    collected: false,
    loaded,
  };
  state.pickups.push(pickup);
  return pickup;
}

function dropEnemyLoot(state: GameState, enemy: Actor): void {
  if (!enemy.enemyType || enemy.enemyType === "slag") return;
  const rng = new Rng(`${state.seed}:enemy-loot:v1:${enemy.id}:${enemy.enemyType}`);
  const drops: PickupType[] = [];
  if (enemy.enemyType === "bonegunner") {
    drops.push("flintlock");
    if (rng.chance(0.5)) drops.push("ammo");
  } else if (enemy.enemyType === "skeleton" && rng.chance(0.35)) {
    drops.push(rng.chance(0.5) ? "knife" : "cutlass");
  } else if (enemy.enemyType === "crab" && rng.chance(0.25)) {
    drops.push("salts");
  }
  if (enemy.enemyAttribute === "ironclad") drops.push("breastplate");
  if (drops.length === 0) return;
  for (const type of drops) addGroundPickup(state, enemy.level, enemy, type);
  addMessage(state, `${enemy.name} drops ${drops.map((type) => PICKUP_NAMES[type]).join(" and ")}.`);
}

function damageActor(
  state: GameState,
  target: Actor,
  amount: number,
  source: DamageSource,
  sounds: SoundEvent[],
): void {
  if (!target.alive || isIncapacitated(target)) return;
  target.hp -= amount;
  addMessage(state, `${source.label} hits ${target.name} for ${amount}.`);
  if (target.kind === "enemy" && target.hp > 0 && source.actor && areActorsHostile(target, source.actor)) {
    rememberTarget(state, target, source.actor);
  }
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
  } else if (target.kind === "crew") {
    target.alive = true;
    target.incapacitatedTurns = INCAPACITATION_TURNS + 1;
    target.stabilized = false;
    target.crewReaction = null;
    addMessage(state, `${target.name} is incapacitated. Smelling salts may yet settle the argument.`);
  } else {
    addMessage(state, `${target.name} is killed.`);
    if (target.id === state.targetId) state.targetId = null;
    if (target.kind === "enemy") dropEnemyLoot(state, target);
    if (target.kind === "enemy" && target.enemyType === "slag") {
      addMessage(state, `${target.name} bursts in a ring of furnace-hot embers.`);
      sounds.push(makeSound("slagBurst", target));
      igniteFromSlag(state, target);
      const burstDamage = isWet(state, target) ? 1 : 2;
      for (const actor of state.actors) {
        if (canAct(actor) && actor.level === target.level && distance(actor, target) <= 1) {
          const damage = Math.max(0, burstDamage - (isWet(state, actor) ? 1 : 0));
          if (damage > 0) damageActor(state, actor, damage, { actor: target, label: `${target.name}'s fiery collapse` }, sounds);
        }
      }
    }
  }
}

function terrainCover(state: GameState, target: Actor): number {
  const map = state.levels[target.level];
  const terrain = map.tiles[tileIndex(target.x, target.y, map.width)]?.terrain;
  return terrain === "jungle" || terrain === "rock" || terrain === "ruins" || terrain === "wreck" ? 1 : 0;
}

function armorName(armor: ArmorType): string {
  return armor === "leatherCoat" ? "leather coat" : "breastplate";
}

function physicalDamageAfterArmor(
  state: GameState,
  target: Actor,
  amount: number,
  kind: "melee" | "projectile",
): number {
  if (!target.armor) return Math.max(1, amount);
  const damage = Math.max(1, amount - ARMOR_DEFENSE[target.armor][kind]);
  if (damage < amount) {
    addMessage(state, `${target.name}'s ${armorName(target.armor)} absorbs ${amount - damage} damage.`);
  }
  return damage;
}

function projectileDamage(state: GameState, target: Actor, amount: number): number {
  const cover = terrainCover(state, target);
  if (cover > 0) addMessage(state, `${target.name}'s terrain cover absorbs part of the shot.`);
  return physicalDamageAfterArmor(state, target, Math.max(1, amount - cover), "projectile");
}

function hasFlankingAlly(state: GameState, attacker: Actor, target: Actor): boolean {
  const faction = getFaction(attacker);
  if (faction === "neutral") return false;
  const opposite = {
    x: target.x + target.x - attacker.x,
    y: target.y + target.y - attacker.y,
  };
  return state.actors.some(
    (actor) =>
      actor.id !== attacker.id &&
      actor.id !== target.id &&
      canAct(actor) &&
      actor.level === target.level &&
      getFaction(actor) === faction &&
      actor.x === opposite.x &&
      actor.y === opposite.y,
  );
}

function meleeAttack(state: GameState, attacker: Actor, target: Actor, rng: Rng, sounds: SoundEvent[]): void {
  const weaponDamage = attacker.meleeWeapon ? MELEE_WEAPON_DAMAGE[attacker.meleeWeapon] : 0;
  const base = attacker.melee + weaponDamage + rng.int(2);
  const duelistBonus = attacker.kind === "captain" && state.captainConfig.knack === "duelist" ? 1 : 0;
  const luckyBonus = attacker.kind === "captain" && state.captainConfig.knack === "lucky" && rng.chance(0.25) ? 1 : 0;
  const flankingBonus = hasFlankingAlly(state, attacker, target) ? 1 : 0;
  const damage = physicalDamageAfterArmor(state, target, base + duelistBonus + luckyBonus + flankingBonus, "melee");
  if (luckyBonus > 0) addMessage(state, "A fortunate wobble improves the captain's attack.");
  if (flankingBonus > 0) addMessage(state, `${attacker.name} flanks ${target.name} with an ally opposite.`);
  damageActor(state, target, damage, { actor: attacker, label: attacker.name }, sounds);
  if (
    target.alive &&
    target.kind === "enemy" &&
    target.enemyAttribute === "riposting" &&
    canAct(attacker) &&
    distance(attacker, target) <= 1
  ) {
    damageActor(state, attacker, 1, { actor: target, label: `${target.name}'s riposte` }, sounds);
  }
}

function isRangedWeaponPickup(type: PickupType): type is RangedWeapon {
  return type === "flintlock" || type === "pistol";
}

function isMeleeWeaponPickup(type: PickupType): type is MeleeWeapon {
  return type === "cutlass" || type === "knife" || type === "boardingAxe";
}

function isArmorPickup(type: PickupType): type is ArmorType {
  return type === "leatherCoat" || type === "breastplate";
}

export function getSupplyLoad(state: GameState): { used: number; capacity: number } {
  return {
    used: Math.ceil(state.inventory.ammo / AMMO_PER_POUCH) + state.inventory.salts,
    capacity: SUPPLY_SLOT_CAPACITY,
  };
}

function collectAtCaptain(state: GameState, reportBlocked = false): void {
  const player = captain(state);
  for (const pickup of state.pickups) {
    if (
      pickup.collected ||
      pickup.level !== state.currentLevel ||
      pickup.x !== player.x ||
      pickup.y !== player.y
    ) continue;
    if (isRangedWeaponPickup(pickup.type) || isMeleeWeaponPickup(pickup.type) || isArmorPickup(pickup.type)) continue;
    if ((pickup.type === "ammo" || pickup.type === "salts") && getSupplyLoad(state).used >= SUPPLY_SLOT_CAPACITY) {
      if (reportBlocked) addMessage(state, `The supply rack is full; ${PICKUP_NAMES[pickup.type]} remains here.`);
      continue;
    }
    pickup.collected = true;
    if (pickup.type === "ammo") state.inventory.ammo += AMMO_PER_POUCH;
    else if (pickup.type === "salts") state.inventory.salts += 1;
    else {
      state.recoveredParts[pickup.type] = true;
      state.threat += REPAIR_RECOVERY_ATTENTION;
    }
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
      actor.crewAssignment = { order: "follow", targetId: null, targetPosition: null };
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

function bestStepToward(
  state: GameState,
  actor: Actor,
  destination: Point,
  desiredDistance = 1,
): Point | null {
  if (distance(actor, destination) <= desiredDistance) return null;
  const map = currentMap(state);
  const frontier: Array<{ point: Point; firstStep: Point | null; cost: number }> = [
    { point: { x: actor.x, y: actor.y }, firstStep: null, cost: 0 },
  ];
  const bestCosts = new Map<number, number>([[tileIndex(actor.x, actor.y, map.width), 0]]);

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.point.y - b.point.y || a.point.x - b.point.x);
    const current = frontier.shift();
    if (!current) break;
    for (const direction of DIRECTIONS) {
      const point = { x: current.point.x + direction.x, y: current.point.y + direction.y };
      if (!inBounds(point.x, point.y, map.width, map.height)) continue;
      const index = tileIndex(point.x, point.y, map.width);
      const tile = map.tiles[index];
      if (!tile || !isPassableTerrain(tile.terrain) || actorAt(state, point.x, point.y, actor.id)) continue;
      const environment = environmentAt(state, state.currentLevel, point);
      const hazardCost = (environment?.smokeTurns ? 2 : 0) +
        (environment?.fireTurns && actor.enemyType !== "slag" ? 12 : 0);
      const cost = current.cost + 1 + hazardCost;
      if (cost >= (bestCosts.get(index) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(index, cost);
      const firstStep = current.firstStep ?? point;
      if (distance(point, destination) <= desiredDistance) return firstStep;
      frontier.push({ point, firstStep, cost });
    }
  }
  return null;
}

function bestStepAway(state: GameState, actor: Actor, threat: Point): Point | null {
  const map = currentMap(state);
  const currentDistance = distance(actor, threat);
  return DIRECTIONS.map((direction) => ({ x: actor.x + direction.x, y: actor.y + direction.y }))
    .filter((point) => {
      if (!inBounds(point.x, point.y, map.width, map.height) || distance(point, threat) <= currentDistance) return false;
      const tile = map.tiles[tileIndex(point.x, point.y, map.width)];
      return Boolean(tile && isPassableTerrain(tile.terrain) && !actorAt(state, point.x, point.y, actor.id));
    })
    .sort((a, b) => {
      const effectA = environmentAt(state, state.currentLevel, a);
      const effectB = environmentAt(state, state.currentLevel, b);
      const hazardA = (effectA?.smokeTurns ? 2 : 0) + (effectA?.fireTurns && actor.enemyType !== "slag" ? 12 : 0);
      const hazardB = (effectB?.smokeTurns ? 2 : 0) + (effectB?.fireTurns && actor.enemyType !== "slag" ? 12 : 0);
      return hazardA - hazardB || distance(b, threat) - distance(a, threat) || tileIndex(a.x, a.y, map.width) - tileIndex(b.x, b.y, map.width);
    })[0] ?? null;
}

function hazardScore(state: GameState, actor: Actor, point: Point): number {
  const effect = environmentAt(state, state.currentLevel, point);
  return (effect?.fireTurns && actor.enemyType !== "slag" ? 12 : 0) + (effect?.smokeTurns ? 2 : 0);
}

function smokeShyStep(state: GameState, crew: Actor): Point | null {
  if (crew.crewTrait !== "smokeShy" || isWet(state, crew) || crew.reactionCooldownUntilTurn > state.turn) return null;
  const currentHazard = hazardScore(state, crew, crew);
  const adjacentHazard = DIRECTIONS.some((direction) =>
    hazardScore(state, crew, { x: crew.x + direction.x, y: crew.y + direction.y }) > 0,
  );
  if (currentHazard === 0 && !adjacentHazard) return null;
  const player = captain(state);
  const map = currentMap(state);
  return DIRECTIONS.map((direction) => ({ x: crew.x + direction.x, y: crew.y + direction.y }))
    .filter((point) => {
      if (!inBounds(point.x, point.y, map.width, map.height)) return false;
      const tile = map.tiles[tileIndex(point.x, point.y, map.width)];
      return Boolean(tile && isPassableTerrain(tile.terrain) && !actorAt(state, point.x, point.y, crew.id));
    })
    .sort((a, b) =>
      hazardScore(state, crew, a) - hazardScore(state, crew, b) ||
      distance(a, player) - distance(b, player) ||
      tileIndex(a.x, a.y, map.width) - tileIndex(b.x, b.y, map.width),
    )[0] ?? null;
}

function aidCrew(state: GameState, crew: Actor, order: CrewOrder): boolean {
  if (crew.crewTrait !== "shipmate" && !crew.role?.startsWith("Surgeon")) return false;
  const casualty = state.actors
    .filter(
      (actor) =>
        isIncapacitated(actor) &&
        actor.level === state.currentLevel &&
        !actor.stabilized &&
        (order !== "hold" || distance(crew, actor) <= 1),
    )
    .sort((a, b) => a.incapacitatedTurns - b.incapacitatedTurns || a.id - b.id)[0];
  if (!casualty) return false;
  if (distance(crew, casualty) <= 1) {
    const extension = crew.role?.startsWith("Surgeon") ? 2 : 1;
    casualty.incapacitatedTurns = Math.min(INCAPACITATION_TURNS, casualty.incapacitatedTurns + extension + 1);
    casualty.stabilized = true;
    addMessage(state, `${crew.name} stabilizes ${casualty.name}, buying ${extension} more rescue turn${extension === 1 ? "" : "s"}.`);
  } else {
    const step = bestStepToward(state, crew, casualty);
    if (step) tryMoveActor(state, crew, step.x, step.y);
    addMessage(state, `${crew.name} moves to aid ${casualty.name}.`);
  }
  return true;
}

function isCrewGunner(actor: Actor): boolean {
  return actor.kind === "crew" && Boolean(actor.role?.startsWith("Gunner"));
}

function isArmedCrew(actor: Actor): boolean {
  return actor.kind === "crew" && actor.rangedWeapon !== null;
}

function rangedWeaponName(weapon: RangedWeapon): string {
  return weapon === "flintlock" ? "flintlock" : "pistol";
}

function meleeWeaponName(weapon: MeleeWeapon): string {
  return weapon === "boardingAxe" ? "boarding axe" : weapon;
}

function nonHostileActorInLineOfFire(state: GameState, shooter: Actor, target: Actor): Actor | null {
  const line = lineBetween(shooter, target).slice(1, -1);
  return state.actors.find(
    (actor) =>
      actor.id !== shooter.id &&
      actor.alive &&
      actor.level === shooter.level &&
      !areActorsHostile(shooter, actor) &&
      line.some((point) => point.x === actor.x && point.y === actor.y),
  ) ?? null;
}

function useCrewFirearm(
  state: GameState,
  crew: Actor,
  target: Actor,
  rng: Rng,
  sounds: SoundEvent[],
): boolean {
  if (!isArmedCrew(crew) || !crew.rangedWeapon) return false;
  const weapon = rangedWeaponName(crew.rangedWeapon);
  if (distance(crew, target) <= 1) {
    const retreat = bestStepAway(state, crew, target);
    if (!retreat) return false;
    tryMoveActor(state, crew, retreat.x, retreat.y);
    addMessage(state, `${crew.name} backs away to make room for a shot.`);
    return true;
  }
  if (!crew.rangedLoaded) {
    if (isWet(state, crew)) {
      addMessage(state, `${crew.name}'s powder is too damp to reload.`);
      return true;
    }
    if (state.inventory.ammo <= 0) {
      addMessage(state, `${crew.name} has an empty ${weapon} and no shot to reload it.`);
      return true;
    }
    state.inventory.ammo -= 1;
    crew.rangedLoaded = true;
    addMessage(state, `${crew.name} reloads a ${weapon} from the party's shot supply.`);
    return true;
  }
  if (distance(crew, target) > 6 || !canSeeActor(state, crew, target)) return false;
  const interveningActor = nonHostileActorInLineOfFire(state, crew, target);
  if (interveningActor) {
    addMessage(state, `${crew.name} holds fire with ${interveningActor.name} in the way.`);
    return true;
  }
  if (isWet(state, crew)) {
    addMessage(state, `${crew.name}'s ${weapon} is too damp to use.`);
    return true;
  }

  crew.rangedLoaded = false;
  sounds.push(makeSound("gunfire", crew));
  addMuzzleSmoke(state, crew);
  addMessage(state, `${crew.name} fires a ${weapon} at ${target.name}.`);
  const accuracy = isCrewGunner(crew) ? 0.85 : 0.68;
  if (rng.chance(accuracy)) {
    const rolledDamage = 3 + rng.int(3);
    const armoredDamage = target.enemyAttribute === "ironclad" ? Math.max(1, rolledDamage - 2) : rolledDamage;
    if (target.enemyAttribute === "ironclad") addMessage(state, `${target.name}'s iron plating absorbs part of the shot.`);
    const damage = projectileDamage(state, target, armoredDamage);
    damageActor(state, target, damage, { actor: crew, label: crew.name }, sounds);
  } else {
    addMessage(state, `${crew.name} fires wide of ${target.name}.`);
  }
  return true;
}

function runCrewTurns(state: GameState, rng: Rng, sounds: SoundEvent[]): void {
  const player = captain(state);
  for (const crew of state.actors.filter(
    (actor) => canAct(actor) && actor.level === state.currentLevel && actor.kind === "crew",
  )) {
    const assignment = crew.crewAssignment ?? { order: "follow" as const, targetId: null, targetPosition: null };
    const stance = crew.crewStance ?? "close";
    let order = assignment.order;
    let orderedTarget = order === "attack"
      ? state.actors.find(
          (actor) =>
            actor.id === assignment.targetId &&
            actor.alive &&
            actor.level === state.currentLevel &&
            actor.kind === "enemy",
        )
      : undefined;
    if (order === "attack" && !orderedTarget) {
      crew.crewAssignment = { order: "follow", targetId: null, targetPosition: null };
      order = "follow";
      addMessage(state, `${crew.name}'s target is no longer available. ${crew.name} resumes following.`);
    }
    if (order === "rally") crew.crewReaction = null;
    if (crew.crewReaction === "brace") {
      crew.crewReaction = null;
      crew.reactionCooldownUntilTurn = state.turn + 2;
      addMessage(state, `${crew.name} loses the moment to a powder-shy flinch.`);
      continue;
    }
    const withdrawal = smokeShyStep(state, crew);
    if (withdrawal && hazardScore(state, crew, withdrawal) < Math.max(1, hazardScore(state, crew, crew))) {
      tryMoveActor(state, crew, withdrawal.x, withdrawal.y);
      crew.reactionCooldownUntilTurn = state.turn + 2;
      addMessage(state, `${crew.name} withdraws from fire and smoke.`);
      continue;
    }
    if (aidCrew(state, crew, order)) continue;
    if (orderedTarget?.alive) {
      if (stance === "ranged" && useCrewFirearm(state, crew, orderedTarget, rng, sounds)) {
        if (!orderedTarget.alive) {
          crew.crewAssignment = { order: "follow", targetId: null, targetPosition: null };
          addMessage(state, `${orderedTarget.name} is down. ${crew.name} resumes following.`);
        }
        continue;
      }
      if (distance(crew, orderedTarget) <= 1) meleeAttack(state, crew, orderedTarget, rng, sounds);
      else {
        const desiredDistance = stance === "ranged" && isArmedCrew(crew) && canSeeActor(state, crew, orderedTarget)
          ? 5
          : 1;
        const step = bestStepToward(state, crew, orderedTarget, desiredDistance);
        if (step) tryMoveActor(state, crew, step.x, step.y);
      }
      if (!orderedTarget.alive) {
        crew.crewAssignment = { order: "follow", targetId: null, targetPosition: null };
        addMessage(state, `${orderedTarget.name} is down. ${crew.name} resumes following.`);
      }
      continue;
    }
    const adjacentEnemy = state.actors.find(
      (actor) =>
        actor.alive && actor.level === state.currentLevel && actor.kind === "enemy" && distance(crew, actor) <= 1,
    );
    if (adjacentEnemy && order !== "rally") {
      if (stance === "avoid" || stance === "ranged" && isArmedCrew(crew)) {
        const retreat = bestStepAway(state, crew, adjacentEnemy);
        if (retreat) tryMoveActor(state, crew, retreat.x, retreat.y);
        continue;
      }
      meleeAttack(state, crew, adjacentEnemy, rng, sounds);
      continue;
    }
    if (order === "hold") continue;
    const destination = order === "rally" ? assignment.targetPosition ?? player : player;
    const desiredDistance = order === "rally" ? 1 : 2;
    if (distance(crew, destination) > desiredDistance) {
      const step = bestStepToward(state, crew, destination, desiredDistance);
      if (step) tryMoveActor(state, crew, step.x, step.y);
    }
  }
}

function canEnemyAcquire(enemy: Actor, target: Actor): boolean {
  if (!canAct(target) || target.level !== enemy.level || !areActorsHostile(enemy, target)) return false;
  if (target.kind === "enemy" && isEnemyConcealed(target)) return false;
  if (target.kind === "enemy" && enemy.enemyAwareness === null && target.enemyAwareness === null) return false;
  return true;
}

function seenHostileTarget(state: GameState, enemy: Actor): Actor | null {
  const detectionRange = enemy.enemyType === "bonegunner" ? 7 : enemy.enemyType === "crab" ? 2 : 5;
  const candidates = state.actors.filter(
    (actor) =>
      canEnemyAcquire(enemy, actor) &&
      distance(enemy, actor) <= detectionRange &&
      canSeeActor(state, enemy, actor),
  );
  const remembered = candidates.find((actor) => actor.id === enemy.enemyAwareness?.targetId);
  return remembered ?? candidates.sort((a, b) => distance(enemy, a) - distance(enemy, b) || a.id - b.id)[0] ?? null;
}

function rememberTarget(state: GameState, enemy: Actor, target: Actor): void {
  enemy.enemyAwareness = {
    mode: "pursuing",
    targetId: target.id,
    lastKnownPosition: { x: target.x, y: target.y },
    expiresAtTurn: state.turn + PURSUIT_MEMORY,
  };
}

function expireEnemyAwareness(state: GameState): void {
  for (const enemy of state.actors) {
    if (enemy.kind === "enemy" && enemy.enemyAwareness && state.turn >= enemy.enemyAwareness.expiresAtTurn) {
      enemy.enemyAwareness = null;
    }
  }
}

function soundReaches(state: GameState, sound: SoundEvent, listener: Actor): boolean {
  const map = state.levels[sound.level];
  const rainPenalty = sound.level === "surface" && state.surfaceWeather.phase === "rain" ? 2 : 0;
  const budget = Math.max(0, sound.radius + (listener.enemyAttribute === "keenEared" ? 3 : 0) - rainPenalty);
  const frontier: Array<{ point: Point; cost: number }> = [{ point: sound.origin, cost: 0 }];
  const bestCosts = new Map<number, number>([[tileIndex(sound.origin.x, sound.origin.y, map.width), 0]]);

  while (frontier.length > 0) {
    frontier.sort((a, b) => a.cost - b.cost || a.point.y - b.point.y || a.point.x - b.point.x);
    const current = frontier.shift();
    if (!current || current.cost > budget) break;
    if (current.point.x === listener.x && current.point.y === listener.y) return true;
    for (const direction of DIRECTIONS) {
      const point = { x: current.point.x + direction.x, y: current.point.y + direction.y };
      if (!inBounds(point.x, point.y, map.width, map.height)) continue;
      const terrain = map.tiles[tileIndex(point.x, point.y, map.width)]?.terrain;
      if (!terrain || terrain === "caveWall") continue;
      const cost = current.cost + (terrain === "jungle" || terrain === "rock" ? 2 : 1);
      const index = tileIndex(point.x, point.y, map.width);
      if (cost > budget || cost >= (bestCosts.get(index) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(index, cost);
      frontier.push({ point, cost });
    }
  }
  return false;
}

function triggerCrewReactions(state: GameState, sound: SoundEvent): void {
  if (sound.kind !== "gunfire" && sound.kind !== "slagBurst") return;
  const source = sound.sourceActorId === null
    ? null
    : state.actors.find((actor) => actor.id === sound.sourceActorId) ?? null;
  for (const crew of state.actors) {
    if (
      !canAct(crew) ||
      crew.kind !== "crew" ||
      crew.level !== sound.level ||
      crew.crewTrait !== "powderShy" ||
      crew.reactionCooldownUntilTurn > state.turn ||
      !soundReaches(state, sound, crew)
    ) continue;
    const trainedForFriendlyFire = sound.kind === "gunfire" && source && getFaction(source) === "party" && isCrewGunner(crew);
    if (trainedForFriendlyFire) continue;
    crew.crewReaction = "brace";
    addMessage(state, `${crew.name} braces at the ${sound.kind === "slagBurst" ? "slag's blast" : "gunshot"}.`);
  }
}

function resolveSounds(state: GameState, sounds: SoundEvent[]): void {
  for (const sound of sounds) {
    state.threat += sound.radius;
    triggerCrewReactions(state, sound);
    for (const enemy of state.actors) {
      if (
        !enemy.alive ||
        enemy.kind !== "enemy" ||
        enemy.id === sound.sourceActorId ||
        enemy.level !== sound.level ||
        !soundReaches(state, sound, enemy)
      ) continue;
      const seen = enemy.level === state.currentLevel ? seenHostileTarget(state, enemy) : null;
      if (seen) rememberTarget(state, enemy, seen);
      else {
        const source = sound.sourceActorId === null
          ? null
          : state.actors.find((actor) => actor.id === sound.sourceActorId) ?? null;
        const hostileSource = source && areActorsHostile(enemy, source) ? source : null;
        if (enemy.enemyAwareness?.mode === "pursuing" && !hostileSource) continue;
        enemy.enemyAwareness = {
          mode: "investigating",
          targetId: hostileSource?.id ?? null,
          lastKnownPosition: { ...sound.origin },
          expiresAtTurn: state.turn + INVESTIGATION_MEMORY,
        };
      }
    }
  }
  sounds.length = 0;
}

function fireSpreadCandidate(state: GameState, source: EnvironmentalTile): Point | null {
  const map = currentMap(state);
  const candidates = DIRECTIONS.map((direction) => ({ x: source.x + direction.x, y: source.y + direction.y }))
    .filter((point) => {
      if (!inBounds(point.x, point.y, map.width, map.height) || livingActorAtLevel(state, state.currentLevel, point)) return false;
      return map.tiles[tileIndex(point.x, point.y, map.width)]?.terrain === "jungle" &&
        (environmentAt(state, state.currentLevel, point)?.fireTurns ?? 0) === 0;
    })
    .sort((a, b) => {
      const noiseA = coordinateNoise(`${state.seed}:fire:${state.currentLevel}:${source.x}:${source.y}`, a.x, a.y);
      const noiseB = coordinateNoise(`${state.seed}:fire:${state.currentLevel}:${source.x}:${source.y}`, b.x, b.y);
      return noiseA - noiseB || tileIndex(a.x, a.y, map.width) - tileIndex(b.x, b.y, map.width);
    });
  return candidates[0] ?? null;
}

function resolveEnvironment(state: GameState, sounds: SoundEvent[]): void {
  const level = state.currentLevel;
  const map = currentMap(state);
  const effects = state.environment[level];
  const spreadSources = effects.filter((effect) => effect.fireTurns === 2);
  const newFires: Point[] = [];
  for (const source of spreadSources) {
    const candidate = fireSpreadCandidate(state, source);
    if (candidate) newFires.push(candidate);
  }

  for (const effect of effects) {
    if (effect.fireTurns > 0) {
      for (const actor of state.actors) {
        if (
          canAct(actor) &&
          actor.level === level &&
          actor.enemyType !== "slag" &&
          actor.x === effect.x &&
          actor.y === effect.y
        ) {
          const damage = isWet(state, actor) ? FIRE_DAMAGE - 1 : FIRE_DAMAGE;
          if (damage > 0) damageActor(state, actor, damage, { actor: null, label: "The fire" }, sounds);
        }
      }
      effect.fireTurns -= 1;
      if (effect.fireTurns === 0) {
        const tile = map.tiles[tileIndex(effect.x, effect.y, map.width)];
        if (tile?.terrain === "jungle") tile.terrain = "grass";
      }
    }
    if (effect.smokeTurns > 0) effect.smokeTurns -= 1;
  }

  for (const point of newFires) {
    const smokeTurns = FIRE_SMOKE_TURNS + (level === "cave" ? 1 : 0);
    addEnvironment(state, level, point, FIRE_TURNS, smokeTurns);
    sounds.push(makeEnvironmentalSound("fireSpread", level, point));
  }
  state.environment[level] = effects.filter((effect) => effect.fireTurns > 0 || effect.smokeTurns > 0);
}

function runEnemyTurns(state: GameState, rng: Rng, sounds: SoundEvent[]): void {

  for (const enemy of state.actors.filter(
    (actor) => actor.alive && actor.level === state.currentLevel && actor.kind === "enemy",
  )) {
    const target = seenHostileTarget(state, enemy);
    if (target) rememberTarget(state, enemy, target);
    const awareness = enemy.enemyAwareness;
    if (!awareness) continue;

    if (enemy.enemyType === "bonegunner" && enemy.rangedWeapon && !enemy.rangedLoaded && !isWet(state, enemy)) {
      enemy.rangedLoaded = true;
      addMessage(state, `${enemy.name} reloads a flintlock.`);
      continue;
    }

    if (!target) {
      const destinationOccupied = Boolean(actorAt(
        state,
        awareness.lastKnownPosition.x,
        awareness.lastKnownPosition.y,
        enemy.id,
      ));
      const step = bestStepToward(state, enemy, awareness.lastKnownPosition, destinationOccupied ? 1 : 0);
      if (step) tryMoveActor(state, enemy, step.x, step.y);
      continue;
    }

    if (enemy.enemyType === "bonegunner" && !isWet(state, enemy) && distance(enemy, target) <= 2) {
      const retreat = bestStepAway(state, enemy, target);
      if (retreat) {
        tryMoveActor(state, enemy, retreat.x, retreat.y);
        continue;
      }
    }

    if (distance(enemy, target) <= 1) {
      meleeAttack(state, enemy, target, rng, sounds);
      if (state.phase !== "playing") return;
      if (enemy.alive && enemy.enemyAttribute === "skirmishing") {
        const retreat = bestStepAway(state, enemy, target);
        if (retreat) tryMoveActor(state, enemy, retreat.x, retreat.y);
      }
      continue;
    }

    if (
      enemy.enemyType === "bonegunner" &&
      enemy.rangedWeapon &&
      enemy.rangedLoaded &&
      !isWet(state, enemy) &&
      distance(enemy, target) <= 5 &&
      hasLineOfSight(state, enemy, target)
    ) {
      enemy.rangedLoaded = false;
      sounds.push(makeSound("gunfire", enemy));
      addMuzzleSmoke(state, enemy);
      if (rng.chance(0.65)) {
        const damage = projectileDamage(state, target, 2);
        damageActor(state, target, damage, { actor: enemy, label: enemy.name }, sounds);
      }
      else addMessage(state, `${enemy.name} fires. A nearby tree is gravely inconvenienced.`);
      if (state.phase !== "playing") return;
      continue;
    }

    const step = bestStepToward(state, enemy, target);
    if (step) tryMoveActor(state, enemy, step.x, step.y);
  }
}

function spawnEscalation(state: GameState, rng: Rng): void {
  const turnsSinceEscalation = state.turn - state.lastEscalationTurn;
  const interval = Math.max(MIN_ESCALATION_INTERVAL, BASE_ESCALATION_INTERVAL - state.dangerLevel * 5);
  const attentionTriggered =
    state.threat >= ATTENTION_ESCALATION_THRESHOLD && turnsSinceEscalation >= ESCALATION_COOLDOWN_TURNS;
  const timeTriggered = turnsSinceEscalation >= interval;
  if (!attentionTriggered && !timeTriggered) return;
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
        !livingActorAt(state, x, y) &&
        distance(player, { x, y }) > 9
      ) {
        candidates.push({ x, y });
      }
    }
  }
  const point = candidates[rng.int(candidates.length)];
  if (!point) return;
  state.dangerLevel += 1;
  state.lastEscalationTurn = state.turn;
  if (attentionTriggered) state.threat = Math.max(0, state.threat - ATTENTION_ESCALATION_THRESHOLD);
  addMessage(
    state,
    attentionTriggered
      ? state.currentLevel === "cave"
        ? "Your recent racket draws something from deeper in the cave."
        : "Your recent activity draws an unwelcome answer from the jungle."
      : state.currentLevel === "cave"
        ? "Something deeper in the cave has noticed how long this is taking."
        : "Something in the jungle has noticed how long this is taking.",
  );
  const types: EnemyType[] = state.currentLevel === "cave"
    ? ["skeleton", "slag", "bonegunner"]
    : ["skeleton", "crab", "slag", "bonegunner"];
  const type = types[rng.int(types.length)] ?? "skeleton";
  const nextId = nextEntityId(state);
  const enemy = makeEnemy(nextId, type, point, rng, state.currentLevel);
  const specialRng = new Rng(`${state.seed}:special:${state.currentLevel}:${state.dangerLevel}:${enemy.id}`);
  if (specialRng.int(8) === 0) assignEnemyAttribute(enemy, specialRng);
  state.actors.push(enemy);
}

function finishTurn(state: GameState, sounds: SoundEvent[] = []): void {
  if (state.phase !== "playing") return;
  const rng = new Rng(state.rngState);
  state.turn += 1;
  state.threat = Math.max(0, state.threat - 1);
  advanceWeather(state);
  applyRain(state);
  expireEnemyAwareness(state);
  resolveSounds(state, sounds);
  runCrewTurns(state, rng, sounds);
  resolveSounds(state, sounds);
  runEnemyTurns(state, rng, sounds);
  resolveSounds(state, sounds);
  resolveEnvironment(state, sounds);
  resolveSounds(state, sounds);
  spawnEscalation(state, rng);
  state.rngState = rng.state;
  if (state.phase === "playing") {
    collectAtCaptain(state);
    recruitNearby(state);
  }
  for (const crew of state.actors.filter(isIncapacitated)) {
    crew.incapacitatedTurns -= 1;
    if (crew.incapacitatedTurns === 0) {
      crew.alive = false;
      addMessage(state, `${crew.name} dies before the crew can revive them.`);
    }
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
      if (isEnemyConcealed(occupant)) {
        rememberTarget(state, occupant, player);
        addMessage(state, `${occupant.name} erupts from the sand in a storm of claws.`);
        finishTurn(state);
        return true;
      }
      const rng = new Rng(state.rngState);
      const sounds: SoundEvent[] = [];
      meleeAttack(state, player, occupant, rng, sounds);
      state.rngState = rng.state;
      finishTurn(state, sounds);
      return true;
    }
    if (occupant.kind === "castaway") {
      recruitNearby(state);
      const previous = { x: player.x, y: player.y };
      player.x = occupant.x;
      player.y = occupant.y;
      occupant.x = previous.x;
      occupant.y = previous.y;
      collectAtCaptain(state, true);
      finishTurn(state);
      return true;
    }
    if (occupant.kind === "crew") {
      const previous = { x: player.x, y: player.y };
      player.x = occupant.x;
      player.y = occupant.y;
      occupant.x = previous.x;
      occupant.y = previous.y;
      collectAtCaptain(state, true);
      finishTurn(state);
      return true;
    }
    addMessage(state, `${occupant.name} politely occupies that particular bit of island.`);
    return false;
  }

  player.x = x;
  player.y = y;
  collectAtCaptain(state, true);
  recruitNearby(state);
  finishTurn(state);
  return true;
}

export function waitTurn(state: GameState): void {
  if (state.phase !== "playing") return;
  addMessage(state, "You wait with professional intensity.");
  state.threat += WAIT_ATTENTION;
  finishTurn(state);
}

export function reloadFlintlock(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  if (!player.rangedWeapon) {
    addMessage(state, "The captain has no firearm to reload. Check whichever crewmate looked trustworthy.");
    return false;
  }
  const weapon = rangedWeaponName(player.rangedWeapon);
  if (player.rangedLoaded) {
    addMessage(state, `The ${weapon} is already loaded. Overachieving here would be unwise.`);
    return false;
  }
  if (isWet(state, player)) {
    addMessage(state, "The captain's powder and hands are too wet to reload safely.");
    return false;
  }
  if (state.inventory.ammo <= 0) {
    addMessage(state, "You possess no powder or shot, only confidence.");
    return false;
  }
  state.inventory.ammo -= 1;
  player.rangedLoaded = true;
  addMessage(state, `You reload the ${weapon}. Nothing explodes prematurely.`);
  finishTurn(state);
  return true;
}

function nearbyCrewForEquipment(state: GameState): Actor[] {
  const player = captain(state);
  return state.actors
    .filter(
      (actor) => actor.kind === "crew" && actor.level === state.currentLevel && distance(player, actor) <= 1,
    )
    .sort((a, b) => a.id - b.id);
}

export function getFirearmTransferLabel(state: GameState): string {
  const player = captain(state);
  const nearbyCrew = nearbyCrewForEquipment(state);
  if (player.rangedWeapon) {
    const recipient = nearbyCrew.find((actor) => canAct(actor) && actor.rangedWeapon === null);
    return recipient ? `Pass ${rangedWeaponName(player.rangedWeapon)} to ${recipient.name}` : "No firearm trade";
  }
  const donor = nearbyCrew.find((actor) => actor.rangedWeapon !== null);
  return donor?.rangedWeapon ? `Retrieve ${rangedWeaponName(donor.rangedWeapon)} from ${donor.name}` : "No firearm trade";
}

export function transferFirearm(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const nearbyCrew = nearbyCrewForEquipment(state);

  if (player.rangedWeapon) {
    const recipient = nearbyCrew.find((actor) => canAct(actor) && actor.rangedWeapon === null);
    if (!recipient) {
      addMessage(state, "No adjacent active crewmate has a free hand for the captain's firearm.");
      return false;
    }
    const weapon = player.rangedWeapon;
    recipient.rangedWeapon = weapon;
    recipient.rangedLoaded = player.rangedLoaded;
    player.rangedWeapon = null;
    player.rangedLoaded = false;
    addMessage(state, `${player.name} passes the ${rangedWeaponName(weapon)} to ${recipient.name}.`);
    finishTurn(state);
    return true;
  }

  const donor = nearbyCrew.find((actor) => actor.rangedWeapon !== null);
  if (!donor?.rangedWeapon) {
    addMessage(state, "No adjacent crewmate has a firearm for the captain to retrieve.");
    return false;
  }
  const weapon = donor.rangedWeapon;
  player.rangedWeapon = weapon;
  player.rangedLoaded = donor.rangedLoaded;
  donor.rangedWeapon = null;
  donor.rangedLoaded = false;
  addMessage(
    state,
    donor.alive
      ? `${donor.name} returns the ${rangedWeaponName(weapon)} to ${player.name}.`
      : `${player.name} recovers the ${rangedWeaponName(weapon)} from ${donor.name}.`,
  );
  finishTurn(state);
  return true;
}

function meleeTransferTarget(state: GameState): Actor | null {
  const player = captain(state);
  const nearbyCrew = nearbyCrewForEquipment(state);
  if (!player.meleeWeapon) return nearbyCrew.find((actor) => actor.meleeWeapon !== null) ?? null;
  const activeCrew = nearbyCrew.filter(canAct);
  return activeCrew.find((actor) => actor.meleeWeapon === null) ??
    activeCrew.find((actor) => actor.meleeWeapon !== player.meleeWeapon) ??
    null;
}

export function getMeleeTransferLabel(state: GameState): string {
  const player = captain(state);
  const crew = meleeTransferTarget(state);
  if (!crew) return "No blade trade";
  if (!player.meleeWeapon) {
    return crew.meleeWeapon ? `Retrieve ${meleeWeaponName(crew.meleeWeapon)} from ${crew.name}` : "No blade trade";
  }
  if (!crew.meleeWeapon) return `Pass ${meleeWeaponName(player.meleeWeapon)} to ${crew.name}`;
  return `Swap for ${meleeWeaponName(crew.meleeWeapon)} with ${crew.name}`;
}

export function transferMeleeWeapon(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const crew = meleeTransferTarget(state);
  if (!crew) {
    addMessage(state, "No adjacent crewmate has a useful melee weapon trade.");
    return false;
  }

  if (!player.meleeWeapon) {
    const weapon = crew.meleeWeapon;
    if (!weapon) return false;
    player.meleeWeapon = weapon;
    crew.meleeWeapon = null;
    addMessage(
      state,
      crew.alive
        ? `${crew.name} hands the ${meleeWeaponName(weapon)} to ${player.name}.`
        : `${player.name} recovers the ${meleeWeaponName(weapon)} from ${crew.name}.`,
    );
    finishTurn(state);
    return true;
  }

  const captainWeapon = player.meleeWeapon;
  const crewWeapon = crew.meleeWeapon;
  crew.meleeWeapon = captainWeapon;
  player.meleeWeapon = crewWeapon;
  addMessage(
    state,
    crewWeapon
      ? `${player.name} swaps the ${meleeWeaponName(captainWeapon)} for ${crew.name}'s ${meleeWeaponName(crewWeapon)}.`
      : `${player.name} passes the ${meleeWeaponName(captainWeapon)} to ${crew.name}.`,
  );
  finishTurn(state);
  return true;
}

function armorTransferTarget(state: GameState): Actor | null {
  const player = captain(state);
  const nearbyCrew = nearbyCrewForEquipment(state);
  if (!player.armor) return nearbyCrew.find((actor) => actor.armor !== null) ?? null;
  const activeCrew = nearbyCrew.filter(canAct);
  return activeCrew.find((actor) => actor.armor === null) ??
    activeCrew.find((actor) => actor.armor !== player.armor) ??
    null;
}

export function getArmorTransferLabel(state: GameState): string {
  const player = captain(state);
  const crew = armorTransferTarget(state);
  if (!crew) return "No armor trade";
  if (!player.armor) return crew.armor ? `Retrieve ${armorName(crew.armor)} from ${crew.name}` : "No armor trade";
  if (!crew.armor) return `Pass ${armorName(player.armor)} to ${crew.name}`;
  return `Swap for ${armorName(crew.armor)} with ${crew.name}`;
}

export function transferArmor(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const crew = armorTransferTarget(state);
  if (!crew) {
    addMessage(state, "No adjacent crewmate has a useful armor trade.");
    return false;
  }
  if (!player.armor) {
    const armor = crew.armor;
    if (!armor) return false;
    player.armor = armor;
    crew.armor = null;
    addMessage(
      state,
      crew.alive
        ? `${crew.name} hands the ${armorName(armor)} to ${player.name}.`
        : `${player.name} recovers the ${armorName(armor)} from ${crew.name}.`,
    );
    finishTurn(state);
    return true;
  }

  const captainArmor = player.armor;
  const crewArmor = crew.armor;
  crew.armor = captainArmor;
  player.armor = crewArmor;
  addMessage(
    state,
    crewArmor
      ? `${player.name} swaps the ${armorName(captainArmor)} for ${crew.name}'s ${armorName(crewArmor)}.`
      : `${player.name} passes the ${armorName(captainArmor)} to ${crew.name}.`,
  );
  finishTurn(state);
  return true;
}

function groundFirearmAtCaptain(state: GameState): Pickup | null {
  const player = captain(state);
  return state.pickups.find(
    (pickup) =>
      !pickup.collected &&
      pickup.level === state.currentLevel &&
      pickup.x === player.x &&
      pickup.y === player.y &&
      isRangedWeaponPickup(pickup.type),
  ) ?? null;
}

function groundMeleeWeaponAtCaptain(state: GameState): Pickup | null {
  const player = captain(state);
  return state.pickups.find(
    (pickup) =>
      !pickup.collected &&
      pickup.level === state.currentLevel &&
      pickup.x === player.x &&
      pickup.y === player.y &&
      isMeleeWeaponPickup(pickup.type),
  ) ?? null;
}

function groundArmorAtCaptain(state: GameState): Pickup | null {
  const player = captain(state);
  return state.pickups.find(
    (pickup) =>
      !pickup.collected &&
      pickup.level === state.currentLevel &&
      pickup.x === player.x &&
      pickup.y === player.y &&
      isArmorPickup(pickup.type),
  ) ?? null;
}

function groundEquipmentForCaptain(state: GameState): Pickup | null {
  const player = captain(state);
  const meleeWeapon = groundMeleeWeaponAtCaptain(state);
  const firearm = groundFirearmAtCaptain(state);
  const armor = groundArmorAtCaptain(state);
  if (!player.meleeWeapon && meleeWeapon) return meleeWeapon;
  if (!player.rangedWeapon && firearm) return firearm;
  if (!player.armor && armor) return armor;
  return firearm ?? meleeWeapon ?? armor;
}

export function dropFirearm(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  if (!player.rangedWeapon) {
    addMessage(state, "The captain has no firearm to drop.");
    return false;
  }
  if (groundFirearmAtCaptain(state)) {
    addMessage(state, "There is already a firearm here. Even pirates should avoid that sort of pile.");
    return false;
  }
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown" || terrain === "stairsUp") {
    addMessage(state, "Dropping a firearm on the stairs would make both navigation and dignity hazardous.");
    return false;
  }
  const weapon = player.rangedWeapon;
  addGroundPickup(state, state.currentLevel, player, weapon, player.rangedLoaded);
  player.rangedWeapon = null;
  player.rangedLoaded = false;
  addMessage(state, `${player.name} leaves the ${rangedWeaponName(weapon)} on the ground.`);
  finishTurn(state);
  return true;
}

export function dropMeleeWeapon(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  if (!player.meleeWeapon) {
    addMessage(state, "The captain has no melee weapon to drop.");
    return false;
  }
  if (groundMeleeWeaponAtCaptain(state)) {
    addMessage(state, "There is already a melee weapon here. The island needs fewer blade piles.");
    return false;
  }
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown" || terrain === "stairsUp") {
    addMessage(state, "Leaving a blade on the stairs would violate several practical traditions.");
    return false;
  }
  const weapon = player.meleeWeapon;
  addGroundPickup(state, state.currentLevel, player, weapon);
  player.meleeWeapon = null;
  addMessage(state, `${player.name} leaves the ${meleeWeaponName(weapon)} on the ground.`);
  finishTurn(state);
  return true;
}

export function dropArmor(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  if (!player.armor) {
    addMessage(state, "The captain has no armor to drop.");
    return false;
  }
  if (groundArmorAtCaptain(state)) {
    addMessage(state, "There is already armor here. This is not a wardrobe.");
    return false;
  }
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown" || terrain === "stairsUp") {
    addMessage(state, "Armor on the stairs would become architecture.");
    return false;
  }
  const armor = player.armor;
  addGroundPickup(state, state.currentLevel, player, armor);
  player.armor = null;
  addMessage(state, `${player.name} leaves the ${armorName(armor)} on the ground.`);
  finishTurn(state);
  return true;
}

export function useSmellingSalts(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const rescue = state.actors
    .filter(
      (actor) => isIncapacitated(actor) && actor.level === state.currentLevel && distance(player, actor) <= 1,
    )
    .sort((a, b) => a.incapacitatedTurns - b.incapacitatedTurns || a.id - b.id)[0];
  if (rescue) {
    if (state.inventory.salts <= 0) {
      addMessage(state, `${rescue.name} needs smelling salts, and the bottle is regrettably empty.`);
      return false;
    }
    const healing = state.captainConfig.background === "surgeon" ? 5 : 3;
    state.inventory.salts -= 1;
    rescue.hp = healing;
    rescue.incapacitatedTurns = 0;
    addMessage(state, `${rescue.name} returns to duty with ${healing} vigor and a profound dislike of medicine.`);
    finishTurn(state);
    return true;
  }
  if (player.hp >= player.maxHp) {
    addMessage(state, "The captain is already offensively vigorous.");
    return false;
  }
  if (state.inventory.salts <= 0) {
    addMessage(state, "There are no smelling salts left, only the memory of alarming odors.");
    return false;
  }

  const healing = state.captainConfig.background === "surgeon" ? 6 : 4;
  const recovered = Math.min(healing, player.maxHp - player.hp);
  state.inventory.salts -= 1;
  player.hp += recovered;
  addMessage(state, `The smelling salts restore ${recovered} vigor and several regrettable memories.`);
  finishTurn(state);
  return true;
}

export function visibleEnemies(state: GameState): Actor[] {
  const player = captain(state);
  const map = currentMap(state);
  return state.actors
    .filter((actor) => {
      const tile = map.tiles[tileIndex(actor.x, actor.y, map.width)];
      return actor.alive &&
        actor.level === state.currentLevel &&
        actor.kind === "enemy" &&
        !isEnemyConcealed(actor) &&
        tile?.visible &&
        (!smokeBlocksSight(state, actor) || distance(player, actor) <= 1) &&
        distance(player, actor) <= 8;
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
  if (!player.rangedWeapon) {
    addMessage(state, "The captain has no firearm. Retrieve one from an adjacent crewmate.");
    return false;
  }
  const weapon = rangedWeaponName(player.rangedWeapon);
  if (isWet(state, player)) {
    addMessage(state, `The ${weapon} is too damp to fire. Find shelter and let the powder dry.`);
    return false;
  }
  let target = state.actors.find(
    (actor) =>
      actor.id === state.targetId &&
      actor.alive &&
      actor.level === state.currentLevel &&
      actor.kind === "enemy" &&
      !isEnemyConcealed(actor),
  );
  if (!target) target = visibleEnemies(state)[0];
  if (!target || distance(player, target) > 8 || !canSeeActor(state, player, target)) {
    addMessage(state, "No clear target presents itself.");
    return false;
  }
  if (!player.rangedLoaded) {
    addMessage(state, `The ${weapon} clicks with devastating sarcasm. Reload it.`);
    return false;
  }

  const interveningActor = nonHostileActorInLineOfFire(state, player, target);
  if (interveningActor) {
    addMessage(state, `${interveningActor.name} is in the line of fire and would prefer not to be.`);
    return false;
  }

  const rng = new Rng(state.rngState);
  const sounds = [makeSound("gunfire", player)];
  addMuzzleSmoke(state, player);
  player.rangedLoaded = false;
  const accuracy = state.captainConfig.knack === "deadeye" ? 0.95 : state.captainConfig.knack === "lucky" ? 0.85 : 0.78;
  if (rng.chance(accuracy)) {
    const rolledDamage = 5 + rng.int(3);
    const armoredDamage = target.enemyAttribute === "ironclad" ? Math.max(1, rolledDamage - 2) : rolledDamage;
    if (target.enemyAttribute === "ironclad") addMessage(state, `${target.name}'s iron plating absorbs part of the shot.`);
    const damage = projectileDamage(state, target, armoredDamage);
    damageActor(state, target, damage, { actor: player, label: player.name }, sounds);
  } else {
    addMessage(state, `${player.name} fires and decisively defeats some foliage.`);
  }
  state.rngState = rng.state;
  finishTurn(state, sounds);
  return true;
}

export function firePitchShot(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  if (!player.rangedWeapon) {
    addMessage(state, "The captain needs a firearm before attempting incendiary ammunition.");
    return false;
  }
  if (isWet(state, player)) {
    addMessage(state, "Wet powder refuses to launch even an exceptionally flammable idea.");
    return false;
  }
  if (!state.recoveredParts.pitch) {
    addMessage(state, "You need the pitch barrel before attempting incendiary ammunition.");
    return false;
  }
  const target = state.actors.find(
    (actor) =>
      actor.id === state.targetId &&
      actor.alive &&
      actor.level === state.currentLevel &&
      actor.kind === "enemy" &&
      !isEnemyConcealed(actor),
  );
  if (!target || distance(player, target) > 6 || !canSeeActor(state, player, target)) {
    addMessage(state, "No clear target is close enough for a pitch-soaked shot.");
    return false;
  }
  if (!player.rangedLoaded) {
    addMessage(state, `The ${rangedWeaponName(player.rangedWeapon)} must be loaded before adding inadvisable amounts of pitch.`);
    return false;
  }
  const interveningActor = nonHostileActorInLineOfFire(state, player, target);
  if (interveningActor) {
    addMessage(state, `${interveningActor.name} objects strongly to being between the captain and a burning projectile.`);
    return false;
  }

  const sounds = [makeSound("gunfire", player)];
  player.rangedLoaded = false;
  addMuzzleSmoke(state, player);
  const damage = projectileDamage(state, target, 2);
  damageActor(state, target, damage, { actor: player, label: `${player.name}'s pitch shot` }, sounds);
  const smokeTurns = FIRE_SMOKE_TURNS + (state.currentLevel === "cave" ? 1 : 0);
  if (state.currentLevel !== "surface" || state.surfaceWeather.phase !== "rain") {
    addEnvironment(state, state.currentLevel, target, FIRE_TURNS, smokeTurns);
    addMessage(state, `${target.name}'s position catches fire.`);
  } else {
    addMessage(state, "The heavy rain smothers the pitch before it can spread.");
  }
  finishTurn(state, sounds);
  return true;
}

const ORDER_SEQUENCE: CrewOrder[] = ["follow", "hold", "rally"];
const STANCE_SEQUENCE: CrewStance[] = ["close", "ranged", "avoid"];

function commandRecipients(state: GameState, sound: SoundEvent): Actor[] {
  return state.actors.filter(
    (actor) =>
      canAct(actor) &&
      actor.level === state.currentLevel &&
      actor.kind === "crew" &&
      soundReaches(state, sound, actor),
  );
}

export function cycleCrewOrder(state: GameState): CrewOrder {
  const crewCount = state.actors.filter(
    (actor) => canAct(actor) && actor.level === state.currentLevel && actor.kind === "crew",
  ).length;
  if (crewCount === 0) {
    addMessage(state, "You issue a crisp order to nobody in particular.");
    return state.lastCrewOrder;
  }
  const index = ORDER_SEQUENCE.indexOf(state.lastCrewOrder);
  const order = ORDER_SEQUENCE[(index + 1) % ORDER_SEQUENCE.length] ?? "follow";
  const sound = makeSound("command", captain(state));
  const recipients = commandRecipients(state, sound);
  const rallyPosition = order === "rally" ? { x: sound.origin.x, y: sound.origin.y } : null;
  for (const crew of recipients) {
    crew.crewAssignment = { order, targetId: null, targetPosition: rallyPosition ? { ...rallyPosition } : null };
  }
  state.lastCrewOrder = order;
  const destination = rallyPosition ? ` at ${rallyPosition.x},${rallyPosition.y}` : "";
  addMessage(state, `Crew order: ${order}${destination}. ${recipients.length} of ${crewCount} crewmates hear it.`);
  finishTurn(state, [sound]);
  return order;
}

export function commandCrewRally(state: GameState, target: Point): boolean {
  if (state.phase !== "playing") return false;
  const crewCount = state.actors.filter(
    (actor) => canAct(actor) && actor.level === state.currentLevel && actor.kind === "crew",
  ).length;
  if (crewCount === 0) {
    addMessage(state, "There is no crew here to receive a rally order.");
    return false;
  }
  const map = currentMap(state);
  const tile = inBounds(target.x, target.y, map.width, map.height)
    ? map.tiles[tileIndex(target.x, target.y, map.width)]
    : null;
  if (!tile?.explored || !isPassableTerrain(tile.terrain)) {
    addMessage(state, "Choose a known, passable tile before ordering a rally.");
    return false;
  }
  if (environmentAt(state, state.currentLevel, target)?.fireTurns) {
    addMessage(state, "The crew declines to rally in active fire.");
    return false;
  }
  const hostile = state.actors.find(
    (actor) =>
      canAct(actor) &&
      actor.level === state.currentLevel &&
      actor.kind === "enemy" &&
      !isEnemyConcealed(actor) &&
      actor.x === target.x &&
      actor.y === target.y &&
      tile.visible,
  );
  if (hostile) {
    addMessage(state, `${hostile.name} currently occupies that rally point.`);
    return false;
  }
  const sound = makeSound("command", captain(state));
  const recipients = commandRecipients(state, sound);
  for (const crew of recipients) {
    crew.crewAssignment = { order: "rally", targetId: null, targetPosition: { x: target.x, y: target.y } };
  }
  state.lastCrewOrder = "rally";
  addMessage(state, `Crew rally: ${target.x},${target.y}. ${recipients.length} of ${crewCount} crewmates hear it.`);
  finishTurn(state, [sound]);
  return true;
}

export function cycleCrewStance(state: GameState): CrewStance {
  const crewCount = state.actors.filter(
    (actor) => canAct(actor) && actor.level === state.currentLevel && actor.kind === "crew",
  ).length;
  if (crewCount === 0) {
    addMessage(state, "You announce a tactical stance to an audience of palm trees.");
    return state.lastCrewStance;
  }
  const index = STANCE_SEQUENCE.indexOf(state.lastCrewStance);
  const stance = STANCE_SEQUENCE[(index + 1) % STANCE_SEQUENCE.length] ?? "close";
  const sound = makeSound("command", captain(state));
  const recipients = commandRecipients(state, sound);
  for (const crew of recipients) crew.crewStance = stance;
  state.lastCrewStance = stance;
  const armedCount = recipients.filter(isArmedCrew).length;
  const detail = stance === "ranged"
    ? ` ${armedCount} armed crewmate${armedCount === 1 ? "" : "s"} ready ${armedCount === 1 ? "a firearm" : "their firearms"}.`
    : "";
  addMessage(state, `Crew stance: ${stance}. ${recipients.length} of ${crewCount} crewmates hear it.${detail}`);
  finishTurn(state, [sound]);
  return stance;
}

export function commandCrewAttack(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const crewCount = state.actors.filter(
    (actor) => canAct(actor) && actor.level === state.currentLevel && actor.kind === "crew",
  ).length;
  if (crewCount === 0) {
    addMessage(state, "There is no crew here to receive an attack order.");
    return false;
  }
  const map = currentMap(state);
  const target = state.actors.find((actor) => {
    if (
      actor.id !== state.targetId ||
      !actor.alive ||
      actor.level !== state.currentLevel ||
      actor.kind !== "enemy" ||
      isEnemyConcealed(actor)
    ) return false;
    return map.tiles[tileIndex(actor.x, actor.y, map.width)]?.visible && canSeeActor(state, captain(state), actor);
  });
  if (!target) {
    addMessage(state, "Select a visible enemy before ordering the crew to attack.");
    return false;
  }

  const sound = makeSound("command", captain(state));
  const recipients = commandRecipients(state, sound);
  for (const crew of recipients) crew.crewAssignment = { order: "attack", targetId: target.id, targetPosition: null };
  state.lastCrewOrder = "attack";
  addMessage(state, `Crew order: attack ${target.name}. ${recipients.length} of ${crewCount} crewmates hear it.`);
  finishTurn(state, [sound]);
  return true;
}

export function makeDistraction(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  addMessage(state, "You bellow a calculated insult. The noise carries across the island.");
  finishTurn(state, [makeSound("distraction", player)]);
  return true;
}

export function throwStone(state: GameState, target: Point): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const map = currentMap(state);
  const tile = map.tiles[tileIndex(target.x, target.y, map.width)];
  if (
    !inBounds(target.x, target.y, map.width, map.height) ||
    !tile?.visible ||
    distance(player, target) > 6 ||
    !hasLineOfSight(state, player, target)
  ) {
    addMessage(state, "That tile is too far, unseen, or blocked for a reliable throw.");
    return false;
  }
  addMessage(state, `A thrown stone clatters at ${target.x},${target.y}.`);
  const sound: SoundEvent = {
    kind: "distraction",
    sourceActorId: null,
    level: state.currentLevel,
    origin: { ...target },
    radius: 4,
  };
  finishTurn(state, [sound]);
  return true;
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

function isAtSurf(state: GameState): boolean {
  if (state.currentLevel !== "surface") return false;
  const player = captain(state);
  const map = currentMap(state);
  if (map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain !== "sand") return false;
  return [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
    if (dx === undefined || dy === undefined) return false;
    return map.tiles[tileIndex(player.x + dx, player.y + dy, map.width)]?.terrain === "water";
  });
}

function douseParty(state: GameState, source: "spring" | "surf"): void {
  const player = captain(state);
  for (const actor of state.actors) {
    if (
      actor.alive &&
      actor.level === state.currentLevel &&
      (actor.kind === "captain" || actor.kind === "crew") &&
      distance(player, actor) <= 1
    ) {
      actor.wetUntilTurn = Math.max(actor.wetUntilTurn, state.turn + DOUSE_WET_TURNS + 1);
    }
  }
  addMessage(
    state,
    source === "spring"
      ? "The party washes in the freshwater spring. Fire seems less concerning; powder seems more so."
      : "The party douses itself in the surf. Fire seems less concerning; powder seems more so.",
  );
  finishTurn(state);
}

function inspectWreck(state: GameState): void {
  const tally = REPAIR_SEQUENCE.map((part) => {
    if (state.repairs[part]) return `${REPAIR_LABELS[part]} installed`;
    if (state.recoveredParts[part]) return `${REPAIR_LABELS[part]} recovered and ready to fit`;
    const location = part === "pitch" ? "search the cave" : "search the island";
    return `${REPAIR_LABELS[part]} missing; ${location}`;
  });
  addMessage(state, `Shipwright's tally: ${tally.join("; ")}. Clear nearby threats to recover vigor here.`);
}

function wreckRecoveryTargets(state: GameState): Actor[] {
  return state.actors.filter(
    (actor) =>
      canAct(actor) &&
      actor.level === "surface" &&
      (actor.kind === "captain" || actor.kind === "crew") &&
      distance(actor, state.wreck) <= WRECK_RECOVERY_RADIUS &&
      actor.hp < actor.maxHp,
  );
}

function nearbyWreckThreat(state: GameState): Actor | null {
  const player = captain(state);
  return state.actors.find(
    (actor) =>
      canAct(actor) &&
      actor.level === "surface" &&
      actor.kind === "enemy" &&
      areActorsHostile(player, actor) &&
      distance(actor, state.wreck) <= WRECK_SAFETY_RADIUS,
  ) ?? null;
}

function recoverAtWreck(state: GameState, targets: Actor[]): boolean {
  const threat = nearbyWreckThreat(state);
  if (threat) {
    addMessage(state, `The wreck is no refuge while ${threat.name} prowls nearby.`);
    return false;
  }
  const recoveries = targets.map((actor) => {
    const amount = Math.min(WRECK_RECOVERY_AMOUNT, actor.maxHp - actor.hp);
    actor.hp += amount;
    return `${actor.name} recovers ${amount}`;
  });
  state.threat += WRECK_RECOVERY_ATTENTION;
  addMessage(state, `The party tends its wounds beneath the wreck's shelter. ${recoveries.join("; ")} vigor.`);
  finishTurn(state);
  return true;
}

export function getInteractionLabel(state: GameState): string {
  const player = captain(state);
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown") return "Descend cave";
  if (terrain === "stairsUp") return "Climb outside";
  const groundEquipment = groundEquipmentForCaptain(state);
  if (groundEquipment && isRangedWeaponPickup(groundEquipment.type)) {
    return `Pick up ${rangedWeaponName(groundEquipment.type)}`;
  }
  if (groundEquipment && isMeleeWeaponPickup(groundEquipment.type)) {
    return `Pick up ${meleeWeaponName(groundEquipment.type)}`;
  }
  if (groundEquipment && isArmorPickup(groundEquipment.type)) {
    return `Pick up ${armorName(groundEquipment.type)}`;
  }
  if (terrain === "spring") return "Wash at spring";
  if (terrain === "ruins") return "Inspect signal ruins";
  if (isAtWreck(state)) {
    const part = nextRecoveredRepair(state);
    if (part) return `Fit ${REPAIR_LABELS[part]}`;
    const recoveryTargets = wreckRecoveryTargets(state);
    if (recoveryTargets.length > 0) return nearbyWreckThreat(state) ? "Wreck unsafe" : "Recover at wreck";
    return "Inspect wreck";
  }
  if (isAtSurf(state)) return "Douse in surf";
  return "Inspect map";
}

export function interact(state: GameState): boolean {
  if (state.phase !== "playing") return false;
  const player = captain(state);
  const map = currentMap(state);
  const terrain = map.tiles[tileIndex(player.x, player.y, map.width)]?.terrain;
  if (terrain === "stairsDown" || terrain === "stairsUp") return useStairs(state);
  const groundEquipment = groundEquipmentForCaptain(state);
  if (groundEquipment && isRangedWeaponPickup(groundEquipment.type)) {
    if (player.rangedWeapon) {
      addMessage(state, `Drop or pass the captain's ${rangedWeaponName(player.rangedWeapon)} before picking up another firearm.`);
      return false;
    }
    player.rangedWeapon = groundEquipment.type;
    player.rangedLoaded = groundEquipment.loaded;
    groundEquipment.collected = true;
    addMessage(state, `${player.name} picks up ${PICKUP_NAMES[groundEquipment.type]}.`);
    finishTurn(state);
    return true;
  }
  if (groundEquipment && isMeleeWeaponPickup(groundEquipment.type)) {
    if (player.meleeWeapon) {
      addMessage(state, `Drop the captain's ${meleeWeaponName(player.meleeWeapon)} before picking up another melee weapon.`);
      return false;
    }
    player.meleeWeapon = groundEquipment.type;
    groundEquipment.collected = true;
    addMessage(state, `${player.name} picks up ${PICKUP_NAMES[groundEquipment.type]}.`);
    finishTurn(state);
    return true;
  }
  if (groundEquipment && isArmorPickup(groundEquipment.type)) {
    if (player.armor) {
      addMessage(state, `Drop or pass the captain's ${armorName(player.armor)} before picking up other armor.`);
      return false;
    }
    player.armor = groundEquipment.type;
    groundEquipment.collected = true;
    addMessage(state, `${player.name} puts on ${PICKUP_NAMES[groundEquipment.type]}.`);
    finishTurn(state);
    return true;
  }
  if (terrain === "spring") {
    douseParty(state, "spring");
    return true;
  }
  if (terrain === "ruins") {
    addMessage(
      state,
      `The old signal ruins still command the skyline. The wreck lies ${directionFrom(player, state.wreck)}; the cave lies ${directionFrom(player, state.caveEntrance)}.`,
    );
    return false;
  }
  if (isAtSurf(state)) {
    douseParty(state, "surf");
    return true;
  }
  if (!isAtWreck(state)) {
    addMessage(state, "There is nothing here requiring the captain's personal attention.");
    return false;
  }

  const part = nextRecoveredRepair(state);
  if (!part) {
    const recoveryTargets = wreckRecoveryTargets(state);
    if (recoveryTargets.length > 0) return recoverAtWreck(state, recoveryTargets);
    inspectWreck(state);
    return false;
  }

  state.repairs[part] = true;
  state.threat += REPAIR_INSTALL_ATTENTION;
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
      !isIncapacitated(actor) &&
      (actor.kind === "captain" || actor.crewAssignment?.order !== "hold"),
  );
  state.currentLevel = destinationLevel;
  const playerActor = travellingActors.find((actor) => actor.kind === "captain");
  if (!playerActor) throw new Error("The travelling party has misplaced its captain.");
  playerActor.level = destinationLevel;
  playerActor.x = destination.x;
  playerActor.y = destination.y;
  for (const actor of travellingActors.filter((candidate) => candidate.kind === "crew")) {
    if (actor.crewAssignment?.order === "rally") {
      actor.crewAssignment = { order: "follow", targetId: null, targetPosition: null };
    }
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
