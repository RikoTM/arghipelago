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
export type LevelId = "surface" | "cave";
export type CrewOrder = "follow" | "hold" | "rally" | "attack";
export type GamePhase = "playing" | "won" | "lost";
export type Background = "privateer" | "navigator" | "surgeon";
export type Knack = "duelist" | "deadeye" | "lucky";
export type Coat = "crimson" | "navy" | "moss";
export type RepairPart = "mast" | "canvas" | "pitch";
export type PickupType = RepairPart | "ammo" | "salts";

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

export interface Actor extends Point {
  id: number;
  level: LevelId;
  kind: ActorKind;
  name: string;
  role?: string;
  enemyType?: EnemyType;
  hp: number;
  maxHp: number;
  melee: number;
  alive: boolean;
  incapacitatedTurns: number;
  alerted: boolean;
  alertTurns: number;
}

export interface Pickup extends Point {
  id: number;
  level: LevelId;
  type: PickupType;
  collected: boolean;
}

export interface Inventory {
  loaded: boolean;
  ammo: number;
  salts: number;
}

export interface GameState {
  version: 6;
  seed: string;
  rngState: number;
  levels: Record<LevelId, MapLevel>;
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
  crewOrder: CrewOrder;
  crewTargetId: number | null;
  inventory: Inventory;
  recoveredParts: Record<RepairPart, boolean>;
  repairs: Record<RepairPart, boolean>;
  captainConfig: CaptainConfig;
  messages: string[];
  phase: GamePhase;
  targetId: number | null;
}
