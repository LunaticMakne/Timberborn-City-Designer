import './style.css';
import { bounds, catalogFor, createBlueprint, definition, entrancePosition, footprint, parseBlueprint, storageKey, type Blueprint, type CatalogProfile, type Faction, type Placement } from './data';
import { gameProfile, gameSource, plantFacts } from './game-catalog';
import { icon, thumbnail } from './icons';
import { CityViewer } from './viewer';
import { batchPlacementProblem, blueprintProblems, placementProblem } from './placement';
import { connectionLabels, roadConnectivity, type ConnectivityResult } from './connectivity';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const workspaceKey = 'timberborn-designer.workspace';
const movementSpeedKey = 'timberborn-designer.movement-speed';
let movementSpeed = 1;
try {
  const saved = Number(localStorage.getItem(movementSpeedKey));
  if (Number.isFinite(saved) && saved >= 1 && saved <= 3) movementSpeed = Math.round(saved * 4) / 4;
} catch { /* Navigation still works when browser storage is unavailable. */ }
let storageWarning = false;
function restore(profile: CatalogProfile, faction: Faction) {
  try {
    const stored = localStorage.getItem(storageKey(profile, faction));
    if (!stored) return createBlueprint(profile, faction);
    const result = parseBlueprint(stored);
    if (result.catalogProfile !== profile || result.faction !== faction) throw new Error('Workspace mismatch');
    return result;
  } catch { storageWarning = true; return createBlueprint(profile, faction); }
}
let initialProfile: CatalogProfile = gameProfile;
let initialFaction: Faction = 'folktails';
try {
  const workspace = JSON.parse(localStorage.getItem(workspaceKey) ?? 'null');
  if (workspace?.profile === 'layout-demo' || workspace?.profile === gameProfile) initialProfile = workspace.profile;
  if (workspace?.faction === 'iron-teeth') initialFaction = 'iron-teeth';
} catch { /* Start with the installed-game catalog. */ }
let blueprint = restore(initialProfile, initialFaction);
let selected: string | undefined = blueprint.objects.find(item => item.objectType === 'demo-large-house')?.id;
let tool = 'select';
let rotation: Placement['rotation'] = 0;
let floor = 0;
let cut = false;
let category = 'all';
let query = '';
let inspectorTab = 'properties';
let gridVisible = true;
let connectionsVisible = true;
let connections: ConnectivityResult = { states: new Map(), centerCount: 0 };
const past: Blueprint[] = [];
const future: Blueprint[] = [];
let problemIds = new Set<string>();
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

