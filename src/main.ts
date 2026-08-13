import "./style.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/pirata-one/400.css";
import "@fontsource/special-elite/400.css";
import {
  commandCrewAttack,
  createGame,
  cycleCrewOrder,
  cycleTarget,
  fireFlintlock,
  firePitchShot,
  getCaptain,
  getCurrentMap,
  getFaction,
  getInteractionLabel,
  getRunSummary,
  inspectMapPoint,
  interact,
  isIncapacitated,
  isWet,
  makeDistraction,
  moveCaptain,
  reloadFlintlock,
  useStairs,
  useSmellingSalts,
  waitTurn,
} from "./game/game";
import type { MapInspection } from "./game/game";
import type {
  Background,
  CaptainConfig,
  Coat,
  EnemyAttribute,
  EnemyType,
  GameState,
  Knack,
  LevelId,
  Point,
  RepairPart,
  Terrain,
} from "./game/types";
import { createRenderer, getMapCamera, moveInspectionCursor, worldPointFromClient } from "./render";

const SAVE_KEY = "arghipelago.active-run.v11";

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

const setupScreen = requireElement<HTMLElement>("#setup-screen");
const gameScreen = requireElement<HTMLElement>("#game-screen");
const form = requireElement<HTMLFormElement>("#captain-form");
const continueButton = requireElement<HTMLButtonElement>("#continue-button");
const newRunButton = requireElement<HTMLButtonElement>("#new-run-button");
const canvas = requireElement<HTMLCanvasElement>("#game-map");
const captainHeading = requireElement<HTMLElement>("#captain-heading");
const captainStats = requireElement<HTMLElement>("#captain-stats");
const turnCount = requireElement<HTMLElement>("#turn-count");
const dangerLevel = requireElement<HTMLElement>("#danger-level");
const repairList = requireElement<HTMLElement>("#repair-list");
const crewList = requireElement<HTMLElement>("#crew-list");
const crewOrder = requireElement<HTMLElement>("#crew-order");
const messageLog = requireElement<HTMLElement>("#message-log");
const phaseBanner = requireElement<HTMLElement>("#phase-banner");
const summaryTitle = requireElement<HTMLElement>("#summary-title");
const summaryOutcome = requireElement<HTMLElement>("#summary-outcome");
const summarySeed = requireElement<HTMLElement>("#summary-seed");
const summaryTurns = requireElement<HTMLElement>("#summary-turns");
const summaryRepairs = requireElement<HTMLElement>("#summary-repairs");
const summaryCrew = requireElement<HTMLElement>("#summary-crew");
const summaryEnemies = requireElement<HTMLElement>("#summary-enemies");
const retryRunButton = requireElement<HTMLButtonElement>("#retry-run-button");
const newCaptainButton = requireElement<HTMLButtonElement>("#new-captain-button");
const fireButton = requireElement<HTMLButtonElement>("#fire-button");
const crewAttackButton = requireElement<HTMLButtonElement>("#crew-attack-button");
const pitchShotButton = requireElement<HTMLButtonElement>("#pitch-shot-button");
const contextButton = requireElement<HTMLButtonElement>("#context-button");
const controlsHelp = requireElement<HTMLDetailsElement>(".controls-help");
const inspectionReadout = requireElement<HTMLElement>("#inspection-readout");
const inspectionTitle = requireElement<HTMLElement>("#inspection-title");
const inspectionDetail = requireElement<HTMLElement>("#inspection-detail");
const touchActionButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("#touch-controls [data-action]"));
const renderer = createRenderer(canvas);
let state: GameState | null = null;
let inspection: { level: LevelId; point: Point; mode: "hover" | "locked" } | null = null;

const TERRAIN_DETAILS: Record<Terrain, string> = {
  water: "open water, impassable",
  sand: "sand",
  grass: "grass",
  jungle: "dense jungle, blocks sight and muffles sound",
  rock: "rocky ground, blocks sight and muffles sound",
  wreck: "the shipwreck",
  caveWall: "cave wall, impassable and blocks sight and sound",
  caveFloor: "cave floor",
  stairsDown: "stairs descending into the cave",
  stairsUp: "stairs climbing to the surface",
};

const PICKUP_DETAILS = {
  mast: "replacement mast",
  canvas: "sailcloth",
  pitch: "pitch barrel",
  ammo: "powder and shot",
  salts: "smelling salts",
} as const;

