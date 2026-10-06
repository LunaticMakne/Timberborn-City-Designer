import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { catalogFor, createBlueprint, createDemo, definition, entrancePosition, footprint, parseBlueprint, storageKey, type Placement } from '../src/data';
import { gameCatalog, gameProfile, gameSource, plantFacts } from '../src/game-catalog';
import { placementProblem } from '../src/placement';

test('extraction is complete, traceable, and active selection remains scoped', () => {
  const all = JSON.parse(readFileSync('data/game-catalog.json', 'utf8'));
  expect(all.source).toEqual(gameSource);
  expect(all.objects).toHaveLength(338);
  expect(all.excluded).toHaveLength(4);
  expect(all.missingNames).toEqual([]);
  expect(new Set(all.objects.map((o: { id: string }) => o.id)).size).toBe(338);
  expect(gameCatalog).toHaveLength(57);
  expect(gameCatalog.filter(item => item.category === 'plants')).toHaveLength(22);
  expect(catalogFor(gameProfile, 'folktails')).toHaveLength(32);
  expect(catalogFor(gameProfile, 'iron-teeth')).toHaveLength(31);
  for (const item of gameCatalog) {
    expect(item.game).toEqual(all.objects.find((o: { id: string }) => o.id === item.id));
    const size = item.game!.block.Size;
    expect(item.size).toEqual([size.X, size.Z, size.Y]);
    expect(item.game!.block.Blocks.length).toBe(size.X * size.Y * size.Z);
    expect(item.factions!.length).toBeGreaterThan(0);
  }
});

test('game footprints, entrance rotations and snap hints match the initial source families', () => {
  const lodge: Placement = { id: 'a', objectType: 'DoubleLodge.Folktails', position: { x: 10, y: 2, z: 10 }, rotation: 0 };
  const expected = [[11, 3, 9], [12, 3, 11], [10, 3, 12], [9, 3, 10]];
  for (const [i, rotation] of ([0, 90, 180, 270] as const).entries()) {
    const entry = entrancePosition({ ...lodge, rotation })!;
    expect([entry.x, entry.y, entry.z]).toEqual(expected[i]);
  }
  expect(footprint({ ...lodge, objectType: 'MiniLodge.Folktails', rotation: 90 })).toEqual([2, 1, 1]);
  expect(definition('Stairs.Folktails').size).toEqual([1, 2, 1]);
  expect(definition('Path').size).toEqual([1, 1, 1]);
  expect(definition('LargeTank.Folktails').supportHeight).toBeUndefined();
  expect(definition('LargePile.Folktails').supportHeight).toBeUndefined();
  expect(definition('LargeIndustrialPile.IronTeeth').supportHeight).toBe(1);
  for (const item of gameCatalog.filter(item => item.category === 'plants')) expect(item.supportHeight).toBeUndefined();
  const plant = { ...lodge, objectType: 'Oak', position: { x: 10, y: 0, z: 10 } };
  expect(placementProblem({ ...plant, id: 'b', objectType: 'Carrot' }, [plant], 32)?.kind).toBe('overlap');
});

test('plants preserve separate species and farming facts', () => {
  expect(plantFacts(definition('Carrot').game!)).toContain('성장 4일');
  expect(plantFacts(definition('Carrot').game!)).toContain('벌목·수확: 당근 3개');
  expect(definition('Oak').game!.plant!.growth.GrowthTimeInDays).toBe(30);
  expect(definition('Maple').game!.plant!.growth.GrowthTimeInDays).toBe(28);
  expect(definition('Maple').game!.plant!.gathering!.YieldGrowthTimeInDays).toBe(12);
  expect(definition('Cattail').game!.plant!.flooding!.MinWaterHeight).toBe(1);
  expect(definition('Succulent').game!.plant!.arid!.DaysToDieWet).toBe(8);
});

test('versioned profiles round-trip independently and reject wrong faction or mixed IDs', () => {
  const data = createBlueprint(gameProfile, 'folktails');
  data.objects = [{ id: 'a', objectType: 'Carrot', position: { x: 0, y: 0, z: 0 }, rotation: 0 }];
  expect(parseBlueprint(JSON.stringify(data))).toEqual(data);
  const demo = createDemo('folktails');
  expect(parseBlueprint(JSON.stringify(demo))).toEqual(demo);
  expect(storageKey(gameProfile, 'folktails')).not.toBe(storageKey('layout-demo', 'folktails'));
  for (const invalid of [
    { ...data, catalogRevision: 'unknown' }, { ...data, catalogProfile: 'timberborn-9' },
    { ...data, faction: 'iron-teeth' },
    ...['demo-house', 'Unknown', 'Barrack.IronTeeth'].map(objectType => ({ ...data, objects: [{ ...data.objects[0], objectType }] })),
    { ...demo, objects: data.objects },
  ]) expect(() => parseBlueprint(JSON.stringify(invalid))).toThrow();
});
