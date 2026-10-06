import { expect, test, type Page } from '@playwright/test';
import { createBlueprint, storageKey, type Placement } from '../src/data';
import { gameProfile } from '../src/game-catalog';
import { batchPlacementProblem, dragPlacements } from '../src/placement';

test('rectangles pack rotated footprints from the start in all four directions', () => {
  for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const start = { x: 12, y: 3, z: 12 };
    const result = dragPlacements('MiniLodge.Folktails', 90, start, { x: 12 + xSign * 5, y: 0, z: 12 + zSign * 2 });
    expect(result).toHaveLength(9);
    expect(result.at(-1)!.position).toEqual({ x: 12 + xSign * 4, y: 3, z: 12 + zSign * 2 });
    expect(batchPlacementProblem(result, [], 32)).toBeUndefined();
  }
  const edge = dragPlacements('MiniLodge.Folktails', 90, { x: 31, y: 0, z: 0 }, { x: 31, y: 0, z: 0 });
  expect(batchPlacementProblem(edge, [], 32)?.kind).toBe('bounds');
  const one = dragPlacements('Carrot', 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  expect(batchPlacementProblem(one, one, 32)?.kind).toBe('overlap'); // Even identical IDs cannot bypass checking.
});

async function setup(page: Page, objects: Placement[] = [], type = 'Carrot') {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'drag.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...createBlueprint(gameProfile, 'folktails'), gridSize: 32, objects })) });
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  await page.locator(`[data-type="${type}"]`).click();
  const rect = (await page.locator('canvas').boundingBox())!;
  const scale = rect.width / (2 * Math.max(19, 17 * rect.width / rect.height));
  return (x: number, z: number) => ({ x: rect.x + rect.width / 2 + (x + 0.5 - 16) * scale, y: rect.y + rect.height / 2 + (z + 0.5 - 16) * scale });
}
const saved = (page: Page) => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).objects as Placement[], storageKey(gameProfile, 'folktails'));
async function startDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
}

test('drag previews before committing, then saves a rectangle in one undo/redo step', async ({ page }) => {
  const point = await setup(page);
  await startDrag(page, point(12, 12), point(14, 13));
  await expect(page.locator('.placement-readout')).toContainText('6개');
  await expect(page.locator('#object-count')).toHaveText('0');
  expect(await saved(page)).toHaveLength(0);
  await page.screenshot({ path: 'test-results/drag-area-preview.png' });
  await page.mouse.up();
  expect(await saved(page)).toHaveLength(6);
  expect(new Set((await saved(page)).map(item => item.id)).size).toBe(6);
  await page.locator('#undo').click();
  expect(await saved(page)).toHaveLength(0);
  await page.locator('#redo').click();
  expect(await saved(page)).toHaveLength(6);
  await page.reload();
  await expect(page.locator('#object-count')).toHaveText('6');
});

test('right-button chord cancels without placing on subsequent left release', async ({ page }) => {
  const point = await setup(page);
  await startDrag(page, point(12, 12), point(15, 14));
  await expect(page.locator('.placement-readout')).toContainText('12개');
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await expect(page.locator('.placement-readout')).not.toContainText('12개');
  await page.mouse.up();
  expect(await saved(page)).toHaveLength(0);
  // Cancel only this gesture, keep the chosen building available.
  await page.mouse.click(point(12, 12).x, point(12, 12).y);
  expect(await saved(page)).toHaveLength(1);
});

test('overlap blocks the whole drag, including otherwise free cells', async ({ page }) => {
  const obstacle: Placement = { id: 'tree', objectType: 'Oak', position: { x: 13, y: 0, z: 12 }, rotation: 0 };
  const point = await setup(page, [obstacle]);
  await startDrag(page, point(12, 12), point(14, 13));
  await expect(page.locator('.placement-readout')).toContainText('6개');
  await expect(page.locator('.placement-readout')).toContainText('전체 배치 불가');
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
  await page.screenshot({ path: 'test-results/drag-blocked.png' });
  await page.mouse.up();
  expect(await saved(page)).toEqual([obstacle]);
});

test('rotated buildings pack correctly during reversed dragging', async ({ page }) => {
  const point = await setup(page, [], 'MiniLodge.Folktails');
  await page.keyboard.press('r');
  await startDrag(page, point(16, 16), point(12, 14));
  await expect(page.locator('.placement-readout')).toContainText('9개');
  await page.mouse.up();
  const objects = await saved(page);
  expect(objects).toHaveLength(9);
  expect(objects.every(item => item.rotation === 90 && item.position.y === 0)).toBe(true);
  expect(new Set(objects.map(item => item.position.x))).toEqual(new Set([16, 14, 12]));
});

test('drag height locks to the initial roof or Shift plane', async ({ page }) => {
  const point = await setup(page, [{ id: 'base', objectType: 'Platform.Folktails', position: { x: 12, y: 2, z: 12 }, rotation: 0 }], 'Platform.Folktails');
  await startDrag(page, point(12, 12), point(14, 13));
  await expect(page.locator('.placement-readout')).toContainText('6개 · 3층');
  await page.mouse.up();
  expect((await saved(page)).slice(1).every(item => item.position.y === 3)).toBe(true);
  await page.locator('#floor').fill('5');
  await page.locator('#floor').press('Tab');
  await page.keyboard.down('Shift');
  await startDrag(page, point(16, 16), point(17, 17));
  await page.keyboard.up('Shift');
  await expect(page.locator('.placement-readout')).toContainText('4개 · 5층');
  await page.mouse.up();
  expect((await saved(page)).slice(-4).every(item => item.position.y === 5)).toBe(true);
});

test('escape, lost focus, pointer cancellation and release outside the canvas discard gestures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const point = await setup(page);
  for (const action of ['escape', 'blur', 'pointercancel', 'outside']) {
    await page.locator('[data-type="Carrot"]').click();
    await startDrag(page, point(12, 12), point(14, 13));
    if (action === 'escape') await page.keyboard.press('Escape');
    if (action === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (action === 'pointercancel') await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
    if (action === 'outside') await page.mouse.move(5, 5);
    await page.mouse.up();
    expect(await saved(page)).toHaveLength(0);
  }
  expect(errors).toEqual([]);
});
