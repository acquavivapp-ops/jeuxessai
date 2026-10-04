// Explicit geometry fixtures only; never imported or cached by production.
export function syntheticWorld(overrides = {}) {
  return {
    width: 400, height: 400, roads: [], buildings: [], scenery: [], districts: [],
    landPolygons: [[[0, 0], [400, 0], [400, 400], [0, 400]]],
    starts: { player: { x: 250, y: 250 }, cars: [], rendezvous: { x: 350, y: 350, radius: 24 }, patrolSpawns: [] },
    ...overrides,
  };
}

export function capsuleWorld(overrides = {}) {
  return syntheticWorld({ physics: { carShape: 'capsule', navigationRadius: 10 }, ...overrides });
}
export const rectangleBuilding = (id, x, y, w, h) => ({ id, x, y, w, h, destroyed: false, target: false, polygon: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] });