$('#app').innerHTML = `
  <header class="app-header">
    <a class="brand" href="#" aria-label="Timberborn City Designer">${icon('cube', 32)}<span><strong>TIMBERBORN</strong><small>CITY DESIGNER</small></span><span class="alpha">LAB</span></a>
    <div class="document-heading"><span class="document-symbol">${icon('layers')}</span><input id="project-name" aria-label="청사진 이름" maxlength="100"/><span class="header-divider"></span><span id="save-state" class="save-state"><i></i>로컬 작업 공간</span></div>
    <div class="file-actions"><button id="new-project" class="icon-button" title="새 청사진" aria-label="새 청사진">${icon('plus')}</button><button id="open-file" class="subtle-button">${icon('open')}<span>열기</span></button><button id="save-file" class="primary-button">${icon('save')}<span>청사진 저장</span></button></div>
  </header>
  <div class="workspace">
    <aside class="library" aria-label="오브젝트 라이브러리">
      <div class="library-top"><div class="eyebrow">BUILD YOUR NEXT COLONY</div><h1>도시를 그리다<span>.</span></h1><p>작은 블록에서, 새로운 메가시티로.</p></div>
      <label class="profile-label" for="catalog-profile">데이터 세트<select id="catalog-profile" aria-label="데이터 세트"><option value="${gameProfile}">Timberborn ${gameSource.version}</option><option value="layout-demo">기존 레이아웃 예시</option></select></label>
      <div class="faction-label">진영 <span>FACTION</span></div>
      <div class="faction-switch" role="group" aria-label="진영 선택"><button data-faction="folktails">${icon('leaf', 16)}Folktails</button><button data-faction="iron-teeth">${icon('gear', 16)}Iron Teeth</button></div>
      <label class="search-box">${icon('search', 16)}<input id="search" placeholder="오브젝트 검색" aria-label="오브젝트 검색"/><kbd>/</kbd></label>
      <div class="category-tabs" role="group" aria-label="오브젝트 분류"><button data-category="all" class="active">전체</button><button data-category="housing">주거</button><button data-category="storage">저장</button><button data-category="structure">구조</button><button data-category="plants">식물</button></div>
      <div class="library-label"><span>오브젝트 라이브러리</span><span id="catalog-count">07</span></div>
      <div id="catalog" class="catalog"></div>
      <div class="library-note"><span class="note-mark">i</span><p>레이아웃 체험용 예시 오브젝트<br/><span>실제 게임 치수는 아직 검증 전입니다.</span></p></div>
      <button id="help" class="help-button">${icon('help', 17)}<span>조작 방법</span><kbd>?</kbd></button>
    </aside>

    <main class="design-area" aria-label="청사진 편집기">
      <div class="scene-heading"><div><div class="eyebrow">BLUEPRINT WORKSPACE</div><h2>당신의 다음 도시<span class="canvas-badge">자유 배치</span></h2></div><button id="inspector-toggle" class="icon-button" title="속성 패널 접기 / 펼치기" aria-label="속성 패널 접기 / 펼치기" aria-expanded="true">${icon('panel')}</button></div>
      <div id="viewport"></div>
      <div class="canvas-top"><div class="tool-strip"><button id="select-tool" class="active" title="선택 · V" aria-label="선택 도구">${icon('select')}</button><span></span><button id="undo" title="실행 취소 · Ctrl Z" aria-label="실행 취소">${icon('undo')}</button><button id="redo" title="다시 실행 · Ctrl Shift Z" aria-label="다시 실행">${icon('redo')}</button><span></span><button id="grid-toggle" class="active" title="격자 표시" aria-label="격자 표시" aria-pressed="true">${icon('grid')}</button></div><div class="view-switch"><button data-view="iso" class="active">${icon('cube', 15)}3D</button><button data-view="top">${icon('grid', 15)}위에서</button></div></div>
      <div id="mode-hint" class="mode-hint">${icon('select', 14)}<span>오브젝트를 선택하거나, 새로 배치해 보세요</span></div>
      <div class="view-controls"><div class="compass"><span>N</span><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 5 7 25-7-5-7 5Z" fill="#4f7061"/><path d="m20 5 0 20 7 5Z" fill="#a1b0a5"/></svg></div><div class="zoom-controls"><button id="zoom-in" title="확대" aria-label="확대">${icon('plus')}</button><button id="zoom-out" title="축소" aria-label="축소">${icon('minus')}</button><button id="reset-view" title="전체 보기" aria-label="전체 보기">${icon('focus')}</button></div><label class="speed-control" for="movement-speed"><span>이동 속도 <output id="movement-speed-value" for="movement-speed">${movementSpeed}×</output></span><input id="movement-speed" type="range" min="1" max="3" step="0.25" value="${movementSpeed}" aria-label="WASD 이동 속도"/><span class="speed-limits"><span>1×</span><span>WASD</span><span>3×</span></span></label></div>
      <div class="floor-toolbar"><span class="floor-icon">${icon('layers', 20)}</span><div class="floor-label"><strong>배치 높이</strong><small>LEVEL</small></div><button id="floor-down" aria-label="배치 높이 낮추기">${icon('minus', 16)}</button><label class="floor-number"><input id="floor" type="number" min="0" max="12" value="0" aria-label="배치 높이"/><span>층</span></label><button id="floor-up" aria-label="배치 높이 올리기">${icon('plus', 16)}</button><span class="floor-divider"></span><label class="switch-label"><input type="checkbox" id="cutaway"/><span class="switch"></span><span>위층 숨김</span></label></div>
      <div class="canvas-caption"><span class="tiny-dot"></span><label class="grid-size-control">바닥 크기 <select id="grid-size" aria-label="바닥 크기" title="게임 기본 128 · 최대 256칸 / 기존 배치는 유지됩니다"></select></label><span>·</span><span id="view-caption">전체 층 표시</span></div>
    </main>

    <aside class="inspector" aria-label="설계 속성">
      <div class="inspector-tabs"><button data-inspector="properties" class="active">선택 항목</button><button data-inspector="objects">배치 목록 <span id="list-count"></span></button></div>
      <div id="inspector-content"></div>
      <div class="blueprint-summary"><div class="summary-heading"><span>${icon('layers', 16)}청사진 개요</span><span class="live-dot"></span></div><div class="summary-stats"><div><strong id="object-count">0</strong><small>오브젝트</small></div><div><strong id="height-stat">0</strong><small>최고 높이</small></div></div><div class="dimension-summary"><span>배치 범위</span><strong id="extent-stat">0 × 0 타일</strong></div><div class="summary-note">배치 검증은 후속 단계에서 지원합니다.</div></div>
    </aside>
  </div>
  <footer class="status-bar"><div><span class="status-dot"></span><span id="status-text">설계할 준비가 되었습니다</span></div><div class="mouse-help"><span>드래그 <b>회전</b></span><span>WASD <b>이동</b></span><span>휠 <b>확대·축소</b></span></div><span id="coordinates">X — &nbsp; Z —</span></footer>
  <div id="toast" role="status" aria-live="polite"></div>
  <input id="file-input" type="file" accept=".json,application/json" hidden/>
  <dialog id="help-dialog"><div class="dialog-heading"><h2>청사진을 다루는 방법</h2><button id="close-help" class="icon-button" aria-label="도움말 닫기">${icon('close')}</button></div><p>라이브러리에서 오브젝트를 고른 뒤 격자를 클릭하세요.</p><dl><div><dt>카메라 회전</dt><dd>선택 도구에서 왼쪽 드래그</dd></div><div><dt>화면 이동 / 확대</dt><dd><kbd>W A S D</kbd> 누르기 / 마우스 휠<br/>화면 방향 기준으로 이동하며 배치 중에도 사용할 수 있습니다. 입력창에서는 이동하지 않습니다.</dd></div><div><dt>선택 도구 / 배치 종료</dt><dd><kbd>V</kbd> / <kbd>Esc</kbd></dd></div><div><dt>90° 회전</dt><dd><kbd>R</kbd></dd></div><div><dt>선택 항목 삭제</dt><dd><kbd>Delete</kbd></dd></div><div><dt>실행 취소 / 다시 실행</dt><dd><kbd>Ctrl Z</kbd> / <kbd>Ctrl Shift Z</kbd></dd></div></dl><p class="dialog-note">위층 숨김은 오브젝트의 시작 높이를 기준으로 합니다. 건물 중간을 잘라 보여주는 단면 기능은 아직 없습니다.</p></dialog>
`;

