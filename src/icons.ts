const paths: Record<string, string> = {
  cube: '<path d="m12 3 9 5v9l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v9 M7.5 5.5l9 5v5"/>',
  select: '<path d="m5 3 14 10-7 1-3 7Z"/>',
  move: '<path d="M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3 M6 9l-3 3 3 3 M18 9l3 3-3 3"/>',
  rotate: '<path d="M20 7v5h-5 M20 12a8 8 0 1 0-2.3 5.7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 17l10 5 10-5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14 M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  save: '<path d="M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5"/>',
  open: '<path d="M3 8V4h7l2 3h9v4 M3 8v12h17l2-9H7l-4 9"/>',
  undo: '<path d="m8 4-5 5 5 5 M3 9h11a6 6 0 0 1 0 12h-2"/>',
  redo: '<path d="m16 4 5 5-5 5 M21 9H10a6 6 0 0 0 0 12h2"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18 M3 15h18 M9 3v18 M15 3v18"/>',
  focus: '<path d="M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  leaf: '<path d="M20 3C8 2 3 8 4 14c2 8 14 8 16-11Z M4 21 15 10"/>',
  gear: '<path d="m10 3-1 3-3 1-3 3 2 3-1 4 4 1 2 3 4-2 4 1 1-4 2-3-3-3-1-4Z"/><circle cx="12" cy="12" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12 M18 6 6 18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 0 1 6 1c0 2-3 2-3 4 M12 17h.01"/>',
};

export const icon = (name: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.cube}</svg>`;

export function thumbnail(kind: string, color: string) {
  if (kind === 'district-center') return `<svg class="object-thumbnail" viewBox="0 0 84 66" aria-hidden="true"><ellipse cx="42" cy="55" rx="28" ry="7" fill="#000" opacity=".1"/><path d="M17 37 41 24 68 37v15L44 64 17 50Z" fill="${color}"/><path d="M36 43V11l8-5 9 5v32l-9 5Z" fill="#8d845b"/><path d="m32 11 12-8 14 8-14 8Z" fill="#526b58"/><path d="M22 37V15m0 0h12v8H22" stroke="#b9a171" fill="#dfb559" stroke-width="2"/></svg>`;
  if (['crop', 'tree', 'bush'].includes(kind)) {
    const crown = kind === 'tree' ? '<path d="M42 8 22 35h10l-13 10h46L52 35h10Z"/>'
      : kind === 'bush' ? '<ellipse cx="42" cy="35" rx="24" ry="16"/>'
      : '<path d="M24 45V24m18 21V18m18 27V24" fill="none" stroke-width="5"/><path d="m24 33-8-8m26 4-8-8m26 12 8-8" fill="none" stroke-width="4"/>';
    return `<svg class="object-thumbnail" viewBox="0 0 84 66" aria-hidden="true"><ellipse cx="42" cy="54" rx="27" ry="7" fill="#000" opacity=".1"/><path d="M42 53V28" stroke="#9b805c" stroke-width="7"/><g fill="${color}" stroke="${color}">${crown}</g></svg>`;
  }
  const legs = kind === 'platform' ? '<path d="M20 28v16 M43 39v16 M64 27v16" stroke="#aa9677" stroke-width="4"/>' : '';
  const height = kind === 'path' ? 5 : kind === 'platform' ? 7 : 20;
  return `<svg class="object-thumbnail" viewBox="0 0 84 66" aria-hidden="true">
    <ellipse cx="43" cy="54" rx="27" ry="7" fill="#000" opacity=".10"/>
    ${legs}<g transform="translate(0, ${kind === 'path' ? 15 : 0})">
    <path d="M18 23 41 10 66 23 43 37Z" fill="${color}"/>
    <path d="M18 23v${height}l25 14V37Z" fill="${color}" style="filter:brightness(.80)"/>
    <path d="M43 37v${height}l23-14V23Z" fill="${color}" style="filter:brightness(1.13)"/>
    ${kind === 'house' ? '<path d="m48 42 6-3v8l-6 3Z" fill="#e4dabd"/><path d="m26 32 6 3v7l-6-3Z" fill="#e4dabd"/>' : ''}
    ${kind === 'tank' ? '<path d="m18 33 25 14 23-14" fill="none" stroke="#d0d5c9" stroke-width="3"/>' : ''}
    ${kind === 'stairs' ? '<path d="m23 28 20 11 18-10 M23 35l20 11 18-10 M23 42l20 11 18-10" fill="none" stroke="#ddcfb5" stroke-width="3"/>' : ''}
    </g></svg>`;
}