const ENEMY_TACTICS: Record<EnemyType, string> = {
  skeleton: "a relentless melee pursuer",
  crab: "an ambusher that hides until approached",
  slag: "bursts into damaging embers when slain",
  bonegunner: "a ranged attacker that retreats from close combat",
};

const ENEMY_ATTRIBUTE_DETAILS: Record<EnemyAttribute, string> = {
  keenEared: "special: keen-eared, hears noise three tiles farther",
  ironclad: "special: ironclad, reduces firearm damage by two",
  skirmishing: "special: skirmishing, retreats after a melee attack",
  riposting: "special: riposting, retaliates after surviving melee damage",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
    return entities[character] ?? character;
  });
}

function randomSeed(): string {
  const words = ["barnacle", "bilge", "parrot", "squall", "grog", "haddock", "mutiny", "coconut"];
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  const first = words[(values[0] ?? 0) % words.length] ?? "island";
  const second = words[(values[1] ?? 0) % words.length] ?? "mystery";
  return `${first}-${second}-${((values[0] ?? 0) % 1000).toString().padStart(3, "0")}`;
}

function loadSave(): GameState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    if (
      parsed.version !== 11 ||
      !parsed.levels?.surface ||
      !parsed.levels.cave ||
      !parsed.environment?.surface ||
      !parsed.environment.cave ||
      !parsed.surfaceWeather ||
      !["fair", "squallWarning", "rain"].includes(parsed.surfaceWeather.phase) ||
      !Number.isInteger(parsed.surfaceWeather.transitionTurn) ||
      !Number.isInteger(parsed.surfaceWeather.cycle) ||
      (["surface", "cave"] as const).some((level) => {
        const map = parsed.levels?.[level];
        const effects = parsed.environment?.[level];
        if (!map || !effects) return true;
        const coordinates = new Set<string>();
        return effects.some((effect) => {
          const key = `${effect.x},${effect.y}`;
          const invalid =
            !Number.isInteger(effect.x) ||
            !Number.isInteger(effect.y) ||
            effect.x < 0 ||
            effect.y < 0 ||
            effect.x >= map.width ||
            effect.y >= map.height ||
            !Number.isInteger(effect.fireTurns) ||
            !Number.isInteger(effect.smokeTurns) ||
            effect.fireTurns < 0 ||
            effect.fireTurns > 3 ||
            effect.smokeTurns < 0 ||
            effect.smokeTurns > 6 ||
            effect.fireTurns + effect.smokeTurns === 0 ||
            coordinates.has(key);
          coordinates.add(key);
          return invalid;
        });
      }) ||
      !Array.isArray(parsed.actors) ||
      parsed.actors.some(
        (actor) =>
          !Number.isInteger(actor.incapacitatedTurns) ||
          !Number.isInteger(actor.wetUntilTurn) ||
          actor.wetUntilTurn < 0 ||
          actor.incapacitatedTurns < 0 ||
          actor.incapacitatedTurns > 10 ||
          (actor.incapacitatedTurns > 0 && (actor.kind !== "crew" || !actor.alive || actor.hp !== 0)) ||
          (actor.kind === "crew" && actor.alive && actor.hp === 0 && actor.incapacitatedTurns === 0) ||
          (actor.kind !== "enemy" && actor.enemyAwareness !== null) ||
          (actor.kind !== "enemy" && actor.enemyAttribute !== null) ||
          (actor.enemyAttribute !== null &&
            !["keenEared", "ironclad", "skirmishing", "riposting"].includes(actor.enemyAttribute)) ||
          (actor.enemyAwareness !== null &&
            (actor.enemyAwareness.mode !== "investigating" && actor.enemyAwareness.mode !== "pursuing" ||
              actor.enemyAwareness.targetId !== null && !Number.isInteger(actor.enemyAwareness.targetId) ||
              actor.enemyAwareness.mode === "pursuing" && actor.enemyAwareness.targetId === null ||
              !Number.isInteger(actor.enemyAwareness.lastKnownPosition.x) ||
              !Number.isInteger(actor.enemyAwareness.lastKnownPosition.y) ||
              !Number.isInteger(actor.enemyAwareness.expiresAtTurn))),
      ) ||
      !parsed.recoveredParts ||
      !parsed.repairs
    ) return null;
    return parsed as GameState;
  } catch {
    return null;
  }
}