$('#help-dialog .dialog-note').insertAdjacentHTML('beforebegin', '<p>배치 도구에서 왼쪽 드래그: 시작 높이의 사각형 영역을 미리 봅니다. 버튼을 놓으면 일괄 설치하며, 우클릭 또는 Esc로 취소합니다. 겹침·범위 오류가 있으면 전체 설치를 막습니다. 실행 취소도 한 묶음으로 적용합니다.</p>');
$('#grid-toggle').insertAdjacentHTML('afterend', '<button id="connection-toggle" class="active" aria-label="길 연결 표시" aria-pressed="true" title="구역 센터까지 길 연결 표시">길 연결</button>');
$('.summary-note').insertAdjacentHTML('beforebegin', '<div id="connection-summary" class="connection-summary" aria-live="polite"></div>');

let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}

let viewer: CityViewer | undefined;
try {
  viewer = new CityViewer($('#viewport'), id => {
    selected = id;
    inspectorTab = 'properties';
    refresh();
  }, positions => {
    if (tool === 'select') return;
    const items: Placement[] = positions.map(position => ({ id: crypto.randomUUID(), objectType: tool, position, rotation }));
    const problem = batchPlacementProblem(items, blueprint.objects, blueprint.gridSize);
    if (problem) { toast(problem.message); return; }
    commit(() => {
      blueprint.objects.push(...items);
      selected = items.at(-1)!.id;
      if (cut && items[0].position.y > floor) floor = items[0].position.y;
    });
  }, position => { $('#coordinates').textContent = !position ? 'X —   Z —' : `X ${position.x}   Z ${position.z}   Y ${position.y}`; });
  viewer.setMovementSpeed(movementSpeed);
} catch {
  $('#viewport').innerHTML = '<div class="webgl-error"><h2>3D 화면을 시작할 수 없습니다</h2><p>브라우저의 하드웨어 가속을 켠 뒤 새로고침해 주세요.</p></div>';
}

function saveLocal() {
  try {
    localStorage.setItem(storageKey(blueprint.catalogProfile, blueprint.faction), JSON.stringify(blueprint));
    $('#save-state').innerHTML = '<i></i>브라우저에 저장됨';
  } catch {
    $('#save-state').textContent = '자동 저장 불가';
    toast('브라우저에 저장하지 못했습니다. 청사진 저장으로 파일을 보관하세요.');
  }
}

