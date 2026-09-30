export type Faction = 'folktails' | 'iron-teeth';
export type Category = 'housing' | 'storage' | 'structure';
export type Kind = 'house' | 'warehouse' | 'tank' | 'platform' | 'stairs' | 'path';

export interface ObjectDefinition {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
  size: [number, number, number]; // width (X), height (Y), depth (Z)
  color: string;
}

// Layout samples only. These dimensions are NOT verified Timberborn building data.
export const catalog: ObjectDefinition[] = [
  { id: 'demo-house', name: '주거동', category: 'housing', kind: 'house', size: [3, 2, 2], color: '#789985' },
  { id: 'demo-large-house', name: '대형 주거동', category: 'housing', kind: 'house', size: [3, 3, 3], color: '#5d8070' },
  { id: 'demo-warehouse', name: '창고', category: 'storage', kind: 'warehouse', size: [3, 2, 3], color: '#b89269' },
  { id: 'demo-tank', name: '물탱크', category: 'storage', kind: 'tank', size: [2, 2, 2], color: '#84a4a8' },
  { id: 'demo-platform', name: '플랫폼', category: 'structure', kind: 'platform', size: [1, 1, 1], color: '#b7a180' },
  { id: 'demo-stairs', name: '계단', category: 'structure', kind: 'stairs', size: [1, 1, 1], color: '#ad9879' },
  { id: 'demo-path', name: '길', category: 'structure', kind: 'path', size: [1, 0.12, 1], color: '#d2c6ac' },
];

export interface Placement {
  id: string;
  objectType: string;
  position: { x: number; y: number; z: number };
  rotation: 0 | 90 | 180 | 270;
}

export interface Blueprint {
  schemaVersion: 1;
  catalogProfile: 'layout-demo';
  name: string;
  faction: Faction;
  gridSize: number;
  objects: Placement[];
}

export function definition(type: string) {
  const result = catalog.find(item => item.id === type);
  if (!result) throw new Error(`알 수 없는 오브젝트: ${type}`);
  return result;
}

export function footprint(item: Placement) {
  const [w, h, d] = definition(item.objectType).size;
  return item.rotation % 180 === 0 ? [w, h, d] : [d, h, w];
}

export function createDemo(faction: Faction): Blueprint {
  const objects: Placement[] = [];
  const add = (objectType: string, x: number, y: number, z: number, rotation: Placement['rotation'] = 0) => {
    objects.push({ id: `sample-${String(objects.length + 1).padStart(3, '0')}`, objectType: `demo-${objectType}`, position: { x, y, z }, rotation });
  };
  for (let x = 8; x < 25; x++) {
    if (x !== 17) add('path', x, 0, 16); // Keep the staircase footprint clear.
    add('path', x, 0, 17);
  }
  for (let z = 9; z < 24; z++) {
    if (z === 16 || z === 17) continue; // The horizontal paths already occupy these cells.
    add('path', 15, 0, z);
    add('path', 16, 0, z);
  }
  for (const [x, z] of [[9, 10], [12, 10], [18, 10], [21, 10], [9, 20], [19, 20]]) {
    add('house', x, 0, z);
    add('house', x, 2, z);
  }
  add('large-house', 9, 4, 10);
  add('large-house', 21, 4, 10);
  add('warehouse', 10, 0, 13);
  add('warehouse', 19, 0, 13);
  add('warehouse', 11, 0, 22);
  add('tank', 22, 0, 20);
  add('tank', 22, 0, 23);
  for (let x = 12; x < 21; x++) {
    add('platform', x, 2, 12);
    add('platform', x, 2, 13);
  }
  for (let n = 0; n < 3; n++) add('stairs', 17, n, 16 - n);
  return { schemaVersion: 1, catalogProfile: 'layout-demo', name: '첫 번째 메가시티', faction, gridSize: 32, objects };
}

// File-shape checks. Spatial checks are separate so old local drafts can be repaired.
export function parseBlueprint(text: string): Blueprint {
  const data = JSON.parse(text);
  if (!data || data.schemaVersion !== 1 || data.catalogProfile !== 'layout-demo'
    || !['folktails', 'iron-teeth'].includes(data.faction)
    || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100
    || data.gridSize !== 32 || !Array.isArray(data.objects) || data.objects.length > 10000) {
    throw new Error('이 화면에서 지원하는 청사진 파일이 아닙니다.');
  }
  const ids = new Set<string>();
  for (const item of data.objects) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 150 || ids.has(item.id)
      || !catalog.some(type => type.id === item.objectType)
      || ![0, 90, 180, 270].includes(item.rotation)
      || !item.position || !['x', 'y', 'z'].every(axis => Number.isInteger(item.position[axis]))
      || item.position.x < 0 || item.position.x > 31 || item.position.z < 0 || item.position.z > 31
      || item.position.y < 0 || item.position.y > 12) {
      throw new Error('청사진의 오브젝트 데이터가 올바르지 않습니다.');
    }
    ids.add(item.id);
  }
  return data as Blueprint;
}

export function bounds(objects: Placement[]) {
  if (!objects.length) return [0, 0, 0];
  const minX = Math.min(...objects.map(o => o.position.x));
  const minZ = Math.min(...objects.map(o => o.position.z));
  return [
    Math.max(...objects.map(o => o.position.x + footprint(o)[0])) - minX,
    Math.max(...objects.map(o => o.position.y + footprint(o)[1])),
    Math.max(...objects.map(o => o.position.z + footprint(o)[2])) - minZ,
  ];
}
