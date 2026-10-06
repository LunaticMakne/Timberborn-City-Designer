import { definition, footprint, maxObjects, type Blueprint, type Placement } from './data';

export interface PlacementProblem {
  kind: 'overlap' | 'bounds' | 'limit';
  objectIds: string[];
  message: string;
}

// Drag anchors stay on the starting object's grid, including reversed drags.
// The height is deliberately fixed to the first surface, not re-snapped per tile.
export function dragPlacements(objectType: string, rotation: Placement['rotation'], start: Placement['position'], end: Placement['position']): Placement[] {
  const seed: Placement = { id: '', objectType, rotation, position: start };
  const [w, , d] = footprint(seed);
  const columns = Math.floor(Math.abs(end.x - start.x) / w) + 1;
  const rows = Math.floor(Math.abs(end.z - start.z) / d) + 1;
  const result: Placement[] = [];
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    result.push({ ...seed, id: `drag-preview-${result.length}`, position: {
      x: start.x + x * w * (end.x >= start.x ? 1 : -1), y: start.y,
      z: start.z + z * d * (end.z >= start.z ? 1 : -1),
    } });
  }
  return result;
}

export function batchPlacementProblem(candidates: Placement[], objects: Placement[], gridSize: number) {
  if (objects.length + candidates.length > maxObjects) return objectLimitProblem();
  // Batch members may never use an existing ID to bypass collision checks.
  const pending = [...objects];
  const boxes = objects.map(volume);
  for (const candidate of candidates) {
    const outside = boundsProblem(candidate, gridSize);
    if (outside) return outside;
    const box = volume(candidate);
    const index = boxes.findIndex(other => overlaps(box, other));
    if (index !== -1) return overlapProblem(candidate, pending[index]);
    pending.push(candidate);
    boxes.push(box);
  }
}

function objectLimitProblem(): PlacementProblem {
  return { kind: 'limit', objectIds: [], message: `청사진은 최대 ${maxObjects.toLocaleString()}개까지 배치할 수 있습니다. 영역을 줄여 주세요.` };
}

function volume(item: Placement) {
  const [w, h, d] = footprint(item);
  const { x, y, z } = item.position;
  return { x, y, z, maxX: x + w, maxY: y + h, maxZ: z + d };
}

function overlaps(a: ReturnType<typeof volume>, b: ReturnType<typeof volume>) {
  // Strict inequalities allow adjacent faces and stacking exactly on a roof.
  return a.x < b.maxX && a.maxX > b.x
    && a.y < b.maxY && a.maxY > b.y
    && a.z < b.maxZ && a.maxZ > b.z;
}

function boundsProblem(item: Placement, gridSize: number): PlacementProblem | undefined {
  const box = volume(item);
  if (box.x < 0 || box.z < 0 || box.maxX > gridSize || box.maxZ > gridSize || box.y < 0 || box.y > 12) {
    return { kind: 'bounds', objectIds: [item.id], message: '오브젝트의 점유 공간이 설계 범위를 벗어납니다.' };
  }
}

function overlapProblem(a: Placement, b: Placement): PlacementProblem {
  return { kind: 'overlap', objectIds: [a.id, b.id], message: `${definition(a.objectType).name} · ${definition(b.objectType).name}: 점유 공간이 겹칩니다.` };
}

// Conservative catalog volumes, not rendered window details or game support rules.
// Do not discard hidden floors: their occupied space still blocks construction.
export function placementProblem(candidate: Placement, objects: Placement[], gridSize: number): PlacementProblem | undefined {
  if (objects.length >= maxObjects && !objects.some(item => item.id === candidate.id)) return objectLimitProblem();
  const outside = boundsProblem(candidate, gridSize);
  if (outside) return outside;
  const box = volume(candidate);
  const other = objects.find(item => item.id !== candidate.id && overlaps(box, volume(item)));
  return other ? overlapProblem(candidate, other) : undefined;
}

export function blueprintProblems(blueprint: Blueprint): PlacementProblem[] {
  const problems: PlacementProblem[] = [];
  const boxes = blueprint.objects.map(volume);
  for (let i = 0; i < blueprint.objects.length; i++) {
    const item = blueprint.objects[i];
    const outside = boundsProblem(item, blueprint.gridSize);
    if (outside) problems.push(outside);
    // One overlap report per object flags every affected object without building
    // millions of pair records when an imported file repeats the same position.
    for (let j = 0; j < blueprint.objects.length; j++) {
      if (i !== j && overlaps(boxes[i], boxes[j])) {
        problems.push(overlapProblem(item, blueprint.objects[j]));
        break;
      }
    }
  }
  return problems;
}
