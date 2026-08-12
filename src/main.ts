import "./style.css";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/pirata-one/400.css";
import "@fontsource/special-elite/400.css";
import {
  createGame,
  cycleCrewOrder,
  cycleTarget,
  fireFlintlock,
  getCaptain,
  getInteractionLabel,
  interact,
  moveCaptain,
  reloadFlintlock,
  useStairs,
  waitTurn,
} from "./game/game";
import type { Background, CaptainConfig, Coat, GameState, Knack, RepairPart } from "./game/types";
import { createRenderer } from "./render";

const SAVE_KEY = "arghipelago.active-run.v4";

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
const fireButton = requireElement<HTMLButtonElement>("#fire-button");
const contextButton = requireElement<HTMLButtonElement>("#context-button");
const controlsHelp = requireElement<HTMLDetailsElement>(".controls-help");
const renderer = createRenderer(canvas);
let state: GameState | null = null;

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
      parsed.version !== 4 ||
      !parsed.levels?.surface ||
      !parsed.levels.cave ||
      !Array.isArray(parsed.actors) ||
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

function renderInterface(): void {
  if (!state) return;
  const player = getCaptain(state);
  renderer.draw(state);
  captainHeading.textContent = `Captain ${player.name}`;
  captainStats.innerHTML = `
    <div class="health-line"><span>VIGOR</span><strong>${healthPips(player.hp, player.maxHp)}</strong><span>${player.hp}/${player.maxHp}</span></div>
    <div class="equipment-line"><span>Cutlass</span><span>Flintlock: ${state.inventory.loaded ? "loaded" : "empty"}</span></div>
    <div class="equipment-line"><span>Shot: ${state.inventory.ammo}</span><span>Salts: ${state.inventory.salts}</span></div>
    <div class="seed-line">Chart: ${escapeHtml(state.seed)} / ${state.currentLevel === "surface" ? "Island" : "Cave"}</div>
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
  crewOrder.textContent = state.crewOrder[0]?.toUpperCase() + state.crewOrder.slice(1);
  crewList.innerHTML = crew.length
    ? crew
        .map(
          (member) =>
            `<div class="crew-row"><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(member.role ?? "Pirate")}</span><span>${member.hp}/${member.maxHp} vigor</span></div>`,
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
  const onStairs =
    (state.currentLevel === "surface" && player.x === state.caveEntrance.x && player.y === state.caveEntrance.y) ||
    (state.currentLevel === "cave" && player.x === state.caveExit.x && player.y === state.caveExit.y);
  const onWreck = state.currentLevel === "surface" && player.x === state.wreck.x && player.y === state.wreck.y;
  contextButton.textContent = getInteractionLabel(state);
  contextButton.classList.toggle("context-ready", onStairs || onWreck);
  phaseBanner.hidden = state.phase === "playing";
  if (state.phase !== "playing") {
    phaseBanner.innerHTML =
      state.phase === "won"
        ? `<strong>SHIPSHAPE-ISH!</strong><span>You escape on turn ${state.turn}. The island files a complaint.</span>`
        : `<strong>CAPTAIN DECEASED</strong><span>The voyage ends on turn ${state.turn}. Very inconsiderate.</span>`;
  }
}

function commitAction(action: () => void): void {
  if (!state || state.phase !== "playing") return;
  action();
  save();
  renderInterface();
}

function showGame(game: GameState): void {
  state = game;
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  save();
  renderInterface();
  canvas.focus();
}

function showSetup(): void {
  state = null;
  gameScreen.hidden = true;
  setupScreen.hidden = false;
  const seedInput = requireElement<HTMLInputElement>("#world-seed");
  seedInput.value = randomSeed();
  continueButton.hidden = true;
  requireElement<HTMLInputElement>("#captain-name").focus();
}

function handleAction(action: string): void {
  if (!state) return;
  if (action === "wait") commitAction(() => waitTurn(state as GameState));
  else if (action === "reload") commitAction(() => reloadFlintlock(state as GameState));
  else if (action === "target-next") {
    cycleTarget(state);
    renderInterface();
  } else if (action === "fire") {
    if (state.targetId === null) {
      cycleTarget(state);
      renderInterface();
    } else commitAction(() => fireFlintlock(state as GameState));
  } else if (action === "order") commitAction(() => cycleCrewOrder(state as GameState));
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

document.addEventListener("keydown", (event) => {
  if (!state || gameScreen.hidden) return;
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
    commitAction(() => moveCaptain(state as GameState, direction[0], direction[1]));
    return;
  }
  if (event.key === "." || event.key === "5" || event.code === "Numpad5") {
    event.preventDefault();
    handleAction("wait");
  } else if (event.key.toLowerCase() === "r") handleAction("reload");
  else if (event.key === ">" || event.key === "<") commitAction(() => useStairs(state as GameState));
  else if (event.key.toLowerCase() === "e") handleAction("interact");
  else if (event.key.toLowerCase() === "f") handleAction(state.targetId === null ? "target-next" : "fire");
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
    if (dx !== undefined && dy !== undefined) commitAction(() => moveCaptain(state as GameState, dx, dy));
  } else if (button.dataset.action) handleAction(button.dataset.action);
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
