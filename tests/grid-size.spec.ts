import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBlueprint, parseBlueprint, storageKey, type Blueprint, type Placement } from '../src/data';
import { gameProfile } from '../src/game-catalog';
import { batchPlacementProblem, blueprintProblems } from '../src/placement';

const key = storageKey(gameProfile, 'folktails');
const saved = (page: Page): Promise<Blueprint> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
const carrot = (x: number, z: number): Placement => ({ id: 'crop', objectType: 'Carrot', position: { x, y: 0, z }, rotation: 0 });

test('map-sized JSON round-trips edge coordinates and rejects unsupported sizes and anchors', () => {
  for (const size of [4, 32, 50, 64, 128, 196, 256]) {
    const data = { ...createBlueprint(gameProfile, 'folktails'), gridSize: size, objects: [carrot(size - 1, size - 1)] };
    expect(parseBlueprint(JSON.stringify(data))).toEqual(data);
    expect(blueprintProblems(data)).toEqual([]);
    expect(() => parseBlueprint(JSON.stringify({ ...data, objects: [carrot(size, 0)] }))).toThrow();
    expect(() => parseBlueprint(JSON.stringify({ ...data, objects: [carrot(0, size)] }))).toThrow();
  }
  for (const size of [0, 3, 257, 1024, 64.5, '128', null]) {
    expect(() => parseBlueprint(JSON.stringify({ ...createBlueprint(gameProfile, 'folktails'), gridSize: size }))).toThrow();
  }
});

test('large area placement cannot exceed the reloadable blueprint object limit', () => {
  const candidates = Array.from({ length: 10001 }, (_, i) => ({ ...carrot(i % 128, Math.floor(i / 128)), id: `crop-${i}` }));
  expect(batchPlacementProblem(candidates, [], 128)?.kind).toBe('limit');
});

test('resizing preserves old drafts, guards rotated footprints, and participates in undo/save/import', async ({ page }) => {
  const item: Placement = { id: 'lodge', objectType: 'MiniLodge.Folktails', position: { x: 30, y: 0, z: 8 }, rotation: 90 };
  const original = { ...createBlueprint(gameProfile, 'folktails'), gridSize: 32, objects: [item] };
  await page.addInitScript(({ key, original }) => localStorage.setItem(key, JSON.stringify(original)), { key, original });
  await page.goto('/');
  const size = page.getByRole('combobox', { name: '바닥 크기' });
  await expect(size).toHaveValue('32');
  await size.selectOption('128');
  expect((await saved(page)).objects).toEqual([item]);
  await page.locator('#undo').click();
  await expect(size).toHaveValue('32');
  await page.locator('#redo').click();
  await expect(size).toHaveValue('128');
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('.list-object').click();
  await page.locator('[data-axis="x"]').fill('31');
  await page.locator('[data-axis="x"]').press('Tab');
  await size.selectOption('32'); // Anchor fits, but rotated width reaches 33.
  await expect(size).toHaveValue('128');
  await expect(page.locator('#toast')).toContainText('축소');
  expect((await saved(page)).objects[0].position.x).toBe(31);
  await page.locator('[data-axis="x"]').fill('126');
  await page.locator('[data-axis="x"]').press('Tab');
  expect((await saved(page)).objects[0].position.x).toBe(126);
  const downloaded = page.waitForEvent('download');
  await page.locator('#save-file').click();
  const data = JSON.parse(await readFile((await (await downloaded).path())!, 'utf8'));
  expect(data.gridSize).toBe(128);
  await page.locator('#file-input').setInputFiles({ name: 'expanded.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  expect((await saved(page)).objects).toEqual(data.objects);
});

test('new maps use game default; expanded raycasting, roof snap, and reload work at the far edge', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const size = page.getByRole('combobox', { name: '바닥 크기' });
  await expect(size).toHaveValue('128');
  await size.selectOption('256');
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  await page.locator('[data-type="Platform.Folktails"]').click();
  const rect = (await page.locator('canvas').boundingBox())!;
  const scale = rect.width / (2 * Math.max(19, 17 * rect.width / rect.height) * 8);
  const point = { x: rect.x + rect.width / 2 + (255.5 - 128) * scale, y: rect.y + rect.height / 2 + (127.5 - 128) * scale };
  await page.mouse.click(point.x, point.y);
  await page.mouse.click(point.x, point.y);
  expect((await saved(page)).objects.map(item => item.position)).toEqual([{ x: 255, y: 0, z: 127 }, { x: 255, y: 1, z: 127 }]);
  await page.reload();
  await expect(size).toHaveValue('256');
  await expect(page.locator('#object-count')).toHaveText('2');
  await page.screenshot({ path: 'test-results/grid-256.png' });
  expect(errors).toEqual([]);
});

test('large-map drag previews beyond 1024 cells, commits atomically, and blocks the save limit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.locator('#grid-size').selectOption('256');
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  await page.locator('[data-type="Carrot"]').click();
  const rect = (await page.locator('canvas').boundingBox())!;
  const scale = rect.width / (2 * Math.max(19, 17 * rect.width / rect.height) * 8);
  const point = (x: number, z: number) => ({ x: rect.x + rect.width / 2 + (x + 0.5 - 128) * scale, y: rect.y + rect.height / 2 + (z + 0.5 - 128) * scale });
  const start = point(40, 40), end = point(79, 69);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 2 });
  await expect(page.locator('.placement-readout')).toContainText('1200개');
  await page.screenshot({ path: 'test-results/grid-large-drag.png' });
  await page.mouse.up();
  expect((await saved(page)).objects).toHaveLength(1200);
  expect((await saved(page)).objects.at(-1)!.position).toEqual({ x: 79, y: 0, z: 69 });
  await page.locator('#undo').click();
  const tooFar = point(140, 140);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(tooFar.x, tooFar.y, { steps: 2 });
  await expect(page.locator('.placement-readout')).toContainText('10201개');
  await expect(page.locator('.placement-readout')).toContainText('1만 개 한도');
  await page.mouse.up();
  expect((await saved(page)).objects).toEqual([]);
  expect(errors).toEqual([]);
});
