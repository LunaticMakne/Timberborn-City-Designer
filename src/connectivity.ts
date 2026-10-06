import { definition, entrancePosition, worldPosition, type Blueprint, type Placement } from './data';

export type ConnectionState = 'source' | 'connected' | 'disconnected' | 'no-center' | 'invalid';
export interface ConnectivityResult {
  states: Map<string, ConnectionState>;
  centerCount: number;
}
export const connectionLabels: Record<ConnectionState, string> = {
  source: '구역 센터 · 연결 기준', connected: '센터까지 길 연결', disconnected: '길 연결 끊김',
  'no-center': '구역 센터 없음', invalid: '배치 오류 · 연결 미판정',
};
export const connectionColors: Record<ConnectionState, string> = {
  source: '#568dba', connected: '#51a479', disconnected: '#d28a47', 'no-center': '#929990', invalid: '#cb5145',
};

const key = (p: Placement['position']) => `${p.x},${p.y},${p.z}`;

// A planning-level path graph, NOT the game's navigation simulation. Only
// source-defined path edges participate; platforms and roofs need explicit paths.
export function roadConnectivity(blueprint: Blueprint, invalidIds = new Set<string>()): ConnectivityResult {
  const states = new Map<string, ConnectionState>();
  const outgoing = new Map<string, Set<string>>();
  const objectNodes = new Map<string, Set<string>>();
  const roots: string[] = [];
  let centerCount = 0;
  const addEdge = (start: string, end: string) => {
    if (!outgoing.has(start)) outgoing.set(start, new Set());
    outgoing.get(start)!.add(end);
  };
  for (const item of blueprint.objects) {
    const type = definition(item.objectType);
    if (!type.game || (!type.entrance && !['path', 'stairs'].includes(type.kind))) continue;
    if (invalidIds.has(item.id)) { states.set(item.id, 'invalid'); continue; }
    states.set(item.id, 'disconnected');
    if (!['path', 'stairs', 'district-center'].includes(type.kind)) continue;
    const nodes = new Set<string>();
    objectNodes.set(item.id, nodes);
    const worldKey = (p: { X: number; Y: number; Z: number }) => key(worldPosition(item, { x: p.X, y: p.Z, z: p.Y }));
    for (const group of type.game.navigation?.EdgeGroups ?? []) {
      if (!group.IsPath) continue;
      for (const edge of group.AddedEdges) {
        const a = worldKey(edge.Start), b = worldKey(edge.End);
        nodes.add(a);
        addEdge(a, b);
        if (edge.IsTwoWay) { nodes.add(b); addEdge(b, a); }
      }
    }
    if (type.kind === 'district-center' && type.game.path) {
      roots.push(worldKey(type.game.path.MainPathCoordinates));
      states.set(item.id, 'source');
      centerCount++;
    }
  }
  // Reciprocal edges prevent a path touching the side of a stair from being
  // considered connected. An outward edge alone never creates a missing tile.
  const reachable = new Set(roots);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    for (const next of outgoing.get(current) ?? []) {
      if (!outgoing.get(next)?.has(current) || reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  for (const item of blueprint.objects) {
    const state = states.get(item.id);
    if (!state || state === 'source' || state === 'invalid') continue;
    if (!centerCount) { states.set(item.id, 'no-center'); continue; }
    const nodes = objectNodes.get(item.id);
    if (nodes) {
      if ([...nodes].every(node => reachable.has(node))) states.set(item.id, 'connected');
      continue;
    }
    const type = definition(item.objectType);
    const entry = entrancePosition(item)!;
    // All current catalog entrances face local -Z. Require an outgoing edge
    // towards the actual doorway too, so stair-side doors cannot pass the check.
    const inside = worldPosition(item, { ...type.entrance!, z: type.entrance!.z + 1 });
    if (reachable.has(key(entry)) && outgoing.get(key(entry))?.has(key(inside))) states.set(item.id, 'connected');
  }
  return { states, centerCount };
}