function commit(change: () => void) {
  past.push(structuredClone(blueprint));
  if (past.length > 40) past.shift();
  future.length = 0;
  change();
  saveLocal();
  refresh();
}

function canPlace(item: Placement) {
  const problem = placementProblem(item, blueprint.objects, blueprint.gridSize);
  if (!problem) return true;
  toast(problem.message);
  return false;
}

function renderCatalog() {
  const filtered = catalogFor(blueprint.catalogProfile, blueprint.faction).filter(item =>
    (category === 'all' || item.category === category) && `${item.name} ${item.enName ?? ''} ${item.id} ${item.kind === 'district-center' ? '마을 회관 마을회관' : ''}`.toLowerCase().includes(query.toLowerCase()));
  $('#catalog-count').textContent = String(filtered.length).padStart(2, '0');
  $('#catalog').innerHTML = filtered.length ? filtered.map(item => `<button class="object-card ${tool === item.id ? 'selected' : ''}" data-type="${item.id}" aria-label="${item.name} 배치" aria-pressed="${tool === item.id}"><span class="card-add">${icon('plus', 12)}</span>${thumbnail(item.kind, item.color)}<strong>${item.name}</strong><span>${item.size[0]} × ${item.size[2]}<span class="size-divider">·</span>높이 ${item.size[1]}</span></button>`).join('') : '<p class="no-results">검색 결과가 없습니다.</p>';
  $('#catalog').querySelectorAll<HTMLButtonElement>('[data-type]').forEach(button => button.onclick = () => {
    tool = button.dataset.type!;
    selected = undefined;
    rotation = 0;
    inspectorTab = 'properties';
    refresh();
  });
}

function connectionBadge(id: string) {
  const state = connections.states.get(id);
  return state ? `<span class="connection-badge" data-connection="${state}">${connectionLabels[state]}</span>` : '';
}

