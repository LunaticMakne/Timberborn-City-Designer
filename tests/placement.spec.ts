import { expect, test, type Page } from '@playwright/test';

const singleBuilding = {
  schemaVersion: 1,
  catalogProfile: 'layout-demo',
  name: '표면 배치 확인',
  faction: 'folktails',
  gridSize: 32,
  objects: [{ id: 'base', objectType: 'demo-warehouse', position: { x: 14, y: 0, z: 14 }, rotation: 0 }],
};

async function openFixture(page: Page, fixture = singleBuilding) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'surface.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  await page.getByRole('button', { name: '플랫폼 배치', exact: true }).click();
  const rect = (await page.locator('canvas').boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function lastPlacement(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('timberborn-designer.layout-v1.folktails')!).objects.at(-1));
}

test('clicking a roof places on the visible surface, not the ground behind it', async ({ page }) => {
  const point = await openFixture(page);
  await page.mouse.click(point.x, point.y);
  expect((await lastPlacement(page)).position.y).toBe(2);
});

test('Shift places on the chosen floor even when a roof is under the pointer', async ({ page }) => {
  const point = await openFixture(page, {
    ...singleBuilding,
    objects: [{ id: 'raised-base', objectType: 'demo-warehouse', position: { x: 14, y: 3, z: 14 }, rotation: 0 }],
  });
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
  expect((await lastPlacement(page)).position.y).toBe(0);
});

test('elevated platforms snap to their deck; hidden decks are ignored and previews survive placement', async ({ page }) => {
  const point = await openFixture(page, {
    ...singleBuilding,
    objects: [{ id: 'deck', objectType: 'demo-platform', position: { x: 16, y: 3, z: 16 }, rotation: 0 }],
  });
  await page.mouse.move(point.x + 10, point.y + 10);
  await expect(page.locator('.placement-readout')).toContainText('4층');
  await page.keyboard.press('r');
  await expect(page.locator('.placement-readout')).toBeVisible();
  await expect(page.locator('.placement-readout')).toContainText('4층');
  await page.mouse.click(point.x + 10, point.y + 10);
  expect((await lastPlacement(page)).position.y).toBe(4);
  await expect(page.locator('.placement-readout')).toBeVisible();
  await expect(page.locator('.placement-readout')).toContainText('5층');
  await page.screenshot({ path: 'test-results/platform-snap.png' });
  await page.locator('#cutaway').check();
  await page.mouse.click(point.x + 10, point.y + 10);
  expect((await lastPlacement(page)).position.y).toBe(0);
});

test('a square building preview visibly changes facing before placement', async ({ page }) => {
  const point = await openFixture(page, { ...singleBuilding, objects: [] });
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.getByRole('button', { name: '대형 주거동 배치', exact: true }).click();
  await page.mouse.move(point.x + 8, point.y + 8);
  const canvas = page.locator('canvas');
  const forward = await canvas.screenshot({ style: '.placement-readout { visibility: hidden !important; }', path: 'test-results/preview-forward.png' });
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  const backward = await canvas.screenshot({ style: '.placement-readout { visibility: hidden !important; }', path: 'test-results/preview-backward.png' });
  // Same square footprint: a uniform bounding box cannot convey this rotation.
  expect(forward.equals(backward)).toBe(false);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '확대', exact: true }).click({ clickCount: 3 });
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.mouse.move(point.x + 8, point.y + 8);
  await page.screenshot({ path: 'test-results/preview-silhouette.png' });
  await page.keyboard.press('r');
  await page.keyboard.press('r');
  await page.mouse.click(point.x + 8, point.y + 8);
  expect((await lastPlacement(page)).rotation).toBe(180);
});
