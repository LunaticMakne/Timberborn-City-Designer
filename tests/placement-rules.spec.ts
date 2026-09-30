import { expect, test } from '@playwright/test';
import { createDemo, type Placement } from '../src/data';
import { blueprintProblems, placementProblem } from '../src/placement';

const base: Placement = { id: 'base', objectType: 'demo-house', position: { x: 10, y: 0, z: 10 }, rotation: 0 };

test('occupied volumes allow face contact but reject intersection and rotated bounds', () => {
  const cases = [
    { position: { x: 13, y: 0, z: 10 }, rotation: 0, issue: undefined }, // Adjacent on X.
    { position: { x: 10, y: 0, z: 12 }, rotation: 0, issue: undefined }, // Adjacent on Z.
    { position: { x: 10, y: 2, z: 10 }, rotation: 0, issue: undefined }, // On the roof.
    { position: { x: 10, y: 1, z: 10 }, rotation: 0, issue: 'overlap' },
    { position: { x: 12, y: 0, z: 10 }, rotation: 90, issue: 'overlap' },
    { position: { x: 30, y: 0, z: 10 }, rotation: 90, issue: undefined }, // Width becomes 2.
    { position: { x: 30, y: 0, z: 10 }, rotation: 0, issue: 'bounds' },
  ] as const;
  for (const { issue, ...change } of cases) {
    expect(placementProblem({ ...base, ...change, id: 'new' }, [base], 32)?.kind).toBe(issue);
  }
  expect(placementProblem(base, [base], 32)).toBeUndefined(); // An edit excludes itself.
});

test('new example blueprints contain no overlaps or out-of-bounds objects', () => {
  expect(blueprintProblems(createDemo('folktails'))).toEqual([]);
  expect(blueprintProblems(createDemo('iron-teeth'))).toEqual([]);
});