function renderInspector() {
  document.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach(button => button.classList.toggle('active', button.dataset.inspector === inspectorTab));
  $('#list-count').textContent = String(blueprint.objects.length);
  if (inspectorTab === 'objects') {
    $('#inspector-content').innerHTML = `<div class="object-list">${blueprint.objects.length ? blueprint.objects.map(item => `<button data-object="${escape(item.id)}" class="list-object ${item.id === selected ? 'active' : ''}"><span class="list-color" style="background:${definition(item.objectType).color}"></span><span><strong>${definition(item.objectType).name}</strong><small>X ${item.position.x} · Z ${item.position.z} · ${item.position.y}층</small></span>${icon('chevron', 13)}</button>`).join('') : '<p class="empty-list">아직 배치된 오브젝트가 없습니다.<br/>라이브러리에서 하나 골라 보세요.</p>'}</div>`;
    $('#inspector-content').querySelectorAll<HTMLButtonElement>('[data-object]').forEach(button => {
      button.querySelector('small')?.insertAdjacentHTML('afterend', connectionBadge(button.dataset.object!));
      button.onclick = () => {
        selected = button.dataset.object;
        tool = 'select';
        inspectorTab = 'properties';
        refresh();
      };
    });
    return;
  }
  const item = tool === 'select' ? blueprint.objects.find(item => item.id === selected) : undefined;
  const type = item ? definition(item.objectType) : tool !== 'select' ? definition(tool) : undefined;
  if (!type) {
    $('#inspector-content').innerHTML = `<div class="empty-selection">${icon('select', 34)}<h3>무엇을 만들어 볼까요?</h3><p>오브젝트를 선택하면<br/>위치와 방향을 조정할 수 있어요.</p><span>라이브러리에서 골라 시작하세요</span></div>`;
    return;
  }
  const dimensions = item ? footprint(item) : type.size;
  $('#inspector-content').innerHTML = `<div class="selection-preview">${thumbnail(type.kind, type.color)}<span class="selection-tag">${item ? '선택됨' : '배치 준비'}</span></div>
    <div class="selection-heading"><div><span class="eyebrow">${{ housing: 'HOUSING', storage: 'STORAGE', structure: 'STRUCTURE', plants: 'PLANTS' }[type.category]}</span><h3>${type.name}</h3></div><span class="sample-tag">${type.game ? '원본 치수' : '예시'}</span></div>
    <div class="property-section"><div class="property-heading">${icon('cube', 15)}크기 <small>가로 × 깊이 × 높이</small></div><div class="size-value">${dimensions[0]} <span>×</span> ${dimensions[2]} <span>×</span> ${dimensions[1]} <small>타일</small></div></div>
    ${item ? `<div class="property-section"><div class="property-heading">${icon('move', 15)}위치</div><div class="coordinate-inputs">${(['x', 'z', 'y'] as const).map(axis => `<label><span>${axis === 'y' ? '높이 Y' : axis.toUpperCase()}</span><input aria-label="${axis === 'y' ? '선택 높이' : `${axis.toUpperCase()} 좌표`}" data-axis="${axis}" type="number" min="0" max="${axis === 'y' ? 12 : blueprint.gridSize - 1}" step="1" value="${item.position[axis]}"/></label>`).join('')}</div></div>` : '<p class="placement-instruction">가리킨 바닥이나 윗면에 배치합니다.<br/><kbd>Shift</kbd> 지정한 높이에 고정<br/><kbd>R</kbd> 회전 · <kbd>Esc</kbd> 종료</p>'}
    <div class="property-section"><div class="property-heading">${icon('rotate', 15)}방향</div><div class="rotation-row"><span>${item?.rotation ?? rotation}<small>°</small></span><button id="rotate-object" class="outline-button">${icon('rotate', 15)}90° 회전 <kbd>R</kbd></button></div></div>
    ${item ? `<div class="selection-actions"><button id="duplicate-object" class="outline-button">${icon('copy', 15)}복제</button><button id="delete-object" class="outline-button danger">${icon('trash', 15)}삭제</button></div><div class="object-id">OBJECT ID<span title="${escape(item.id)}">${escape(item.id)}</span></div>` : '<div class="placement-key"><kbd>Esc</kbd> 선택 도구로 돌아가기</div>'}`;
  $('#rotate-object').onclick = rotate;
  if (item) $('.selection-heading').insertAdjacentHTML('afterend', `<div class="selection-connection">${connectionBadge(item.id)}</div>`);
  if (type.category === 'plants') {
    const instruction = $('#inspector-content').querySelector('.placement-instruction');
    if (instruction) instruction.innerHTML = '식물은 바닥에 배치합니다.<br/><kbd>Shift</kbd> 계획 토양 높이에 고정<br/><kbd>Esc</kbd> 종료';
  }
  $('#inspector-content').querySelector('.placement-instruction')?.insertAdjacentHTML('beforeend', '<br/>드래그: 영역 설치 · 우클릭: 취소');
  if (type.game) {
    const entry = item ? entrancePosition(item) : type.entrance;
    const facts = document.createElement('section');
    facts.className = 'catalog-facts';
    facts.innerHTML = `<h4>${type.game.plant ? '재배 참고 정보' : '배치 참고 정보'}</h4>
      ${type.kind === 'district-center' ? '<p>마을 회관 · 길 연결의 기준점</p>' : ''}
      ${type.game.plant ? plantFacts(type.game).map(fact => `<p>${escape(fact)}</p>`).join('')
        : `<p>${type.supportHeight ? '상단 스냅 지원' : '상단 자동 적재 안 함'}</p>`}
      ${entry ? `<p>입구 ${item ? '월드' : '로컬'} X ${entry.x} · Z ${entry.z} · Y ${entry.y}</p>` : ''}
      <p class="catalog-warning">${type.game.plant ? '재배 토양·수심·관개는 미검증. 기본은 바닥, Shift는 계획 토양 높이입니다. 식물은 적재 표면이 아닙니다.'
        : '크기는 원본 점유 범위입니다. 계단은 1층 상승 / 2층 공간, 길은 얇게 그리지만 1층 공간을 예약합니다.'}</p>
      <details><summary>원본 식별자 · 출처</summary><p>${escape(type.id)}</p><p>${escape(type.game.sourcePath)}</p><p>설치본 ${gameSource.fullVersion}</p></details>`;
    $('#inspector-content').append(facts);
  }
  if (item && problemIds.has(item.id)) {
    const warning = document.createElement('p');
    warning.className = 'selection-warning';
    warning.textContent = '기존 배치에 겹침 또는 범위 문제가 있습니다. 위치를 조정하거나 삭제해 주세요.';
    $('#inspector-content').prepend(warning);
  }
  if (item) {
    $('#inspector-content').querySelectorAll<HTMLInputElement>('[data-axis]').forEach(input => input.onchange = () => {
      const axis = input.dataset.axis as 'x' | 'y' | 'z';
      const value = input.valueAsNumber;
      if (!Number.isInteger(value) || value < 0 || value > (axis === 'y' ? 12 : blueprint.gridSize - 1)) { input.value = String(item.position[axis]); return; }
      const next = { ...item, position: { ...item.position, [axis]: value } };
      if (!canPlace(next)) { input.value = String(item.position[axis]); return; }
      commit(() => { item.position = next.position; });
    });
    $('#delete-object').onclick = removeSelected;
    $('#duplicate-object').onclick = () => {
      tool = item.objectType;
      rotation = item.rotation;
      selected = undefined;
      refresh();
      toast('복제본을 둘 위치를 클릭하세요. Esc로 취소합니다.');
    };
  }
}