function save(): void {
  if (!state) return;
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function healthPips(current: number, maximum: number): string {
  const count = 10;
  const filled = Math.ceil((current / maximum) * count);
  return `${"#".repeat(filled)}${"-".repeat(count - filled)}`;
}

function compassDirection(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const horizontal = dx < 0 ? "west" : "east";
  const vertical = dy < 0 ? "north" : "south";
  if (Math.abs(dx) > Math.abs(dy) * 2) return horizontal;
  if (Math.abs(dy) > Math.abs(dx) * 2) return vertical;
  return `${vertical}${horizontal}`;
}

function repairRow(part: RepairPart, label: string): string {
  if (!state) return "";
  const status = state.repairs[part] ? "installed" : state.recoveredParts[part] ? "recovered" : "missing";
  const marker = status === "installed" ? "[x]" : status === "recovered" ? "[+]" : "[ ]";
  return `<div class="repair-row ${status}"><span>${marker}</span><span>${label}</span><strong>${status}</strong></div>`;
}

function inspectionDescription(result: MapInspection): string {
  if (result.visibility === "unexplored") return "Unexplored.";
  const details = result.terrain ? [TERRAIN_DETAILS[result.terrain]] : [];
  if (result.environment?.fireTurns) details.push(`fire, ${result.environment.fireTurns} turns remaining`);
  if (result.environment?.smokeTurns) details.push(`smoke, ${result.environment.smokeTurns} turns remaining, blocks sight`);
  for (const actor of result.actors) {
    if (actor.kind === "captain") details.push(`${actor.name}, captain, ${actor.hp}/${actor.maxHp} vigor`);
    else if (isIncapacitated(actor)) {
      details.push(`${actor.name}, incapacitated, ${actor.incapacitatedTurns} turns to rescue`);
    } else if (actor.kind === "crew" || actor.kind === "castaway") {
      details.push(`${actor.name}, ${actor.role ?? actor.kind}, ${actor.hp}/${actor.maxHp} vigor`);
    } else {
      const tactic = actor.enemyType ? ENEMY_TACTICS[actor.enemyType] : "hostile";
      const awareness = actor.enemyAwareness;
      const awarenessTarget = awareness?.targetId === null
        ? null
        : result.actors.find((candidate) => candidate.id === awareness?.targetId);
      const targetLabel = awarenessTarget
        ? awarenessTarget.name
        : awareness?.targetId === null ? "a sound" : "a rival";
      const behavior = awareness
        ? `${awareness.mode} ${targetLabel} at ${awareness.lastKnownPosition.x},${awareness.lastKnownPosition.y} until turn ${awareness.expiresAtTurn}`
        : "unaware";
      const attribute = actor.enemyAttribute ? `, ${ENEMY_ATTRIBUTE_DETAILS[actor.enemyAttribute]}` : "";
      details.push(`${actor.name}, ${getFaction(actor)}, ${behavior}, ${actor.hp}/${actor.maxHp} vigor, ${tactic}${attribute}`);
    }
    if (isWet(state as GameState, actor)) details.push(`${actor.name} is wet; firearms and fire behave differently`);
  }
  for (const pickup of result.pickups) details.push(`${PICKUP_DETAILS[pickup.type]} here`);
  const prefix = result.visibility === "remembered" ? "Remembered: " : "Visible: ";
  return `${prefix}${details.join("; ")}.`;
}

function renderInspection(): void {
  if (!state || !inspection || inspection.level !== state.currentLevel) {
    inspectionReadout.hidden = true;
    return;
  }
  const result = inspectMapPoint(state, inspection.point);
  if (!result) {
    inspectionReadout.hidden = true;
    return;
  }
  inspectionReadout.hidden = false;
  inspectionTitle.textContent = `${inspection.mode === "locked" ? "Inspecting" : "Chart"} ${inspection.point.x},${inspection.point.y}`;
  inspectionDetail.textContent = inspectionDescription(result);
}

function setInspection(point: Point, mode: "hover" | "locked"): void {
  if (!state) return;
  inspection = { level: state.currentLevel, point, mode };
  renderInterface();
}

function endInspection(): void {
  inspection = null;
  renderInterface();
}

function moveInspection(dx: number, dy: number): void {
  if (!state || inspection?.mode !== "locked") return;
  inspection.point = moveInspectionCursor(inspection.point, dx, dy, getCurrentMap(state));
  renderInterface();
}

function pointFromPointer(event: PointerEvent): Point | null {
  if (!state) return null;
  const map = getCurrentMap(state);
  const player = getCaptain(state);
  const cursor = inspection?.mode === "locked" ? inspection.point : null;
  return worldPointFromClient(
    { x: event.clientX, y: event.clientY },
    canvas.getBoundingClientRect(),
    getMapCamera(map, player, cursor),
    map,
  );
}

function renderInterface(): void {
  if (!state) return;
  const player = getCaptain(state);
  const activeInspection = inspection?.level === state.currentLevel ? inspection : null;
  renderer.draw(state, activeInspection?.point);
  captainHeading.textContent = `Captain ${player.name}`;
  captainStats.innerHTML = `
    <div class="health-line"><span>VIGOR</span><strong>${healthPips(player.hp, player.maxHp)}</strong><span>${player.hp}/${player.maxHp}</span></div>
    <div class="equipment-line"><span>Cutlass</span><span>Flintlock: ${isWet(state, player) ? "damp" : state.inventory.loaded ? "loaded" : "empty"}</span></div>
    <div class="equipment-line"><span>Shot: ${state.inventory.ammo}</span><span>Salts: ${state.inventory.salts}</span></div>
    <div class="seed-line">Chart: ${escapeHtml(state.seed)} / ${state.currentLevel === "surface" ? `Island / ${state.surfaceWeather.phase === "rain" ? "Heavy rain" : state.surfaceWeather.phase === "squallWarning" ? "Squall building" : "Fair"}` : "Cave / Sheltered underground"}</div>
  `;
  turnCount.textContent = `Turn ${state.turn}`;
  dangerLevel.textContent = state.dangerLevel === 0 ? "Quiet-ish" : state.dangerLevel === 1 ? "Restless" : "Very noticed";
  repairList.innerHTML = [
    repairRow("mast", "Replacement mast"),
    repairRow("canvas", "Sailcloth"),
    repairRow("pitch", "Pitch barrel"),
    `<p class="objective-hint">Cave: ${state.caveDiscovered ? "charted" : `follow the trail ${compassDirection(state.wreck, state.caveEntrance)}`}</p>`,
  ].join("");
  const activeLevel = state.currentLevel;
  const crew = state.actors.filter((actor) => actor.alive && actor.level === activeLevel && actor.kind === "crew");
  const crewTarget = state.actors.find((actor) => actor.alive && actor.id === state?.crewTargetId);
  crewOrder.textContent = state.crewOrder === "attack" && crewTarget
    ? `Attack: ${crewTarget.name}`
    : state.crewOrder[0]?.toUpperCase() + state.crewOrder.slice(1);
  crewList.innerHTML = crew.length
    ? crew
        .map(
          (member) => {
            const status = isIncapacitated(member)
              ? `Incapacitated: ${member.incapacitatedTurns} turns`
              : `${member.hp}/${member.maxHp} vigor${isWet(state as GameState, member) ? " / Wet" : ""}`;
            return `<div class="crew-row ${isIncapacitated(member) ? "incapacitated" : ""}"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.role ?? "Pirate")}</span><span>${status}</span></div>`;
          },
        )
        .join("")
    : "<p>Currently between crews. Search the island for survivors.</p>";
  messageLog.innerHTML = state.messages
    .slice(-8)
    .reverse()
    .map((message, index) => `<p class="${index === 0 ? "latest" : ""}">${escapeHtml(message)}</p>`)
    .join("");
  const target = state.actors.find((actor) => actor.alive && actor.id === state?.targetId);
  fireButton.textContent = target ? `Fire at ${target.name}` : "Aim flintlock";
  crewAttackButton.textContent = target ? `Attack ${target.name}` : "Attack target";
  pitchShotButton.textContent = state.recoveredParts.pitch && target ? `Burn ${target.name}` : "Pitch shot";
  pitchShotButton.disabled = !state.recoveredParts.pitch;
  const onStairs =
    (state.currentLevel === "surface" && player.x === state.caveEntrance.x && player.y === state.caveEntrance.y) ||
    (state.currentLevel === "cave" && player.x === state.caveExit.x && player.y === state.caveExit.y);
  const onWreck = state.currentLevel === "surface" && player.x === state.wreck.x && player.y === state.wreck.y;
  const atSurf = getInteractionLabel(state) === "Douse in surf";
  contextButton.textContent = activeInspection?.mode === "locked" ? "Done inspecting" : getInteractionLabel(state);
  contextButton.classList.toggle("context-ready", onStairs || onWreck || atSurf);
  for (const button of touchActionButtons) {
    button.disabled =
      activeInspection?.mode === "locked" && button !== contextButton ||
      button === pitchShotButton && !state.recoveredParts.pitch;
  }
  renderInspection();
  phaseBanner.hidden = state.phase === "playing";
  const summary = getRunSummary(state);
  if (summary) {
    summaryTitle.textContent = summary.phase === "won" ? "SHIPSHAPE-ISH!" : "CAPTAIN DECEASED";
    summaryOutcome.textContent = summary.phase === "won"
      ? "The island files a formal complaint as your ship escapes."
      : "The voyage ends. The island declines to apologize.";
    summarySeed.textContent = summary.seed;
    summaryTurns.textContent = String(summary.turns);
    summaryRepairs.textContent = `${summary.installedRepairs}/3 installed`;
    summaryCrew.textContent = `${summary.survivingCrew}/${summary.recruitedCrew} survived`;
    summaryEnemies.textContent = `${summary.defeatedEnemies} defeated`;
  }
}

function commitAction(action: () => void): void {
  if (!state || state.phase !== "playing") return;
  if (inspection?.mode === "hover") inspection = null;
  action();
  save();
  renderInterface();
}

function showGame(game: GameState): void {
  state = game;
  inspection = null;
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  save();
  renderInterface();
  canvas.focus();
}

function showSetup(): void {
  state = null;
  inspection = null;
  gameScreen.hidden = true;
  setupScreen.hidden = false;
  const seedInput = requireElement<HTMLInputElement>("#world-seed");
  seedInput.value = randomSeed();
  continueButton.hidden = true;
  requireElement<HTMLInputElement>("#captain-name").focus();
}

function handleAction(action: string): void {
  if (!state) return;
  if (action === "interact" && inspection?.mode === "locked") {
    endInspection();
    return;
  }
  if (action === "interact" && getInteractionLabel(state) === "Inspect map") {
    setInspection(getCaptain(state), "locked");
    return;
  }
  if (action === "wait") commitAction(() => waitTurn(state as GameState));
  else if (action === "reload") commitAction(() => reloadFlintlock(state as GameState));
  else if (action === "salts") commitAction(() => useSmellingSalts(state as GameState));
  else if (action === "distract") commitAction(() => makeDistraction(state as GameState));
  else if (action === "target-next") {
    cycleTarget(state);
    renderInterface();
  } else if (action === "fire") {
    if (state.targetId === null) {
      cycleTarget(state);
      renderInterface();
    } else commitAction(() => fireFlintlock(state as GameState));
  } else if (action === "pitch-shot") commitAction(() => firePitchShot(state as GameState));
  else if (action === "order") commitAction(() => cycleCrewOrder(state as GameState));
  else if (action === "crew-attack") commitAction(() => commandCrewAttack(state as GameState));
  else if (action === "interact") commitAction(() => interact(state as GameState));
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = requireElement<HTMLInputElement>("#captain-name").value.trim();
  const config: CaptainConfig = {
    name: name || "Captain Nameless",
    background: requireElement<HTMLSelectElement>("#captain-background").value as Background,
    knack: requireElement<HTMLSelectElement>("#captain-knack").value as Knack,
    coat: requireElement<HTMLSelectElement>("#captain-coat").value as Coat,
  };
  const seed = requireElement<HTMLInputElement>("#world-seed").value.trim() || randomSeed();
  showGame(createGame(config, seed));
});

