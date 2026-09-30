import { expect, test, type Page } from '@playwright/test';

const fixture = {
  schemaVersion: 1, catalogProfile: 'layout-demo', name: '겹침 검사', faction: 'folktails', gridSize: 32,
  objects: [{ id: 'base', objectType: 'demo-warehouse', position: { x: 14, y: 0, z: 14 }, rotation: 0 }],
};

async function openBlueprint(page: Page, data = fixture) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'collision.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  const rect = (await page.locator('canvas').boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

test('overlapping placement is blocked but touching the roof is allowed', async ({ page }) => {
  const point = await openBlueprint(page);
  await page.getByRole('button', { name: '플랫폼 배치', exact: true }).click();
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#object-count')).toHaveText('1');
  await expect(page.locator('#toast')).toContainText('겹');
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#object-count')).toHaveText('2');
});

test('moving and rotating an existing object cannot overlap its neighbor', async ({ page }) => {
  await openBlueprint(page, { ...fixture, objects: [
    { id: 'house', objectType: 'demo-house', position: { x: 14, y: 0, z: 14 }, rotation: 0 },
    { id: 'neighbor', objectType: 'demo-platform', position: { x: 14, y: 0, z: 16 }, rotation: 0 },
  ] });
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('[data-object="house"]').click();
  await page.getByRole('button', { name: '90° 회전 R' }).click();
  await expect(page.locator('.rotation-row > span')).toHaveText('0°');
  const z = page.getByRole('spinbutton', { name: 'Z 좌표', exact: true });
  await z.fill('15');
  await z.press('Tab');
  await expect(z).toHaveValue('14');
  const x = page.getByRole('spinbutton', { name: 'X 좌표', exact: true });
  await x.fill('10');
  await x.press('Tab');
  await expect(x).toHaveValue('10');
});

test('invalid imports preserve the current design and duplicates must be placed in free space', async ({ page }) => {
  const point = await openBlueprint(page);
  const invalid = { ...fixture, name: '겹친 외부 설계', objects: [...fixture.objects, { ...fixture.objects[0], id: 'overlap' }] };
  await page.locator('#file-input').setInputFiles({ name: 'overlap.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('#project-name')).toHaveValue('겹침 검사');
  await expect(page.locator('#object-count')).toHaveText('1');
  await expect(page.locator('#toast')).toContainText('불러오기 중단');
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('[data-object="base"]').click();
  await page.getByRole('button', { name: '복제', exact: true }).click();
  await expect(page.locator('#object-count')).toHaveText('1');
  await page.keyboard.down('Shift');
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.placement-readout')).toHaveClass(/blocked/);
  await expect(page.locator('#toast')).not.toHaveClass(/visible/);
  await page.screenshot({ path: 'test-results/overlap-preview.png' });
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up('Shift');
  await expect(page.locator('#object-count')).toHaveText('1');
  await page.mouse.click(point.x + 200, point.y);
  await expect(page.locator('#object-count')).toHaveText('2');
});

test('old local overlaps are preserved, flagged, and can be repaired', async ({ page }) => {
  const old = { ...fixture, objects: [...fixture.objects, { ...fixture.objects[0], id: 'overlap' }] };
  await page.addInitScript(data => localStorage.setItem('timberborn-designer.layout-v1.folktails', JSON.stringify(data)), old);
  await page.goto('/');
  await expect(page.locator('#object-count')).toHaveText('2');
  await expect(page.locator('.summary-note')).toHaveClass(/has-errors/);
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('[data-object="overlap"]').click();
  const x = page.getByRole('spinbutton', { name: 'X 좌표', exact: true });
  await x.fill('10');
  await x.press('Tab');
  await expect(x).toHaveValue('10');
  await expect(page.locator('.summary-note')).not.toHaveClass(/has-errors/);
  await expect(page.locator('#object-count')).toHaveText('2');
});

test('copies follow lower surfaces and ground; only Shift uses the chosen height', async ({ page }) => {
  const point = await openBlueprint(page, { ...fixture, objects: [
    { id: 'source', objectType: 'demo-house', position: { x: 8, y: 4, z: 8 }, rotation: 90 },
    { id: 'low-deck', objectType: 'demo-platform', position: { x: 16, y: 1, z: 16 }, rotation: 0 },
  ] });
  const floor = page.getByRole('spinbutton', { name: '배치 높이', exact: true });
  await floor.fill('5');
  await floor.press('Tab');
  await page.locator('#cutaway').check();
  await page.getByRole('button', { name: /배치 목록/ }).click();
  await page.locator('[data-object="source"]').click();
  await page.getByRole('button', { name: '복제', exact: true }).click();
  await page.mouse.click(point.x + 10, point.y + 10);
  const last = () => page.evaluate(() => JSON.parse(localStorage.getItem('timberborn-designer.layout-v1.folktails')!).objects.at(-1));
  expect((await last()).position.y).toBe(2);
  expect((await last()).rotation).toBe(90);
  await expect(floor).toHaveValue('5');
  await page.mouse.click(point.x + 200, point.y + 10);
  expect((await last()).position.y).toBe(0);
  await page.keyboard.down('Shift');
  await page.mouse.click(point.x - 200, point.y + 10);
  await page.keyboard.up('Shift');
  expect((await last()).position.y).toBe(5);
});