function refresh() {
  const sizes = [...new Set([32, 64, 128, 256, blueprint.gridSize])].sort((a, b) => a - b);
  $('#grid-size').innerHTML = sizes.map(size => `<option value="${size}">${size} × ${size}</option>`).join('');
  $<HTMLSelectElement>('#grid-size').value = String(blueprint.gridSize);
  if (tool !== 'select' && !catalogFor(blueprint.catalogProfile, blueprint.faction).some(item => item.id === tool)) tool = 'select';
  $<HTMLSelectElement>('#catalog-profile').value = blueprint.catalogProfile;
  try { localStorage.setItem(workspaceKey, JSON.stringify({ profile: blueprint.catalogProfile, faction: blueprint.faction })); } catch { /* Optional preference. */ }
  $('.library-note p').innerHTML = blueprint.catalogProfile === gameProfile
    ? `설치본 ${gameSource.version} · 57종 중 진영별 표시<br/><span>길 연결 참고 표시 · 건설/재배 규칙 미검증</span>`
    : '레이아웃 체험용 예시 오브젝트<br/><span>실제 게임 치수가 아닙니다.</span>';
  $('#floor').title = '편집기 임시 한도 0–12층. 게임 최대 높이가 아닙니다.';
  const problems = blueprintProblems(blueprint);
  problemIds = new Set(problems.flatMap(problem => problem.objectIds));
  connections = roadConnectivity(blueprint, problemIds);
  const actual = blueprint.catalogProfile === gameProfile;
  $<HTMLButtonElement>('#connection-toggle').disabled = !actual;
  $('#connection-toggle').classList.toggle('active', actual && connectionsVisible);
  $('#connection-toggle').setAttribute('aria-pressed', String(actual && connectionsVisible));
  const linked = blueprint.objects.filter(item => definition(item.objectType).entrance && definition(item.objectType).kind !== 'district-center');
  const connected = linked.filter(item => connections.states.get(item.id) === 'connected').length;
  $('#connection-summary').innerHTML = !actual ? '길 연결: 실제 카탈로그에서 지원' : !connections.centerCount
    ? '구역 센터(마을 회관)를 배치해 길 연결을 확인하세요.'
    : `센터 ${connections.centerCount}개 · 건물 연결 ${connected}/${linked.length}<br/><span class="connection-legend">파랑: 센터 · 초록: 연결 · 주황: 끊김</span><small>길·계단 및 입구 기준의 참고 검사<br/>지지·구역 경계·게임 내 통행 가능 여부는 미검증</small>`;
  const validation = $('.summary-note');
  validation.classList.toggle('has-errors', problems.length > 0);
  validation.textContent = problems.length
    ? `기존 배치 ${problemIds.size}개에 겹침·범위 문제가 있습니다. 빨간 테두리를 확인하세요.`
    : '겹침·범위 검사 적용 · 게임 건설 규칙은 미검증';
  $('#project-name').setAttribute('title', blueprint.name);
  $<HTMLInputElement>('#project-name').value = blueprint.name;
  document.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach(button => { button.classList.toggle('active', button.dataset.faction === blueprint.faction); button.setAttribute('aria-pressed', String(button.dataset.faction === blueprint.faction)); });
  $('#select-tool').classList.toggle('active', tool === 'select');
  $<HTMLButtonElement>('#undo').disabled = !past.length;
  $<HTMLButtonElement>('#redo').disabled = !future.length;
  $<HTMLInputElement>('#floor').value = String(floor);
  $<HTMLButtonElement>('#floor-down').disabled = floor === 0;
  $<HTMLButtonElement>('#floor-up').disabled = floor === 12;
  const [width, height, depth] = bounds(blueprint.objects);
  $('#object-count').textContent = String(blueprint.objects.length);
  $('#height-stat').textContent = `${Math.ceil(height)}층`;
  $('#extent-stat').textContent = `${width} × ${depth} 타일`;
  $('#view-caption').textContent = cut ? `${floor}층 이하 표시` : '전체 층 표시';
  $('#mode-hint').innerHTML = tool === 'select' ? `${icon('select', 14)}<span>오브젝트를 선택하거나, 새로 배치해 보세요</span>` : `${icon('plus', 14)}<span>${definition(tool).name} · ${definition(tool).category === 'plants' ? '바닥에 배치' : '표면에 배치'}</span><kbd>Shift</kbd><span>높이 고정</span><kbd>R</kbd><span>회전</span><kbd>Esc</kbd><span>종료</span>`;
  $('#mode-hint').classList.toggle('placing', tool !== 'select');
  $('#status-text').textContent = tool === 'select' ? `${blueprint.faction === 'folktails' ? 'Folktails' : 'Iron Teeth'} · ${blueprint.objects.length}개 오브젝트` : `${definition(tool).name} · ${definition(tool).category === 'plants' ? '바닥 배치' : '표면 스냅'} · 기준 ${floor}층`;
  renderCatalog();
  renderInspector();
  viewer?.update(blueprint, selected, floor, cut, problemIds, connectionsVisible ? connections.states : new Map());
  viewer?.setTool(tool, rotation);
}

