import extracted from './generated/active-catalog.json' with { type: 'json' };
import type { Faction, Kind, ObjectDefinition } from './data';

export const gameSource = extracted.source;
export const gameProfile = 'timberborn-1.1.2.4' as const;
export type GameRecord = (typeof extracted.objects)[number];

function kindOf(record: GameRecord): Kind {
  if (record.id.startsWith('DistrictCenter.')) return 'district-center';
  if (record.kind !== 'building') return record.kind as 'crop' | 'tree' | 'bush';
  if (record.group === 'Housing') return 'house';
  if (record.id.includes('Warehouse')) return 'warehouse';
  if (record.id.includes('Tank')) return 'tank';
  if (record.id.includes('Pile')) return 'pile';
  if (record.id.includes('Platform')) return 'platform';
  if (record.id.startsWith('Stairs.')) return 'stairs';
  if (record.id === 'Path') return 'path';
  throw new Error(`No visual mapping for ${record.id}`);
}

const colors: Record<Kind, string> = {
  'district-center': '#a89860',
  house: '#779884', warehouse: '#b89269', tank: '#84a4a8', pile: '#aa895b',
  platform: '#b7a180', stairs: '#ad9879', path: '#d2c6ac',
  crop: '#99ad5f', bush: '#5f8c68', tree: '#557d58',
};

export const gameCatalog: ObjectDefinition[] = extracted.objects.map(record => {
  const kind = kindOf(record);
  const { X: w, Y: d, Z: h } = record.block.Size;
  // Only these initial families have a uniform, verified top layer. This is a
  // snap hint, NOT an implementation of the game's per-cell support rules.
  const supports = ['house', 'warehouse', 'platform', 'pile'].includes(kind)
    && record.block.Blocks.slice(-w * d).every(block => block.Stackable === 'BlockObject');
  const entrance = record.block.Entrance;
  return {
    id: record.id, name: record.name, enName: record.enName,
    kind, category: record.plant ? 'plants' : kind === 'house' ? 'housing'
      : ['warehouse', 'tank', 'pile'].includes(kind) ? 'storage' : 'structure',
    size: [w, h, d], color: record.id === 'Maple' ? '#b98752' : colors[kind],
    factions: record.factions as Faction[], game: record,
    supportHeight: supports ? h : undefined,
    entrance: entrance.HasEntrance ? {
      x: entrance.Coordinates.X, y: entrance.Coordinates.Z, z: entrance.Coordinates.Y,
    } : undefined,
  };
});

export function plantFacts(record: GameRecord): string[] {
  const plant = record.plant;
  if (!plant) return [];
  const good = (yielded: { Id: string; Amount: number }) =>
    `${extracted.goods.find(item => item.id === yielded.Id)?.name ?? yielded.Id} ${yielded.Amount}개`;
  const facts = [`성장 ${plant.growth.GrowthTimeInDays}일`];
  if (plant.cutting) facts.push(`벌목·수확: ${good(plant.cutting.Yielder.Yield)}`);
  if (plant.gathering) facts.push(`채집: ${good(plant.gathering.Yielder.Yield)} / ${plant.gathering.YieldGrowthTimeInDays}일`);
  if (plant.flooding) facts.push(`원본 수심 조건 ${plant.flooding.MinWaterHeight}–${plant.flooding.MaxWaterHeight}`);
  if (plant.watered) facts.push(`건조 시 고사 ${plant.watered.DaysToDieDry}일`);
  if (plant.arid) facts.push(`습윤 시 고사 ${plant.arid.DaysToDieWet}일`);
  return facts;
}
