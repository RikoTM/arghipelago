export type Terrain =
  | "water"
  | "sand"
  | "grass"
  | "jungle"
  | "rock"
  | "wreck"
  | "caveWall"
  | "caveFloor"
  | "stairsDown"
  | "stairsUp";

export type ActorKind = "captain" | "crew" | "castaway" | "enemy";
export type EnemyType = "skeleton" | "crab" | "slag" | "bonegunner";
export type EnemyAttribute = "keenEared" | "ironclad" | "skirmishing" | "riposting";
export type EnemyAwarenessMode = "investigating" | "pursuing";
export type Faction = "party" | "boneCrew" | "shoreBrood" | "cinderkin" | "neutral";
export type LevelId = "surface" | "cave";
export type CrewOrder = "follow" | "hold" | "rally" | "attack";
export type CrewStance = "close" | "ranged" | "avoid";
export type CrewTrait = "smokeShy" | "powderShy" | "shipmate";
export type CrewReaction = "brace" | null;
export type GamePhase = "playing" | "won" | "lost";
export type WeatherPhase = "fair" | "squallWarning" | "rain";
export type Background = "privateer" | "navigator" | "surgeon";
export type Knack = "duelist" | "deadeye" | "lucky";
export type Coat = "crimson" | "navy" | "moss";
export type RepairPart = "mast" | "canvas" | "pitch";
export type MeleeWeapon = "cutlass" | "knife" | "boardingAxe";
export type RangedWeapon = "flintlock" | "pistol";
export type ArmorType = "leatherCoat" | "breastplate";
export type PickupType = RepairPart | MeleeWeapon | RangedWeapon | ArmorType | "ammo" | "salts";

export interface Point {
  x: number;
  y: number;
}

export interface Tile {
  terrain: Terrain;
  explored: boolean;
  visible: boolean;
}

export interface MapLevel {
  id: LevelId;
  width: number;
  height: number;
  tiles: Tile[];
}

export interface CaptainConfig {
  name: string;
  background: Background;
  knack: Knack;
  coat: Coat;
}

export interface EnemyAwareness {
  mode: EnemyAwarenessMode;
  targetId: number | null;
  lastKnownPosition: Point;
  expiresAtTurn: number;
}

export interface CrewAssignment {
  order: CrewOrder;
  targetId: number | null;
}

export interface Actor extends Point {
  id: number;
  level: LevelId;
  kind: ActorKind;
  name: string;
  role?: string;
  enemyType?: EnemyType;
  enemyAttribute: EnemyAttribute | null;
  crewTrait: CrewTrait | null;
  crewAssignment: CrewAssignment | null;
  crewStance: CrewStance | null;
  meleeWeapon: MeleeWeapon | null;
  rangedWeapon: RangedWeapon | null;
  rangedLoaded: boolean;
  armor: ArmorType | null;
  crewReaction: CrewReaction;
  reactionCooldownUntilTurn: number;
  stabilized: boolean;
  hp: number;
  maxHp: number;
  melee: number;
  alive: boolean;
  incapacitatedTurns: number;
  wetUntilTurn: number;
  enemyAwareness: EnemyAwareness | null;
}

export interface Pickup extends Point {
  id: number;
  level: LevelId;
  type: PickupType;
  collected: boolean;
  loaded: boolean;
}

export interface Inventory {
  ammo: number;
  salts: number;
}

export interface EnvironmentalTile extends Point {
  fireTurns: number;
  smokeTurns: number;
}

export interface SurfaceWeather {
  phase: WeatherPhase;
  transitionTurn: number;
  cycle: number;
}

export interface GameState {
  version: 19;
  seed: string;
  rngState: number;
  levels: Record<LevelId, MapLevel>;
  environment: Record<LevelId, EnvironmentalTile[]>;
  currentLevel: LevelId;
  actors: Actor[];
  pickups: Pickup[];
  captainId: number;
  wreck: Point;
  caveEntrance: Point;
  caveExit: Point;
  caveDiscovered: boolean;
  turn: number;
  threat: number;
  dangerLevel: number;
  lastEscalationTurn: number;
  surfaceWeather: SurfaceWeather;
  lastCrewOrder: CrewOrder;
  lastCrewStance: CrewStance;
  inventory: Inventory;
  recoveredParts: Record<RepairPart, boolean>;
  repairs: Record<RepairPart, boolean>;
  captainConfig: CaptainConfig;
  messages: string[];
  phase: GamePhase;
  targetId: number | null;
}