function rotate() {
  const item = blueprint.objects.find(item => item.id === selected);
  if (tool !== 'select') { rotation = ((rotation + 90) % 360) as Placement['rotation']; refresh(); }
  else if (item) {
    const next = { ...item, rotation: ((item.rotation + 90) % 360) as Placement['rotation'] };
    if (canPlace(next)) commit(() => { item.rotation = next.rotation; });
  }
}

function removeSelected() {
  if (!selected) return;
  commit(() => { blueprint.objects = blueprint.objects.filter(item => item.id !== selected); selected = undefined; });
}

function history(direction: 'undo' | 'redo') {
  const from = direction === 'undo' ? past : future;
  const to = direction === 'undo' ? future : past;
  const next = from.pop();
  if (!next) return;
  to.push(structuredClone(blueprint));
  blueprint = next;
  selected = undefined;
  saveLocal();
  refresh();
}

function setFloor(value: number) { floor = Math.max(0, Math.min(12, Math.round(value || 0))); refresh(); }
$('#floor-up').onclick = () => setFloor(floor + 1);
$('#floor-down').onclick = () => setFloor(floor - 1);
$<HTMLInputElement>('#floor').onchange = event => setFloor((event.target as HTMLInputElement).valueAsNumber);
$<HTMLInputElement>('#cutaway').onchange = event => { cut = (event.target as HTMLInputElement).checked; refresh(); };
$('#select-tool').onclick = () => { tool = 'select'; refresh(); };
$('#undo').onclick = () => history('undo');
$('#redo').onclick = () => history('redo');
$('#zoom-in').onclick = () => viewer?.zoom(1.2);
$('#zoom-out').onclick = () => viewer?.zoom(1 / 1.2);
$('#reset-view').onclick = () => setView('iso');
$<HTMLInputElement>('#movement-speed').oninput = event => {
  movementSpeed = (event.target as HTMLInputElement).valueAsNumber;
  viewer?.setMovementSpeed(movementSpeed);
  $('#movement-speed-value').textContent = `${movementSpeed}×`;
  try { localStorage.setItem(movementSpeedKey, String(movementSpeed)); }
  catch { toast('이동 속도를 저장하지 못했습니다. 현재 화면에는 적용됩니다.'); }
};
$('#grid-toggle').onclick = () => { gridVisible = !gridVisible; $('#grid-toggle').classList.toggle('active', gridVisible); $('#grid-toggle').setAttribute('aria-pressed', String(gridVisible)); viewer?.toggleGrid(gridVisible); };
$('#connection-toggle').onclick = () => { connectionsVisible = !connectionsVisible; refresh(); };
$('#grid-size').onchange = event => {
  const input = event.target as HTMLSelectElement;
  const size = Number(input.value);
  if (size === blueprint.gridSize) return;
  const outside = blueprint.objects.some(item => {
    const [width, , depth] = footprint(item);
    return item.position.x + width > size || item.position.z + depth > size;
  });
  if (outside && size < blueprint.gridSize) {
    input.value = String(blueprint.gridSize);
    toast('축소할 영역 밖에 건물이 있습니다. 먼저 건물을 옮기거나 삭제해 주세요.');
    return;
  }
  commit(() => { blueprint.gridSize = size; });
  toast(`바닥을 ${size} × ${size}칸으로 변경했습니다. 기존 배치 좌표는 유지됩니다.`);
};

