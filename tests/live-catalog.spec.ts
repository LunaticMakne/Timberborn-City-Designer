import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createBlueprint, storageKey, type Placement } from '../src/data';
import { gameProfile } from '../src/game-catalog';

async function open(page: Page, objects: Placement[] = []) {
  await page.goto('/');
  const data = { ...createBlueprint(gameProfile, 'folktails'), gridSize: 32, objects };
  await page.locator('#file-input').setInputFiles({ name: 'live.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  const rect = (await page.locator('canvas').boundingBox())!;
  return { x: rect.x + rect.width / 2 + 10, y: rect.y + rect.height / 2 + 10 };
}
const placed = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).objects, storageKey(gameProfile, 'folktails'));

test('live catalog defaults to empty, filters by faction and includes plants with facts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#catalog-profile')).toHaveValue(gameProfile);
  await expect(page.locator('#object-count')).toHaveText('0');
  await expect(page.locator('#catalog-count')).toHaveText('32');
  await page.locator('[data-category="plants"]').click();
  await expect(page.locator('#catalog-count')).toHaveText('14');
  await page.locator('[data-type="Carrot"]').click();
  await expect(page.locator('.catalog-facts')).toContainText('성장 4일');
  await expect(page.locator('.catalog-facts')).toContainText('당근 3개');
  await page.locator('[data-faction="iron-teeth"]').click();
  await expect(page.locator('#catalog-count')).toHaveText('13');
  await expect(page.locator('[data-type="Carrot"]')).toHaveCount(0);
  await expect(page.locator('[data-type="Kohlrabi"]')).toHaveCount(1);
  await page.locator('[data-category="all"]').click();
  await expect(page.locator('#catalog-count')).toHaveText('31');
  await page.locator('#search').fill('rowhouse');
  await expect(page.locator('#catalog-count')).toHaveText('02');
  await page.locator('#catalog-profile').selectOption('layout-demo');
  await expect(page.locator('#catalog-count')).toHaveText('07');
  await expect(page.locator('#object-count')).not.toHaveText('0');
  expect(errors).toEqual([]);
});

test('real roof snap, plant ground placement, Shift soil height, and plant non-support', async ({ page }) => {
  const point = await open(page, [{ id: 'base', objectType: 'Platform.Folktails', position: { x: 16, y: 0, z: 16 }, rotation: 0 }]);
  await page.locator('[data-type="Carrot"]').click();
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.placement-readout')).toContainText('0층');
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
  await page.mouse.click(point.x, point.y);
  expect(await placed(page)).toHaveLength(1);
  await page.locator('[data-type="Platform.Folktails"]').click();
  await page.mouse.click(point.x, point.y);
  expect((await placed(page)).at(-1).position.y).toBe(1);
  await page.locator('[data-type="Carrot"]').click();
  await page.locator('#floor').fill('3');
  await page.locator('#floor').press('Tab');
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
  expect((await placed(page)).at(-1).position.y).toBe(3);
  await page.locator('[data-type="Platform.Folktails"]').click();
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.placement-readout')).toContainText('0층');
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
});

test('non-stackable roofs do not snap and invalid live imports preserve the current design', async ({ page }) => {
  const base: Placement = { id: 'tank', objectType: 'LargeTank.Folktails', position: { x: 15, y: 0, z: 15 }, rotation: 0 };
  const point = await open(page, [base]);
  await page.locator('[data-type="Platform.Folktails"]').click();
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.placement-readout')).toContainText('0층');
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
  const data = { ...createBlueprint(gameProfile, 'folktails'), objects: [base] };
  for (const invalid of [
    { ...data, catalogRevision: 'unknown' },
    { ...data, faction: 'iron-teeth' },
    { ...data, objects: [base, { ...base, id: 'duplicate' }] },
  ]) {
    await page.locator('#file-input').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await expect(page.locator('#object-count')).toHaveText('1');
    expect(await placed(page)).toEqual([base]);
  }
  await page.locator('#cutaway').check();
  // The object starts at 0, so it remains visible as a whole (not sliced).
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
});

test('live editing, file round-trip, profile/faction isolation and visible gallery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const point = await open(page);
  await page.locator('[data-type="MiniLodge.Folktails"]').click();
  await page.mouse.move(point.x, point.y);
  const before = await page.locator('canvas').screenshot();
  await page.keyboard.press('r');
  expect((await page.locator('canvas').screenshot()).equals(before)).toBe(false);
  await page.mouse.click(point.x, point.y);
  expect((await placed(page)).at(-1).rotation).toBe(90);
  await page.locator('#undo').click();
  await expect(page.locator('#object-count')).toHaveText('0');
  await page.locator('#redo').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('.list-object').click();
  await page.locator('[data-axis="x"]').fill('8');
  await page.locator('[data-axis="x"]').press('Tab');
  await expect(page.locator('.catalog-facts')).toContainText('입구 월드');
  await page.locator('#duplicate-object').click();
  await page.mouse.click(point.x + 100, point.y);
  await expect(page.locator('#object-count')).toHaveText('2');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-file').click();
  const downloaded = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(downloaded.catalogProfile).toBe(gameProfile);
  expect(downloaded.objects).toHaveLength(2);
  await page.locator('#catalog-profile').selectOption('layout-demo');
  await page.locator('#new-project').click();
  await page.locator('#catalog-profile').selectOption(gameProfile);
  await expect(page.locator('#object-count')).toHaveText('2');
  await page.locator('[data-faction="iron-teeth"]').click();
  await expect(page.locator('#object-count')).toHaveText('0');
  await page.locator('[data-faction="folktails"]').click();
  await expect(page.locator('#object-count')).toHaveText('2');
  await page.reload();
  await expect(page.locator('#object-count')).toHaveText('2');
  downloaded.name = '실제 데이터 갤러리';
  downloaded.objects = ['Lodge.Folktails', 'DoubleLodge.Folktails', 'TriplePlatform.Folktails', 'Stairs.Folktails', 'LargeTank.Folktails', 'SmallWarehouse.Folktails', 'Carrot', 'Cattail', 'BlueberryBush', 'Oak', 'Pine', 'Maple', 'Succulent'].map((objectType, index) => ({
    id: `gallery-${index}`, objectType, position: { x: 7 + (index % 5) * 4, y: 0, z: 8 + Math.floor(index / 5) * 5 }, rotation: 180,
  }));
  await page.locator('#file-input').setInputFiles({ name: 'gallery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(downloaded)) });
  await expect(page.locator('#object-count')).toHaveText('13');
  await page.locator('#zoom-in').click();
  await page.locator('[data-type="Oak"]').click();
  await page.screenshot({ path: 'test-results/live-gallery.png' });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600);
  await expect(page.locator('#catalog-profile')).toBeVisible();
  await page.screenshot({ path: 'test-results/live-narrow.png' });
  expect(errors).toEqual([]);
});
