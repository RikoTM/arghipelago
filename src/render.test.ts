import { describe, expect, it } from "vitest";
import type { MapLevel } from "./game/types";
import { getMapCamera, moveInspectionCursor, worldPointFromClient } from "./render";

function map(width = 60, height = 42): MapLevel {
  return { id: "surface", width, height, tiles: [] };
}

describe("map viewport helpers", () => {
  it("keeps the captain camera while the inspection cursor remains visible", () => {
    expect(getMapCamera(map(), { x: 30, y: 20 }, { x: 38, y: 24 })).toEqual({ x: 20, y: 14 });
  });

  it("pans minimally to reveal the cursor and clamps to map edges", () => {
    expect(getMapCamera(map(), { x: 30, y: 20 }, { x: 50, y: 35 })).toEqual({ x: 31, y: 23 });
    expect(getMapCamera(map(), { x: 3, y: 3 }, { x: 59, y: 41 })).toEqual({ x: 40, y: 29 });
  });

  it("converts scaled canvas client coordinates into world tiles", () => {
    const rect = { left: 10, top: 20, width: 320, height: 208 };
    expect(worldPointFromClient({ x: 170, y: 124 }, rect, { x: 20, y: 14 }, map())).toEqual({ x: 30, y: 20 });
    expect(worldPointFromClient({ x: 330, y: 124 }, rect, { x: 20, y: 14 }, map())).toBeNull();
    expect(worldPointFromClient({ x: 170, y: 228 }, rect, { x: 20, y: 14 }, map())).toBeNull();
  });

  it("clamps inspection movement to each map's dimensions", () => {
    expect(moveInspectionCursor({ x: 0, y: 0 }, -1, -1, map(44, 32))).toEqual({ x: 0, y: 0 });
    expect(moveInspectionCursor({ x: 43, y: 31 }, 1, 1, map(44, 32))).toEqual({ x: 43, y: 31 });
  });
});
