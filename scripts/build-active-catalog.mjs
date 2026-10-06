import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = JSON.parse(readFileSync(new URL('../data/game-catalog.json', import.meta.url), 'utf8'));
// Updating this pin requires reviewing the new source and the blueprint profile.
if (source.source.version !== '1.1.2.4' || source.source.blueprintsSha256 !== 'EA79A4A818D1268CE2D7B26F70F806196B7A046924A245A761E0B387E54A67FC') {
  throw new Error('Unreviewed game data revision. Review the source and profile before rebuilding.');
}
const families = new Set([
  'DistrictCenter',
  'Lodge', 'MiniLodge', 'DoubleLodge', 'TripleLodge', 'Barrack', 'LargeBarrack', 'Rowhouse', 'LargeRowhouse',
  'Path', 'Stairs', 'Platform', 'DoublePlatform', 'TriplePlatform',
  'SmallWarehouse', 'MediumWarehouse', 'LargeWarehouse', 'SmallTank', 'MediumTank', 'LargeTank',
  'SmallPile', 'LargePile', 'SmallIndustrialPile', 'LargeIndustrialPile',
]);
const objects = source.objects.filter(record => record.kind !== 'building' || families.has(record.id.split('.')[0]));
if (objects.length !== 57 || objects.some(record => !record.factions.length || record.block.BaseZ !== 0)) {
  throw new Error('Installed catalog no longer matches the reviewed 57-object scope; review it before updating the web catalog.');
}
const destination = new URL('../src/generated/active-catalog.json', import.meta.url);
mkdirSync(new URL('../src/generated/', import.meta.url), { recursive: true });
const temporary = fileURLToPath(destination) + '.tmp';
writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, source: source.source, mapSize: source.mapSize, goods: source.goods, objects }, null, 2) + '\n');
renameSync(temporary, destination);
console.log(`Generated ${objects.length} active definitions from ${source.objects.length} extracted objects.`);
