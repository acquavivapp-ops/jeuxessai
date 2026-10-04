// Explicit synthetic street grid for isolated rule tests only.
// It is never imported, served, cached or selectable by the game.
import { decorateWorld } from './decorate-street-grid.js';
export const GRID_WIDTH = 1500;
export const GRID_HEIGHT = 1400;
const WORLD_WIDTH = GRID_WIDTH, WORLD_HEIGHT = GRID_HEIGHT;
const overlaps = (a, b, margin = 0) => a.x < b.x + b.w + margin && a.x + a.w > b.x - margin && a.y < b.y + b.h + margin && a.y + a.h > b.y - margin;
export function createStreetGrid() {
  const roads = [
    ...[220, 680, 1160].map((y) => ({ x: 0, y: y - 50, w: WORLD_WIDTH, h: 100, axis: 'horizontal' })),
    ...[240, 750, 1260].map((x) => ({ x: x - 50, y: 0, w: 100, h: 1340, axis: 'vertical' })),
  ];
  const buildings = [
    { id: 'port', x: 340, y: 1030, w: 116, h: 80, kind: 'depot', name: 'Dépôt du port', target: true, hp: 1, destroyed: false, approach: { x: 310, y: 1070 } },
    { id: 'village', x: 310, y: 320, w: 114, h: 80, kind: 'depot', name: 'Dépôt de la citadelle', target: true, hp: 1, destroyed: false, approach: { x: 280, y: 360 } },
    { id: 'market', x: 820, y: 470, w: 130, h: 90, kind: 'depot', name: 'Dépôt du marché', target: true, hp: 1, destroyed: false, approach: { x: 790, y: 515 } },
  ];
  const targets = [...buildings];
  const xBlocks = [[24, 172], [308, 682], [818, 1192], [1328, 1430]];
  const yBlocks = [[24, 152], [308, 612], [768, 1092], [1238, 1310]];
  let id = 0;
  for (const [left, right] of xBlocks) for (const [top, bottom] of yBlocks) {
    let row = 0;
    for (let y = top; y + 52 <= bottom; y += 90, row++) {
      let col = 0;
      for (let x = left; x + 60 <= right; x += 116, col++) {
        const building = { id: `house-${++id}`, x, y, w: Math.min(88, right - x), h: Math.min(66, bottom - y), kind: (row + col) % 5 === 0 ? 'shop' : 'house', name: 'Maison', target: false, hp: Infinity, destroyed: false, roof: (id % 4) };
        const footRoute = { x: 298, y: 998, w: 35, h: 150 };
        if (targets.some((target) => overlaps(building, target, 35)) || overlaps(building, footRoute)) continue;
        buildings.push(building);
      }
    }
  }
  const scenery = [
    { x: 0, y: 1340, w: WORLD_WIDTH, h: 60, kind: 'water' },
    { x: 315, y: 1196, kind: 'pedestrian', variant: 1 },
    { x: 182, y: 1090, kind: 'pedestrian', variant: 2 },
    { x: 315, y: 1218, kind: 'gendarme' },
    { x: 180, y: 1200, kind: 'telephone' },
    { x: 675, y: 742, kind: 'market' },
    { x: 840, y: 1218, kind: 'bench' },
    ...[370, 490, 610, 860, 990, 1110, 1370].flatMap((x, i) => [
      { x, y: 1222, kind: 'tree', variant: i % 3 },
      { x, y: 290, kind: 'lamppost' },
      { x, y: 742, kind: 'pedestrian', variant: i % 3 },
    ]),
    { x: 975, y: 905, kind: 'maquis', w: 70, h: 60 },
  ];
  return decorateWorld({
    width: WORLD_WIDTH, height: WORLD_HEIGHT, roads, buildings, scenery,
    starts: {
      player: { x: 252, y: 1142, dir: -Math.PI / 2 },
      cars: [
        { id: 'car-start', x: 270, y: 1168, angle: 0, speed: 0, color: '#b99349', kind: 'parked' },
        { id: 'car-village', x: 280, y: 260, angle: Math.PI / 2, speed: 0, color: '#b15547', kind: 'parked' },
        { id: 'car-market', x: 790, y: 725, angle: -Math.PI / 2, speed: 0, color: '#789692', kind: 'parked' },
        { id: 'car-east', x: 1300, y: 1118, angle: Math.PI / 2, speed: 0, color: '#ddd0aa', kind: 'parked' },
        { id: 'traffic-a', x: 500, y: 220, angle: 0, speed: 38, color: '#7c8bab', kind: 'traffic', cruise: 38, lane: 220 },
        { id: 'traffic-b', x: 1100, y: 680, angle: Math.PI, speed: 42, color: '#c0b7a3', kind: 'traffic', cruise: 42, lane: 680 },
      ],
      rendezvous: { x: 252, y: 1142, radius: 36 },
      patrolSpawns: [
        { x: 1260, y: 220 }, { x: 240, y: 220 }, { x: 1260, y: 1160 },
        { x: 750, y: 680 }, { x: 750, y: 1160 }, { x: 240, y: 680 }, { x: 750, y: 220 },
      ],
    },
    districts: [
      { name: 'QUAI DU PORT', x: 420, y: 1270 },
      { name: 'CITADELLE', x: 425, y: 430 },
      { name: 'LE MARCHÉ', x: 1000, y: 610 },
      { name: 'LE MAQUIS', x: 1080, y: 995 },
    ],
  });
}
