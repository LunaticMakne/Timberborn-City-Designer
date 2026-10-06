import { gameCatalog, gameProfile, gameSource, type GameRecord } from './game-catalog';

// Installed 1.1.2.4: Configurations/MapSize.blueprint.json (also in data/game-catalog.json).
export const mapSize = { min: 4, max: 256, default: 128 } as const;
export const maxObjects = 10000;

export type Faction = 'folktails' | 'iron-teeth';
export type CatalogProfile = 'layout-demo' | typeof gameProfile;
export type Category = 'housing' | 'storage' | 'structure' | 'plants';
export type Kind = 'house' | 'warehouse' | 'tank' | 'platform' | 'stairs' | 'path' | 'pile' | 'crop' | 'bush' | 'tree' | 'district-center';

export interface ObjectDefinition {
  id: string;
  name: string;
  category: Category;
  kind: Kind;
  size: [number, number, number]; // width (X), height (Y), depth (Z)
  color: string;
  enName?: string;
  factions?: Faction[];
  game?: GameRecord;
  supportHeight?: number;
  entrance?: { x: number; y: number; z: number };
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
  catalogProfile: CatalogProfile;
  catalogRevision?: string;
  name: string;
  faction: Faction;
  gridSize: number;
  objects: Placement[];
}

export function definition(type: string) {
  const result = catalog.find(item => item.id === type) ?? gameCatalog.find(item => item.id === type);
  if (!result) throw new Error(`알 수 없는 오브젝트: ${type}`);
  return result;
}

export function catalogFor(profile: CatalogProfile, faction: Faction) {
  return profile === 'layout-demo' ? catalog : gameCatalog.filter(item => item.factions!.includes(faction));
}

export function createBlueprint(profile: CatalogProfile, faction: Faction): Blueprint {
  return profile === 'layout-demo' ? createDemo(faction) : {
    schemaVersion: 1, catalogProfile: gameProfile, catalogRevision: gameSource.blueprintsSha256,
    name: '새 메가시티', faction, gridSize: mapSize.default, objects: [],
  };
}

export function storageKey(profile: CatalogProfile, faction: Faction) {
  return profile === 'layout-demo' ? `timberborn-designer.layout-v1.${faction}`
    : `timberborn-designer.${profile}.${faction}`;
}

export function entrancePosition(item: Placement) {
  const type = definition(item.objectType);
  if (!type.entrance) return undefined;
  return worldPosition(item, type.entrance);
}

export function worldPosition(item: Placement, local: Placement['position']) {
  const type = definition(item.objectType);
  const { x, y, z } = local;
  const [w, , d] = type.size;
  const [rx, rz] = item.rotation === 0 ? [x, z] : item.rotation === 90 ? [d - 1 - z, x]
    : item.rotation === 180 ? [w - 1 - x, d - 1 - z] : [z, w - 1 - x];
  return { x: item.position.x + rx, y: item.position.y + y, z: item.position.z + rz };
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
  if (!data || data.schemaVersion !== 1 || !['layout-demo', gameProfile].includes(data.catalogProfile)
    || (data.catalogProfile === gameProfile && data.catalogRevision !== gameSource.blueprintsSha256)
    || !['folktails', 'iron-teeth'].includes(data.faction)
    || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100
    || !Number.isInteger(data.gridSize) || data.gridSize < mapSize.min || data.gridSize > mapSize.max
    || !Array.isArray(data.objects) || data.objects.length > maxObjects) {
    throw new Error('이 화면에서 지원하는 청사진 파일이 아닙니다.');
  }
  const ids = new Set<string>();
  const allowed = new Set(catalogFor(data.catalogProfile, data.faction).map(item => item.id));
  for (const item of data.objects) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 150 || ids.has(item.id)
      || !allowed.has(item.objectType)
      || ![0, 90, 180, 270].includes(item.rotation)
      || !item.position || !['x', 'y', 'z'].every(axis => Number.isInteger(item.position[axis]))
      || item.position.x < 0 || item.position.x >= data.gridSize || item.position.z < 0 || item.position.z >= data.gridSize
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