continueButton.addEventListener("click", () => {
  const saved = loadSave();
  if (saved) showGame(saved);
});

newRunButton.addEventListener("click", () => {
  if (state?.phase === "playing" && !window.confirm("Abandon this run? The skeletons will be smug about it.")) return;
  localStorage.removeItem(SAVE_KEY);
  showSetup();
});

function retryRun(): void {
  if (!state || state.phase === "playing") return;
  showGame(createGame(state.captainConfig, state.seed));
}

function newCaptain(): void {
  localStorage.removeItem(SAVE_KEY);
  showSetup();
}

retryRunButton.addEventListener("click", retryRun);
newCaptainButton.addEventListener("click", newCaptain);

document.addEventListener("keydown", (event) => {
  if (!state || gameScreen.hidden) return;
  if (state.phase !== "playing") {
    if (event.key === "Enter") {
      event.preventDefault();
      retryRun();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      newCaptain();
    } else if (event.key === "?") {
      event.preventDefault();
      controlsHelp.open = !controlsHelp.open;
    }
    return;
  }
  if (event.key === "?") {
    event.preventDefault();
    controlsHelp.open = !controlsHelp.open;
    return;
  }
  const movement: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    h: [-1, 0],
    j: [0, 1],
    k: [0, -1],
    l: [1, 0],
    y: [-1, -1],
    u: [1, -1],
    b: [-1, 1],
    n: [1, 1],
    "1": [-1, 1],
    "2": [0, 1],
    "3": [1, 1],
    "4": [-1, 0],
    "6": [1, 0],
    "7": [-1, -1],
    "8": [0, -1],
    "9": [1, -1],
  };
  const keypadMovement: Record<string, [number, number]> = {
    Numpad1: [-1, 1],
    Numpad2: [0, 1],
    Numpad3: [1, 1],
    Numpad4: [-1, 0],
    Numpad6: [1, 0],
    Numpad7: [-1, -1],
    Numpad8: [0, -1],
    Numpad9: [1, -1],
  };
  const direction = keypadMovement[event.code] ?? movement[event.key];
  if (direction) {
    event.preventDefault();
    if (inspection?.mode === "locked") moveInspection(direction[0], direction[1]);
    else commitAction(() => moveCaptain(state as GameState, direction[0], direction[1]));
    return;
  }
  if (inspection?.mode === "locked") {
    if (
      event.key === "Escape" ||
      event.key === "Enter" ||
      event.key.toLowerCase() === "x" ||
      event.key.toLowerCase() === "e"
    ) {
      event.preventDefault();
      endInspection();
    }
    return;
  }
  if (event.key === "." || event.key === "5" || event.code === "Numpad5") {
    event.preventDefault();
    handleAction("wait");
  } else if (event.key.toLowerCase() === "r") handleAction("reload");
  else if (event.key.toLowerCase() === "s") handleAction("salts");
  else if (event.key.toLowerCase() === "d") handleAction("distract");
  else if (event.key.toLowerCase() === "p") handleAction("pitch-shot");
  else if (event.key.toLowerCase() === "x") setInspection(getCaptain(state), "locked");
  else if (event.key === ">" || event.key === "<") commitAction(() => useStairs(state as GameState));
  else if (event.key.toLowerCase() === "e") handleAction("interact");
  else if (event.key.toLowerCase() === "f") handleAction(state.targetId === null ? "target-next" : "fire");
  else if (event.key.toLowerCase() === "a") handleAction("crew-attack");
  else if (event.key.toLowerCase() === "c") handleAction("order");
  else if (event.key === "Tab") {
    event.preventDefault();
    handleAction("target-next");
  } else if (event.key === "Enter" && state.targetId !== null) handleAction("fire");
  else if (event.key === "Escape") {
    state.targetId = null;
    renderInterface();
  }
});

