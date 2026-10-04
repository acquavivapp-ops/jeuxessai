// Photographic canopy positions and small, indexed gameplay trunks are kept
// separate. Low scrub slows walkers; taller bushes have a solid base.
const CELL = 128;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export function attachVegetation(world, data) {
  if (!Array.isArray(world.vegetation)) {
    const bounds = data?.metadata?.bounds || data?.metadata?.boundsWGS84 || data?.bounds;
    const matches = world.metadata?.city === 'Calvi' && bounds && ['west', 'south', 'east', 'north'].every((key) => Math.abs(world.metadata.bounds?.[key] - bounds[key]) < 1e-7);
    world.vegetation = matches && data?.metadata?.status === 'ready' ? (data.vegetation || []).map((item) => ({ ...item, kind: item.kind || item.type, source: item.source || item.sourcePlacement })) : [];
  }
  world.vegetation = world.vegetation.filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.x >= 0 && item.y >= 0 && item.x <= world.width && item.y <= world.height && (item.kind === 'tree' || item.kind === 'scrub'));
  for (const item of world.vegetation) {
    item.trunkRadius = item.kind === 'tree' ? clamp((item.radius || 8) * .12, 1.2, 3) : 0;
    item.solidRadius = item.kind === 'scrub' && item.heightMeters > 1.6 ? clamp((item.radius || 8) * .5, 2, 12) : item.trunkRadius;
  }
  return world.vegetation;
}

export function createVegetationIndexes(vegetation = []) {
  const render = new Map(), collision = new Map(), ground = new Map();
  const push = (index, key, item) => { if (!index.has(key)) index.set(key, []); index.get(key).push(item); };
  for (const item of vegetation) {
    push(render, `${Math.floor(item.x / CELL)},${Math.floor(item.y / CELL)}`, item);
    const radius = item.solidRadius ?? item.trunkRadius ?? 0;
    if (radius) for (let cy = Math.floor((item.y - radius) / CELL); cy <= Math.floor((item.y + radius) / CELL); cy++) {
      for (let cx = Math.floor((item.x - radius) / CELL); cx <= Math.floor((item.x + radius) / CELL); cx++) push(collision, `${cx},${cy}`, item);
    }
    if (item.kind === 'scrub' && !radius) for (let cy = Math.floor((item.y - (item.radius || 8)) / CELL); cy <= Math.floor((item.y + (item.radius || 8)) / CELL); cy++) {
      for (let cx = Math.floor((item.x - (item.radius || 8)) / CELL); cx <= Math.floor((item.x + (item.radius || 8)) / CELL); cx++) push(ground, `${cx},${cy}`, item);
    }
  }
  return { render, collision, ground };
}

export function createWorldVegetationIndexes(world) {
  // Verified photo vegetation replaces the old illustrated accents in both
  // render modes. Those hidden accents must not become invisible obstacles.
  const photographed = world.vegetation || [];
  const legacy = photographed.length ? [] : (world.scenery || []).filter((item) => !item.polygon && !item.w && !item.h && ['tree', 'olive', 'bush', 'maquis'].includes(item.kind))
    .map((item) => {
      const tree = item.kind === 'tree' || item.kind === 'olive';
      const radius = (tree ? item.type === 'pine' ? 13 : 11.5 : 7.5) * (item.scale || 1);
      const trunkRadius = tree ? clamp(radius * .12, 1.2, 3) : 0;
      return { ...item, kind: tree ? 'tree' : 'scrub', radius, trunkRadius,
        solidRadius: !tree && item.heightMeters > 1.6 ? clamp(radius * .5, 2, 12) : trunkRadius };
    });
  world.vegetationCollisionObjects = [...photographed, ...legacy];
  return createVegetationIndexes(world.vegetationCollisionObjects);
}

export function vegetationMovementFactor(index, x, y, radius = 4) {
  if (!index?.size) return 1;
  for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
    for (const scrub of index.get(`${cx},${cy}`) || []) if (!scrub.destroyed && (scrub.x - x) ** 2 + (scrub.y - y) ** 2 < (radius + (scrub.radius || 8)) ** 2) return .62;
  }
  return 1;
}

export function sweptCircleTouchesVegetation(index, fromX, fromY, toX, toY, radius) {
  if (!index?.size) return false;
  const dx = toX - fromX, dy = toY - fromY, length = dx * dx + dy * dy;
  for (let cy = Math.floor((Math.min(fromY, toY) - radius) / CELL); cy <= Math.floor((Math.max(fromY, toY) + radius) / CELL); cy++) {
    for (let cx = Math.floor((Math.min(fromX, toX) - radius) / CELL); cx <= Math.floor((Math.max(fromX, toX) + radius) / CELL); cx++) for (const tree of index.get(`${cx},${cy}`) || []) {
      if (tree.destroyed) continue;
      const t = length ? clamp(((tree.x - fromX) * dx + (tree.y - fromY) * dy) / length, 0, 1) : 0;
      if ((tree.x - fromX - dx * t) ** 2 + (tree.y - fromY - dy * t) ** 2 < (radius + (tree.solidRadius ?? tree.trunkRadius ?? 0)) ** 2) return true;
    }
  }
  return false;
}

export function circleTouchesVegetation(index, x, y, radius) {
  if (!index?.size) return false;
  for (let cy = Math.floor((y - radius) / CELL); cy <= Math.floor((y + radius) / CELL); cy++) {
    for (let cx = Math.floor((x - radius) / CELL); cx <= Math.floor((x + radius) / CELL); cx++) {
      for (const tree of index.get(`${cx},${cy}`) || []) if (!tree.destroyed && (tree.x - x) ** 2 + (tree.y - y) ** 2 < (radius + (tree.solidRadius ?? tree.trunkRadius ?? 0)) ** 2) return true;
    }
  }
  return false;
}

export function capsuleTouchesVegetation(index, axis, radius = 8) {
  if (!index?.size) return false;
  const a = axis[0], b = axis[1], dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const minX = Math.min(a[0], b[0]) - radius, maxX = Math.max(a[0], b[0]) + radius;
  const minY = Math.min(a[1], b[1]) - radius, maxY = Math.max(a[1], b[1]) + radius;
  for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (const tree of index.get(`${cx},${cy}`) || []) {
        if (tree.destroyed) continue;
        const t = length ? clamp(((tree.x - a[0]) * dx + (tree.y - a[1]) * dy) / length, 0, 1) : 0;
        if ((tree.x - a[0] - dx * t) ** 2 + (tree.y - a[1] - dy * t) ** 2 < (radius + (tree.solidRadius ?? tree.trunkRadius ?? 0)) ** 2) return true;
      }
    }
  }
  return false;
}

export function* nearbyVegetation(index, minX, minY, maxX, maxY) {
  if (!index?.size) return;
  for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
    for (const tree of index.get(`${cx},${cy}`) || []) if (!tree.destroyed) yield tree;
  }
}