function setView(view: 'iso' | 'top') {
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  viewer?.setView(view);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.onclick = () => setView(button.dataset.view as 'iso' | 'top'));
document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => button.onclick = () => {
  category = button.dataset.category!;
  document.querySelectorAll('[data-category]').forEach(button => button.classList.toggle('active', (button as HTMLElement).dataset.category === category));
  renderCatalog();
});
document.querySelectorAll<HTMLButtonElement>('[data-faction]').forEach(button => button.onclick = () => {
  if (button.dataset.faction === blueprint.faction) return;
  saveLocal();
  blueprint = restore(blueprint.catalogProfile, button.dataset.faction as Faction);
  past.length = 0;
  future.length = 0;
  selected = undefined;
  tool = 'select';
  refresh();
  toast('진영별 작업 공간으로 전환했습니다. 이전 설계는 브라우저에 보관됩니다.');
});
$('#catalog-profile').onchange = event => {
  saveLocal();
  blueprint = restore((event.target as HTMLSelectElement).value as CatalogProfile, blueprint.faction);
  past.length = 0;
  future.length = 0;
  selected = undefined;
  tool = 'select';
  category = 'all';
  query = '';
  $<HTMLInputElement>('#search').value = '';
  document.querySelectorAll<HTMLButtonElement>('[data-category]').forEach(button => button.classList.toggle('active', button.dataset.category === 'all'));
  refresh();
};
document.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach(button => button.onclick = () => { inspectorTab = button.dataset.inspector!; renderInspector(); });
$<HTMLInputElement>('#search').oninput = event => { query = (event.target as HTMLInputElement).value.trim(); renderCatalog(); };
$<HTMLInputElement>('#project-name').onchange = event => {
  const name = (event.target as HTMLInputElement).value.trim();
  if (name) commit(() => { blueprint.name = name; });
  else refresh();
};

$('#inspector-toggle').onclick = () => {
  const compact = matchMedia('(max-width: 1100px)').matches;
  const expanded = $('.workspace').classList.toggle(compact ? 'inspector-open' : 'inspector-closed');
  $('#inspector-toggle').setAttribute('aria-expanded', String(compact ? expanded : !expanded));
};
$('#new-project').onclick = () => {
  commit(() => { blueprint = { ...blueprint, name: '새 청사진', objects: [] }; selected = undefined; tool = 'select'; });
  toast('새 청사진을 만들었습니다. 실행 취소로 이전 설계를 복원할 수 있습니다.');
};
$('#save-file').onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(blueprint, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${blueprint.name.replace(/[<>:"/\\|?*]/g, '_')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  saveLocal();
  toast('청사진을 JSON 파일로 저장했습니다.');
};
$('#open-file').onclick = () => $<HTMLInputElement>('#file-input').click();
$<HTMLInputElement>('#file-input').onchange = async event => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error('5 MB 이하의 청사진 파일을 선택해 주세요.');
    const next = parseBlueprint(await file.text());
    const problems = blueprintProblems(next);
    if (problems.length) throw new Error(`불러오기 중단: ${problems[0].message}`);
    saveLocal();
    commit(() => { blueprint = next; selected = undefined; tool = 'select'; });
    toast('청사진을 불러왔습니다.');
  } catch (error) { toast(error instanceof Error ? error.message : '파일을 읽을 수 없습니다.'); }
  input.value = '';
};
$('#help').onclick = () => $<HTMLDialogElement>('#help-dialog').showModal();
$('#close-help').onclick = () => $<HTMLDialogElement>('#help-dialog').close();
$('#help-dialog').onclick = event => { if (event.target === $('#help-dialog')) $<HTMLDialogElement>('#help-dialog').close(); };
document.addEventListener('keydown', event => {
  if ((event.target as HTMLElement).closest('input, textarea, select') || $<HTMLDialogElement>('#help-dialog').open) return;
  if (event.key === '/' && !event.ctrlKey) { event.preventDefault(); $('#search').focus(); }
  if (event.key === '?') $<HTMLDialogElement>('#help-dialog').showModal();
  if (event.key === 'Escape' || event.key.toLowerCase() === 'v') { tool = 'select'; refresh(); }
  if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey) rotate();
  if (event.key === 'Delete') { event.preventDefault(); removeSelected(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); history(event.shiftKey ? 'redo' : 'undo'); }
});

refresh();
if (storageWarning) toast('보관된 설계를 읽지 못해 초기 화면을 열었습니다. 저장한 JSON 파일을 열어 복원할 수 있습니다.');