requireElement<HTMLElement>("#touch-controls").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
  if (!button || !state) return;
  if (button.dataset.move) {
    const [dx, dy] = button.dataset.move.split(",").map(Number);
    if (dx !== undefined && dy !== undefined) {
      if (inspection?.mode === "locked") moveInspection(dx, dy);
      else commitAction(() => moveCaptain(state as GameState, dx, dy));
    }
  } else if (button.dataset.action) handleAction(button.dataset.action);
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" || inspection?.mode === "locked") return;
  const point = pointFromPointer(event);
  if (point) setInspection(point, "hover");
});

canvas.addEventListener("pointerleave", () => {
  if (inspection?.mode === "hover") endInspection();
});

canvas.addEventListener("pointerdown", (event) => {
  const point = pointFromPointer(event);
  if (!point) return;
  event.preventDefault();
  setInspection(point, "locked");
  canvas.focus();
});

const initialSave = loadSave();
const query = new URLSearchParams(window.location.search);
const requestedSeed = query.get("seed")?.trim();
if (requestedSeed) {
  const game = createGame(
    { name: "Morgan Haddock", background: "privateer", knack: "duelist", coat: "crimson" },
    requestedSeed,
  );
  if (query.get("level") === "cave") {
    const player = getCaptain(game);
    player.x = game.caveEntrance.x;
    player.y = game.caveEntrance.y;
    useStairs(game);
  }
  showGame(game);
} else {
  continueButton.hidden = initialSave === null;
  requireElement<HTMLInputElement>("#world-seed").value = randomSeed();
}
