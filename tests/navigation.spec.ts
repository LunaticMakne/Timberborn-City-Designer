import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('timberborn-designer.workspace', JSON.stringify({ profile: 'layout-demo', faction: 'folktails' })));
});

async function setup(page: Page) {
  await page.goto('/');
  await page.locator('#new-project').click();
  await page.getByRole('button', { name: '위에서', exact: true }).click();
  const canvas = page.locator('canvas');
  await canvas.focus();
  const rect = (await canvas.boundingBox())!;
  const point = { x: rect.x + rect.width / 2 + 8, y: rect.y + rect.height / 2 + 8 };
  await page.mouse.move(point.x, point.y);
  await page.clock.install();
  return point;
}

async function coordinates(page: Page) {
  const text = (await page.locator('#coordinates').textContent())!;
  const match = text.match(/X (\d+)\s+Z (\d+)/)!;
  return { x: Number(match[1]), z: Number(match[2]) };
}

test('WASD pans continuously in screen-relative directions, including while placing', async ({ page }) => {
  await setup(page);
  for (const placing of [false, true]) {
    if (placing) {
      await page.getByRole('button', { name: '플랫폼 배치', exact: true }).click();
      const rect = (await page.locator('canvas').boundingBox())!;
      await page.mouse.move(rect.x + rect.width / 2 + 8, rect.y + rect.height / 2 + 8);
    }
    for (const [key, axis, direction] of [['w', 'z', -1], ['s', 'z', 1], ['a', 'x', -1], ['d', 'x', 1]] as const) {
      const before = await coordinates(page);
      await page.keyboard.down(key);
      await page.clock.runFor(500);
      const first = await coordinates(page);
      expect((first[axis] - before[axis]) * direction).toBeGreaterThan(0);
      await page.clock.runFor(500);
      const second = await coordinates(page);
      expect((second[axis] - first[axis]) * direction).toBeGreaterThan(0);
      await page.keyboard.up(key);
      await page.clock.runFor(500);
      expect(await coordinates(page)).toEqual(second);
    }
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('timberborn-designer.layout-v1.folktails')!).objects)).toHaveLength(0);
  const target = await coordinates(page);
  const rect = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(rect.x + rect.width / 2 + 8, rect.y + rect.height / 2 + 8);
  const placed = await page.evaluate(() => JSON.parse(localStorage.getItem('timberborn-designer.layout-v1.folktails')!).objects);
  expect(placed).toHaveLength(1);
  expect(placed[0].position).toEqual({ ...target, y: 0 });
});

test('movement follows the rotated view rather than fixed world axes', async ({ page }) => {
  const point = await setup(page);
  const rect = (await page.locator('canvas').boundingBox())!;
  // OrbitControls turns 180 degrees for a horizontal drag of half the viewport height.
  await page.mouse.down();
  await page.mouse.move(point.x - rect.height / 2, point.y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(point.x, point.y);
  const before = await coordinates(page);
  await page.keyboard.down('w');
  await page.clock.runFor(500);
  await page.keyboard.up('w');
  expect((await coordinates(page)).z).toBeGreaterThan(before.z);
  await page.keyboard.down('a');
  await page.clock.runFor(500);
  await page.keyboard.up('a');
  expect((await coordinates(page)).x).toBeGreaterThan(before.x);
});

test('typing, dialogs, shortcuts and losing focus do not leave the camera moving', async ({ page }) => {
  await setup(page);
  const before = await coordinates(page);
  for (const selector of ['#project-name', '#search', '#floor']) {
    await page.locator(selector).focus();
    await page.keyboard.down('w');
    await page.clock.runFor(500);
    await page.keyboard.up('w');
    expect(await coordinates(page)).toEqual(before);
  }
  await page.locator('canvas').focus();
  await page.keyboard.down('Control');
  await page.keyboard.down('a');
  await page.clock.runFor(500);
  await page.keyboard.up('a');
  await page.keyboard.up('Control');
  expect(await coordinates(page)).toEqual(before);
  await page.keyboard.down('d');
  await page.clock.runFor(500);
  expect((await coordinates(page)).x).toBeGreaterThan(before.x);
  await page.locator('#project-name').focus();
  const stopped = await coordinates(page);
  await page.clock.runFor(500);
  expect(await coordinates(page)).toEqual(stopped);
  await page.keyboard.up('d');
  await page.locator('canvas').focus();
  await page.keyboard.down('w');
  await page.clock.runFor(200);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.clock.runFor(500);
  await page.keyboard.up('w');
  // Restore the pointer readout without restarting movement.
  const rect = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2 + 9, rect.y + rect.height / 2 + 9);
  const afterBlur = await coordinates(page);
  await page.clock.runFor(500);
  expect(await coordinates(page)).toEqual(afterBlur);
  await page.locator('#help').click();
  await page.keyboard.down('w');
  await page.clock.runFor(500);
  await page.keyboard.up('w');
  await page.locator('#close-help').click();
  await page.mouse.move(rect.x + rect.width / 2 + 9, rect.y + rect.height / 2 + 9);
  expect(await coordinates(page)).toEqual(afterBlur);
});

test('right dragging no longer moves the camera', async ({ page }) => {
  const point = await setup(page);
  const before = await coordinates(page);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(point.x + 120, point.y + 80, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.press('Escape');
  await page.mouse.move(point.x, point.y);
  expect(await coordinates(page)).toEqual(before);
});

test('speed slider keeps the previous speed as its minimum and immediately scales movement', async ({ page }) => {
  const point = await setup(page);
  const slider = page.getByRole('slider', { name: 'WASD 이동 속도' });
  await expect(slider).toHaveValue('1');
  const start = await coordinates(page);
  await page.keyboard.down('d');
  await page.clock.runFor(400);
  await page.keyboard.up('d');
  const normalDistance = (await coordinates(page)).x - start.x;
  expect(normalDistance).toBeGreaterThanOrEqual(3);
  expect(normalDistance).toBeLessThanOrEqual(5);

  await page.getByRole('button', { name: '위에서', exact: true }).click();
  await page.mouse.move(point.x, point.y);
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveValue('3');
  await expect(page.locator('#movement-speed-value')).toHaveText('3×');
  // Range controls are not text fields: WASD must work without an extra canvas click.
  await page.keyboard.down('d');
  await page.clock.runFor(400);
  await page.keyboard.up('d');
  const fastDistance = (await coordinates(page)).x - start.x;
  expect(Math.abs(fastDistance - normalDistance * 3)).toBeLessThanOrEqual(2);

  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveValue('1');
});

test('movement speed survives reload without changing blueprint data and fits compact layouts', async ({ page }) => {
  await page.goto('/');
  await page.locator('#new-project').click();
  const blueprint = await page.evaluate(() => localStorage.getItem('timberborn-designer.layout-v1.folktails'));
  const slider = page.getByRole('slider', { name: 'WASD 이동 속도' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveValue('1.25');
  await page.reload();
  await expect(slider).toHaveValue('1.25');
  await expect(page.locator('#movement-speed-value')).toHaveText('1.25×');
  expect(await page.evaluate(() => localStorage.getItem('timberborn-designer.layout-v1.folktails'))).toBe(blueprint);
  await page.screenshot({ path: 'test-results/movement-speed.png' });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(slider).toBeVisible();
  await slider.click();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600);
  await page.screenshot({ path: 'test-results/movement-speed-narrow.png' });
});
