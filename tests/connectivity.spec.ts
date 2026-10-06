import { expect, test } from '@playwright/test';
import { createBlueprint, createDemo, definition, parseBlueprint, type Placement } from '../src/data';
import { gameProfile } from '../src/game-catalog';
import { roadConnectivity } from '../src/connectivity';
import { blueprintProblems } from '../src/placement';

function item(id: string, objectType: string, x: number, y: number, z: number, rotation: Placement['rotation'] = 0): Placement {
  return { id, objectType, position: { x, y, z }, rotation };
}
const center = item('center', 'DistrictCenter.Folktails', 10, 0, 12);
const house = item('house', 'MiniLodge.Folktails', 11, 0, 7, 180);
const roads = [9, 10, 11].map(z => item(`road-${z}`, 'Path', 11, 0, z));
const blueprint = (objects: Placement[]) => ({ ...createBlueprint(gameProfile, 'folktails'), objects });

test('both district centers retain real dimensions, entrance, source edges and file compatibility', () => {
  for (const faction of ['Folktails', 'IronTeeth']) {
    const type = definition(`DistrictCenter.${faction}`);
    expect(type.size).toEqual([3, 5, 3]);
    expect(type.entrance).toEqual({ x: 1, y: 0, z: -1 });
    expect(type.supportHeight).toBeUndefined();
    expect(type.game!.path!.MainPathCoordinates).toEqual({ X: 1, Y: 1, Z: 0 });
  }
  const data = blueprint([center, house, ...roads]);
  expect(blueprintProblems(data)).toEqual([]);
  expect(parseBlueprint(JSON.stringify(data))).toEqual(data);
  expect(roadConnectivity(createDemo('folktails')).states.size).toBe(0);
});

test('paths connect to the entrance, not any nearby building side, and missing tiles break the graph', () => {
  const data = blueprint([center, house, ...roads]);
  const result = roadConnectivity(data);
  expect(result.states.get('center')).toBe('source');
  expect(result.states.get('house')).toBe('connected');
  for (const path of roads) expect(result.states.get(path.id)).toBe('connected');
  expect(roadConnectivity(blueprint([center, { ...house, rotation: 0 }, ...roads])).states.get('house')).toBe('disconnected');
  const broken = roadConnectivity(blueprint(data.objects.filter(o => o.id !== 'road-10')));
  expect(broken.states.get('house')).toBe('disconnected');
  expect(broken.states.get('road-9')).toBe('disconnected');
  expect(broken.states.get('road-11')).toBe('connected');
});

test('rotation applies to center internal edges as well as building entrances', () => {
  const data = blueprint([
    { ...center, rotation: 90 }, item('a', 'Path', 13, 0, 13), item('b', 'Path', 14, 0, 13),
    item('house', 'MiniLodge.Folktails', 15, 0, 13, 270),
  ]);
  expect(blueprintProblems(data)).toEqual([]);
  expect(roadConnectivity(data).states.get('house')).toBe('connected');
  data.objects[0].rotation = 0;
  expect(roadConnectivity(data).states.get('house')).toBe('disconnected');
});

test('stairs connect their correct low/high ends, never sides or mismatched floors', () => {
  const stair = item('stairs', 'Stairs.Folktails', 11, 0, 10);
  const upperRoad = item('upper', 'Path', 11, 1, 9);
  const platform = item('deck', 'Platform.Folktails', 11, 0, 9);
  const elevatedHouse = { ...house, position: { ...house.position, y: 1 } };
  const data = blueprint([center, roads[2], stair, upperRoad, platform, elevatedHouse]);
  expect(blueprintProblems(data)).toEqual([]);
  expect(roadConnectivity(data).states.get('house')).toBe('connected');
  expect(roadConnectivity(data).states.has('deck')).toBe(false);
  expect(roadConnectivity(blueprint(data.objects.filter(o => o.id !== 'upper'))).states.get('house')).toBe('disconnected');
  expect(roadConnectivity(blueprint(data.objects.map(o => o.id === 'stairs' ? { ...o, rotation: 90 } : o))).states.get('house')).toBe('disconnected');
  expect(roadConnectivity(blueprint(data.objects.map(o => o.id === 'upper' ? { ...o, position: { ...o.position, y: 2 } } : o))).states.get('house')).toBe('disconnected');
  const side = blueprint([...data.objects, item('side', 'Path', 12, 1, 10), item('side-house', 'MiniLodge.Folktails', 13, 1, 10, 270)]);
  expect(roadConnectivity(side).states.get('side-house')).toBe('disconnected');
  // A door at the stair's side is not made accessible just by sharing its node.
  const sideDoor = blueprint([...data.objects, item('side-door', 'MiniLodge.Folktails', 12, 1, 10, 270)]);
  expect(roadConnectivity(sideDoor).states.get('side-door')).toBe('disconnected');
});

test('missing centers, multiple centers, plants and invalid drafts are explicit', () => {
  expect(roadConnectivity(blueprint([house, ...roads])).states.get('house')).toBe('no-center');
  const data = blueprint([center, house, ...roads, item('center-2', 'DistrictCenter.Folktails', 20, 0, 20), item('crop', 'Carrot', 0, 0, 0)]);
  expect(roadConnectivity(data).centerCount).toBe(2);
  expect(roadConnectivity(data).states.has('crop')).toBe(false);
  const invalid = roadConnectivity(data, new Set(['road-10']));
  expect(invalid.states.get('road-10')).toBe('invalid');
  expect(invalid.states.get('house')).toBe('disconnected');
  expect(roadConnectivity(blueprint([center, house, ...roads]), new Set(['center'])).states.get('house')).toBe('no-center');
});

test('web shows connection changes after deletion/undo, rotation, layer hiding, import and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#search').fill('마을 회관');
  await expect(page.locator('[data-type="DistrictCenter.Folktails"]')).toBeVisible();
  await page.locator('[data-faction="iron-teeth"]').click();
  await expect(page.locator('[data-type="DistrictCenter.IronTeeth"]')).toBeVisible();
  await page.locator('#file-input').setInputFiles({ name: 'connected.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(blueprint([center, house, ...roads]))) });
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 1/1');
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await expect(page.locator('[data-object="house"]')).toContainText('센터까지 길 연결');
  await page.locator('[data-object="road-10"]').click();
  await page.locator('#delete-object').click();
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 0/1');
  await page.locator('#undo').click();
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 1/1');
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('[data-object="house"]').click();
  await expect(page.locator('.selection-connection')).toContainText('센터까지 길 연결');
  await page.locator('#rotate-object').click();
  await expect(page.locator('.selection-connection')).toContainText('길 연결 끊김');
  await page.screenshot({ path: 'test-results/road-disconnected.png' });
  await page.locator('#undo').click();
  await page.locator('#cutaway').check();
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 1/1');
  await page.screenshot({ path: 'test-results/road-connectivity.png' });
  await page.locator('#connection-toggle').click();
  await expect(page.locator('#connection-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 1/1');
  await page.reload();
  await expect(page.locator('#connection-summary')).toContainText('건물 연결 1/1');
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600);
  await expect(page.locator('#connection-toggle')).toBeVisible();
  await page.locator('#connection-toggle').click();
  await page.screenshot({ path: 'test-results/road-connectivity-narrow.png' });
  expect(errors).toEqual([]);
});
