import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { definition, footprint, mapSize, type Blueprint, type ObjectDefinition, type Placement } from './data';
import { batchPlacementProblem, dragPlacements, placementProblem } from './placement';
import { connectionColors, type ConnectionState } from './connectivity';

export class CityViewer {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 3000);
  private controls: OrbitControls;
  private city = new THREE.Group();
  private grid = new THREE.GridHelper(32, 32, 0xaaa99d, 0xc8c8ba);
  private levelGrid = new THREE.GridHelper(32, 32, 0x74a88c, 0xabc5b3);
  private gridSize = 32;
  private view: 'iso' | 'top' = 'iso';
  private base = new THREE.Mesh(new THREE.BoxGeometry(32, 0.42, 32), new THREE.MeshStandardMaterial({ color: '#d2d2be', roughness: 1 }));
  private sun = new THREE.DirectionalLight(0xfff4dd, 3);
  private ghost = new THREE.Group();
  private ghostKey = '';
  private ghostBlocked?: boolean;
  private drag?: { start: Placement['position']; pointerId: number; moved: boolean };
  private areaPreview = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#70975a', transparent: true, opacity: 0.4, depthWrite: false }), mapSize.max ** 2);
  private problemOutlines = new THREE.Group();
  private outline?: THREE.Box3Helper;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerStart = { x: 0, y: 0 };
  private floor = 0;
  private tool = 'select';
  private rotation: Placement['rotation'] = 0;
  private hovered?: Placement['position'];
  private lastPointer?: { clientX: number; clientY: number; shiftKey: boolean };
  private readout = document.createElement('div');
  private blueprint?: Blueprint;
  private selected?: string;
  private cut = false;
  private canvas: HTMLCanvasElement;
  private movementKeys = new Set<string>();
  private movementFrame?: number;
  private movementTime = 0;
  private movementSpeed = 1;

  constructor(private container: HTMLElement, private onSelect: (id?: string) => void, private onPlace: (positions: Placement['position'][]) => void, private onHover: (position?: Placement['position']) => void) {
    this.scene.background = new THREE.Color('#eaece3');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor('#eaece3');
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '3D 청사진 작업 공간');
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.readout.className = 'placement-readout';
    this.readout.hidden = true;
    container.append(this.readout);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.maxPolarAngle = Math.PI / 2.05;
    this.controls.minZoom = 0.45;
    this.controls.maxZoom = 4;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };
    this.controls.addEventListener('change', () => { this.updatePreview(); this.render(); });
    this.scene.add(new THREE.HemisphereLight(0xfffcf0, 0x879d91, 2.4));
    const sun = this.sun;
    sun.position.set(-18, 30, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    const base = this.base;
    base.position.y = -0.25;
    base.receiveShadow = true;
    this.scene.add(base);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2048, 2048), new THREE.MeshStandardMaterial({ color: '#eaece3', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.48;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.grid.position.y = -0.025;
    this.scene.add(this.grid);
    this.levelGrid.visible = false;
    const gridMaterial = this.levelGrid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.4;
    this.scene.add(this.levelGrid, this.city, this.ghost, this.problemOutlines);
    this.areaPreview.visible = false;
    this.areaPreview.frustumCulled = false;
    this.scene.add(this.areaPreview);
    this.ghost.visible = false;
    this.canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
      if (this.tool === 'select') return;
      this.pointerMove(event);
      if (this.hovered) {
        this.drag = { start: { ...this.hovered }, pointerId: event.pointerId, moved: false };
        this.canvas.setPointerCapture(event.pointerId);
      }
    });
    // pointerdown is not fired for the second mouse button in a chord.
    this.canvas.addEventListener('mousedown', event => {
      if (event.button === 2 && this.drag) { event.preventDefault(); this.cancelDrag(); }
    });
    this.canvas.addEventListener('contextmenu', event => {
      if (this.tool !== 'select') event.preventDefault();
      this.cancelDrag();
    });
    this.canvas.addEventListener('pointercancel', () => this.cancelDrag());
    this.canvas.addEventListener('lostpointercapture', () => { if (this.drag) this.cancelDrag(); });
    this.canvas.addEventListener('pointermove', event => this.pointerMove(event));
    this.canvas.addEventListener('pointerleave', () => { this.lastPointer = undefined; this.updatePreview(); this.render(); });
    for (const type of ['keydown', 'keyup'] as const) document.addEventListener(type, event => {
      if (event.key !== 'Shift' || !this.lastPointer) return;
      this.lastPointer.shiftKey = type === 'keydown';
      this.updatePreview();
      this.render();
    });
    document.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey || this.navigationBlocked()) {
        this.stopMovement();
        return;
      }
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
      event.preventDefault();
      this.movementKeys.add(event.code);
      if (this.movementFrame === undefined) {
        this.movementTime = performance.now();
        this.movementFrame = requestAnimationFrame(time => this.moveCamera(time));
      }
    });
    document.addEventListener('keyup', event => {
      this.movementKeys.delete(event.code);
      if (!this.movementKeys.size) this.stopMovement();
    });
    document.addEventListener('focusin', () => { if (this.navigationBlocked()) this.stopMovement(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { this.stopMovement(); this.cancelDrag(); } });
    window.addEventListener('blur', () => { this.stopMovement(); this.lastPointer = undefined; this.cancelDrag(); });
    this.canvas.addEventListener('pointerup', event => {
      if (event.button !== 0) return;
      this.setRay(event);
      if (this.tool !== 'select') {
        if (!this.drag || this.drag.pointerId !== event.pointerId) return;
        this.pointerMove(event);
        const positions = !this.hovered ? [] : this.drag.moved
          ? dragPlacements(this.tool, this.rotation, this.drag.start, this.hovered).map(item => item.position)
          : [{ ...this.hovered }];
        this.cancelDrag();
        if (positions.length) this.onPlace(positions);
      } else if (Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) <= 5) {
        this.onSelect(this.objectHit()?.group.userData.id);
      }
    }, true); // Commit before OrbitControls releases capture.
    new ResizeObserver(() => this.resize()).observe(container);
    this.setView('iso');
    this.resize();
  }

  private navigationBlocked() {
    const active = document.activeElement;
    return document.hidden || !!document.querySelector('dialog[open]')
      || (active instanceof HTMLElement && (active.isContentEditable || !!active.closest('input:not([type="range"]), textarea, select')));
  }

  private cancelDrag() {
    this.drag = undefined;
    this.areaPreview.visible = false;
    this.updatePreview();
    this.render();
  }

  private stopMovement() {
    this.movementKeys.clear();
    if (this.movementFrame !== undefined) cancelAnimationFrame(this.movementFrame);
    this.movementFrame = undefined;
  }

  private moveCamera(time: number) {
    if (this.navigationBlocked()) { this.stopMovement(); return; }
    const seconds = Math.min((time - this.movementTime) / 1000, 0.05);
    this.movementTime = time;
    const horizontal = Number(this.movementKeys.has('KeyD')) - Number(this.movementKeys.has('KeyA'));
    const forward = Number(this.movementKeys.has('KeyW')) - Number(this.movementKeys.has('KeyS'));
    // Project screen-right onto the ground; its perpendicular also works in top view.
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();
    const ahead = new THREE.Vector3(right.z, 0, -right.x);
    const offset = right.multiplyScalar(horizontal).addScaledVector(ahead, forward);
    offset.normalize().multiplyScalar(seconds * 10 * this.movementSpeed * Math.max(1, this.gridSize / 32) / this.camera.zoom);
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.controls.update();
    this.movementFrame = requestAnimationFrame(next => this.moveCamera(next));
  }

  private box(group: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, color: string) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  private gameModel(group: THREE.Group, type: ObjectDefinition, color: string) {
    const [w, h, d] = type.size;
    if (type.kind === 'district-center') {
      this.box(group, w - 0.08, 1.8, d - 0.08, 0, 0.9, 0, color);
      this.box(group, w, 0.2, d, 0, 1.9, 0, '#636c51');
      this.box(group, 0.75, 2.9, 0.75, 0, 3.45, 0, '#857952');
      this.box(group, 1.1, 0.1, 1.1, 0, h - 0.05, 0, '#526b58');
      this.box(group, 0.06, 1.2, 0.06, 0.45, 2.6, -1, '#4d5847');
      this.box(group, 0.62, 0.42, 0.045, 0.75, 2.95, -1, '#dfb559');
    } else if (type.kind === 'tree') {
      this.box(group, 0.18, h * 0.65, 0.18, 0, h * 0.325, 0, '#947555');
      if (type.id === 'Pine') {
        for (let n = 0; n < 3; n++) {
          const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.46 - n * 0.08, h * 0.48, 6), new THREE.MeshStandardMaterial({ color }));
          mesh.position.y = h * (0.44 + n * 0.16);
          mesh.castShadow = true;
          group.add(mesh);
        }
      } else {
        this.box(group, 0.88, h * 0.53, 0.88, 0, h * 0.7, 0, color);
        this.box(group, 0.64, h * 0.24, 0.64, 0, h * 0.86, 0, color);
      }
    } else if (type.kind === 'crop' || type.kind === 'bush') {
      this.box(group, 0.86, 0.04, 0.86, 0, 0.02, 0, '#a39164');
      const aquatic = (type.game?.plant?.flooding?.MinWaterHeight ?? 0) > 0;
      const plantColor = aquatic ? '#779c8a' : color;
      if (type.kind === 'bush') {
        this.box(group, 0.8, h * 0.64, 0.8, 0, h * 0.4, 0, plantColor);
        for (const x of [-0.22, 0.22]) this.box(group, 0.13, 0.13, 0.13, x, h * 0.74, 0, '#b08b6d');
      } else {
        for (const x of [-0.23, 0.23]) for (const z of [-0.23, 0.23]) {
          this.box(group, 0.07, h * 0.7, 0.07, x, h * 0.35, z, '#75804c');
          this.box(group, 0.25, h * 0.3, 0.23, x, h * 0.65, z, plantColor);
        }
      }
    } else if (type.kind === 'platform') {
      for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) this.box(group, 0.13, h - 0.1, 0.13, x, (h - 0.1) / 2, z, '#8f7858');
      this.box(group, w, 0.16, d, 0, h - 0.08, 0, color);
    } else if (type.kind === 'stairs') {
      for (let n = 0; n < 5; n++) this.box(group, 0.94, (n + 1) / 5, 0.2, 0, (n + 1) / 10, 0.4 - n * 0.2, color);
    } else if (type.kind === 'path') {
      this.box(group, 0.96, 0.12, 0.96, 0, 0.06, 0, color);
    } else if (type.kind === 'tank') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) / 2 - 0.06, Math.min(w, d) / 2 - 0.06, h - 0.08, 16), new THREE.MeshStandardMaterial({ color }));
      mesh.position.y = h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      this.box(group, w * 0.8, 0.08, d * 0.8, 0, h - 0.04, 0, '#c6d0c3');
    } else if (type.kind === 'pile') {
      this.box(group, w, 0.12, d, 0, 0.06, 0, '#786749');
      for (let n = 0; n < 3; n++) this.box(group, w - 0.2, 0.55, d / 4, 0, 0.39, (n - 1) * d / 3, color);
      if (type.supportHeight) this.box(group, w, 0.15, d, 0, h - 0.075, 0, '#767d79');
    } else {
      this.box(group, w - 0.06, h - 0.12, d - 0.06, 0, (h - 0.12) / 2, 0, color);
      this.box(group, w, 0.12, d, 0, h - 0.06, 0, type.kind === 'house' ? '#506b5c' : '#786749');
      for (let level = 0; level < h; level++) {
        for (let x = 0; x < w; x++) this.box(group, 0.3, 0.3, 0.04, x + 0.5 - w / 2, level + 0.58, d / 2, '#d8c9a0');
      }
    }
    // The source entrance sits outside the footprint. A door and orange landing
    // distinguish it from the rear windows, including upper-level entrances.
    if (type.entrance) {
      const e = type.entrance;
      this.box(group, 0.38, 0.65, 0.045, e.x + 0.5 - w / 2, e.y + 0.325, -d / 2, '#3d493e');
      const marker = this.box(group, 0.65, 0.045, 0.5, e.x + 0.5 - w / 2, e.y + 0.025, -d / 2 - 0.25, '#d4a15f');
      marker.userData.decoration = true;
    }
  }

  private model(item: Placement) {
    const type = definition(item.objectType);
    const [w, h, d] = type.size;
    const group = new THREE.Group();
    const color = this.blueprint?.faction === 'iron-teeth' && type.kind === 'house' ? '#8c979d' : type.color;
    if (type.game) {
      this.gameModel(group, type, color);
    } else if (type.kind === 'platform') {
      for (const x of [-0.36, 0.36]) for (const z of [-0.36, 0.36]) this.box(group, 0.13, h - 0.1, 0.13, x, h / 2, z, '#8f7858');
      this.box(group, 0.98, 0.16, 0.98, 0, h - 0.08, 0, color);
    } else if (type.kind === 'stairs') {
      for (let i = 0; i < 5; i++) this.box(group, 0.94, (i + 1) / 5, 0.2, 0, (i + 1) / 10, 0.4 - i * 0.2, color);
    } else if (type.kind === 'tank') {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.87, 0.87, h - 0.12, 16), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
      mesh.position.y = h / 2;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const y of [0.35, 1.5]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.055, 4, 16), new THREE.MeshStandardMaterial({ color: '#d5ceb8' }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y;
        group.add(ring);
      }
    } else if (type.kind === 'path') {
      this.box(group, 0.96, h, 0.96, 0, h / 2, 0, color);
    } else {
      this.box(group, w - 0.08, h - 0.15, d - 0.08, 0, (h - 0.15) / 2, 0, color);
      this.box(group, w, 0.15, d, 0, h - 0.075, 0, type.kind === 'house' ? '#4d6858' : '#786749');
      this.box(group, w - 0.02, 0.12, d - 0.02, 0, 0.13, 0, '#b9aa85');
      if (type.kind === 'house') {
        for (const x of [-0.8, 0.8]) {
          this.box(group, 0.42, 0.58, 0.035, x, 1.1, d / 2 - 0.02, '#e9dcb2');
          this.box(group, 0.035, 0.58, 0.45, -w / 2 + 0.02, 1.1, x / 2, '#e9dcb2');
        }
        this.box(group, 0.4, 0.75, 0.04, 0, 0.5, d / 2 - 0.01, '#394b3e');
      } else {
        for (let x = -1; x <= 1; x++) this.box(group, 0.1, h - 0.2, 0.08, x, h / 2, d / 2, '#d1b48c');
        this.box(group, 1.05, 1.15, 0.1, 0, 0.7, d / 2, '#887047');
      }
    }
    const [rw, , rd] = footprint(item);
    group.position.set(item.position.x + rw / 2 - this.gridSize / 2, item.position.y, item.position.z + rd / 2 - this.gridSize / 2);
    group.rotation.y = -item.rotation * Math.PI / 180;
    group.userData.id = item.id;
    group.visible = !this.cut || item.position.y <= this.floor;
    return group;
  }

  update(blueprint: Blueprint, selected: string | undefined, floor: number, cut: boolean, problemIds: Set<string>, connectionStates = new Map<string, ConnectionState>()) {
    this.drag = undefined;
    this.blueprint = blueprint;
    const resized = this.gridSize !== blueprint.gridSize;
    if (resized) this.resizeGrid(blueprint.gridSize);
    this.selected = selected;
    this.floor = floor;
    this.cut = cut;
    this.city.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        (node.material as THREE.Material).dispose();
      }
    });
    this.city.clear();
    for (const item of blueprint.objects) {
      const model = this.model(item);
      const state = connectionStates.get(item.id);
      if (state) {
        const color = new THREE.Color(connectionColors[state]);
        model.traverse(node => {
          if (node instanceof THREE.Mesh) (node.material as THREE.MeshStandardMaterial).color.lerp(color, 0.72);
        });
      }
      this.city.add(model);
    }
    this.problemOutlines.children.forEach(node => (node as THREE.Box3Helper).dispose());
    this.problemOutlines.clear();
    for (const group of this.city.children) {
      if (group.visible && problemIds.has(group.userData.id)) {
        this.problemOutlines.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(group).expandByScalar(0.08), 0xc74f40));
      }
    }
    if (this.outline) { this.scene.remove(this.outline); this.outline.dispose(); this.outline = undefined; }
    const selectedGroup = this.city.children.find(item => item.userData.id === selected && item.visible);
    if (selectedGroup) {
      const box = new THREE.Box3().setFromObject(selectedGroup).expandByScalar(0.06);
      this.outline = new THREE.Box3Helper(box, 0xe5a85e);
      this.scene.add(this.outline);
    }
    this.levelGrid.position.y = floor + 0.01;
    this.levelGrid.visible = floor > 0;
    this.city.updateMatrixWorld(true);
    if (resized) this.setView(this.view);
    this.updatePreview();
    this.render();
  }

  setTool(tool: string, rotation: Placement['rotation']) {
    if (tool !== this.tool || rotation !== this.rotation) this.drag = undefined;
    this.tool = tool;
    this.rotation = rotation;
    this.controls.mouseButtons.LEFT = tool === 'select' ? THREE.MOUSE.ROTATE : null as unknown as THREE.MOUSE;
    this.canvas.style.cursor = tool === 'select' ? 'grab' : 'crosshair';
    this.updatePreview();
    this.render();
  }

  setView(view: 'iso' | 'top') {
    this.view = view;
    const scale = Math.max(1, this.gridSize / 32);
    this.controls.target.set(0, 1, 0);
    this.camera.position.set(view === 'top' ? 0 : 30 * scale, (view === 'top' ? 50 : 28) * scale, view === 'top' ? 0.01 : 34 * scale);
    this.camera.zoom = 1;
    this.controls.update();
    this.resize();
  }

  zoom(factor: number) {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, this.controls.minZoom, this.controls.maxZoom);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  setMovementSpeed(multiplier: number) {
    this.movementSpeed = THREE.MathUtils.clamp(multiplier, 1, 3);
  }

  toggleGrid(visible: boolean) { this.grid.visible = visible; this.render(); }

  private setRay(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private objectHit() {
    for (const hit of this.raycaster.intersectObjects(this.city.children, true)) {
      if (hit.object.userData.decoration) continue;
      let group: THREE.Object3D | null = hit.object;
      let visible = true;
      while (group && group.parent !== this.city) {
        visible &&= group.visible;
        group = group.parent;
      }
      if (group?.visible && visible) return { hit, group };
    }
  }

  private prepareGhost() {
    const key = `${this.tool}:${this.blueprint?.faction}`;
    if (this.ghostKey === key) return;
    this.ghost.traverse(node => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(material => material.dispose());
      }
    });
    this.ghost.clear();
    const model = this.model({ id: '', objectType: this.tool, position: { x: 0, y: 0, z: 0 }, rotation: 0 });
    model.position.set(0, 0, 0);
    const meshes: THREE.Mesh[] = [];
    model.traverse(node => { if (node instanceof THREE.Mesh) meshes.push(node); });
    for (const mesh of meshes) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = 0.76;
      material.depthWrite = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x395942, transparent: true, opacity: 0.7 }));
      mesh.add(edges);
    }
    this.ghost.add(model);

    const [w, h, d] = definition(this.tool).size;
    const footprintLine = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-w / 2, 0.025, -d / 2), new THREE.Vector3(w / 2, 0.025, -d / 2),
        new THREE.Vector3(w / 2, 0.025, d / 2), new THREE.Vector3(-w / 2, 0.025, d / 2),
      ]),
      new THREE.LineBasicMaterial({ color: 0x44744d }),
    );
    this.ghost.add(footprintLine);
    const type = definition(this.tool);
    // Source front / stair ascent is -Z after converting game XY to web XZ.
    const front = new THREE.ArrowHelper(new THREE.Vector3(0, 0, type.game ? -1 : 1), new THREE.Vector3(0, h + 0.12, 0), d / 2 + 0.55, 0xe6a43a, 0.38, 0.28);
    // Own these geometries: ArrowHelper internally shares its defaults across instances.
    front.line.geometry = front.line.geometry.clone();
    front.cone.geometry = front.cone.geometry.clone();
    this.ghost.add(front);
    front.visible = type.category !== 'plants';
    this.ghost.traverse(node => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
        const material = node.material as THREE.MeshBasicMaterial;
        material.userData.previewColor = material.color.getHex();
      }
    });
    this.ghostBlocked = undefined;
    this.ghostKey = key;
  }

  private updatePreview() {
    this.ghost.visible = false;
    this.areaPreview.visible = false;
    this.readout.hidden = true;
    this.hovered = undefined;
    if (!this.lastPointer) { this.onHover(); return; }
    const canvasRect = this.canvas.getBoundingClientRect();
    if (this.lastPointer.clientX < canvasRect.left || this.lastPointer.clientX >= canvasRect.right
      || this.lastPointer.clientY < canvasRect.top || this.lastPointer.clientY >= canvasRect.bottom) { this.onHover(); return; }
    this.camera.updateMatrixWorld();
    this.setRay(this.lastPointer);
    const intersection = new THREE.Vector3();
    // Viewing a high layer must not turn automatic placement into a height lock.
    const planeHeight = this.drag ? this.drag.start.y : this.tool === 'select' || this.lastPointer.shiftKey ? this.floor : 0;
    let hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight), intersection);
    let y = planeHeight;
    let surface = false;
    if (!this.drag && this.tool !== 'select' && definition(this.tool).category !== 'plants' && !this.lastPointer.shiftKey) {
      const object = this.objectHit();
      const normal = object?.hit.face?.normal.clone().transformDirection(object.hit.object.matrixWorld);
      const placement = this.blueprint?.objects.find(item => item.id === object?.group.userData.id);
      const type = placement ? definition(placement.objectType) : undefined;
      const support = type?.game ? type.supportHeight : type && type.kind !== 'path' ? type.size[1] : undefined;
      if (object && normal && normal.y > 0.5 && placement && support !== undefined
        && (!type?.game || Math.abs(object.hit.point.y - placement.position.y - support) < 0.15)) {
        const top = Math.round(placement.position.y + support);
        intersection.copy(object.hit.point);
        hit = intersection;
        y = top;
        surface = true;
      }
    }
    const x = Math.floor(intersection.x + this.gridSize / 2);
    const z = Math.floor(intersection.z + this.gridSize / 2);
    this.hovered = hit && x >= 0 && x < this.gridSize && z >= 0 && z < this.gridSize && y <= 12 ? { x, y, z } : undefined;
    this.onHover(this.hovered);
    if (this.drag?.moved && this.hovered && this.blueprint) {
      const candidates = dragPlacements(this.tool, this.rotation, this.drag.start, this.hovered);
      const problem = batchPlacementProblem(candidates, this.blueprint.objects, this.blueprint.gridSize);
      const [w, h, d] = footprint(candidates[0]);
      const matrix = new THREE.Matrix4();
      candidates.forEach((item, index) => {
        matrix.makeScale(w - 0.08, h, d - 0.08);
        matrix.setPosition(item.position.x + w / 2 - this.gridSize / 2, y + h / 2, item.position.z + d / 2 - this.gridSize / 2);
        this.areaPreview.setMatrixAt(index, matrix);
      });
      this.areaPreview.count = candidates.length;
      this.areaPreview.instanceMatrix.needsUpdate = true;
      this.areaPreview.material.color.set(problem ? '#cb5145' : '#70975a');
      this.areaPreview.material.depthTest = !problem;
      this.areaPreview.visible = true;
      this.readout.style.left = `${Math.max(4, Math.min(canvasRect.width - 290, this.lastPointer.clientX - canvasRect.left + 18))}px`;
      this.readout.style.top = `${Math.min(canvasRect.height - 60, this.lastPointer.clientY - canvasRect.top + 20)}px`;
      this.readout.textContent = `${candidates.length}개 · ${y}층 · ${problem ? '전체 배치 불가 · ' + (problem.kind === 'overlap' ? '겹침' : problem.kind === 'limit' ? '1만 개 한도' : '범위 초과') : '놓으면 설치'} · 우클릭 취소`;
      this.readout.classList.toggle('blocked', !!problem);
      this.readout.hidden = false;
      return;
    }
    this.ghost.visible = this.tool !== 'select' && !!this.hovered;
    if (this.ghost.visible) {
      this.prepareGhost();
      const candidate: Placement = { id: '', objectType: this.tool, position: { x, y, z }, rotation: this.rotation };
      const [w, h, d] = footprint(candidate);
      const problem = this.blueprint ? placementProblem(candidate, this.blueprint.objects, this.blueprint.gridSize) : undefined;
      const blocked = !!problem;
      if (this.ghostBlocked !== blocked) {
        this.ghost.traverse(node => {
          if (node instanceof THREE.Mesh || node instanceof THREE.Line) {
            const material = node.material as THREE.MeshBasicMaterial;
            material.color.setHex(blocked ? 0xcb5145 : material.userData.previewColor);
            material.depthTest = !blocked;
          }
        });
        this.ghostBlocked = blocked;
      }
      this.ghost.position.set(x + w / 2 - this.gridSize / 2, y, z + d / 2 - this.gridSize / 2);
      this.ghost.rotation.y = -this.rotation * Math.PI / 180;
      const rect = this.canvas.getBoundingClientRect();
      this.readout.style.left = `${Math.min(rect.width - 180, this.lastPointer.clientX - rect.left + 18)}px`;
      this.readout.style.top = `${Math.min(rect.height - 60, this.lastPointer.clientY - rect.top + 20)}px`;
      this.readout.textContent = problem
        ? `${problem.kind === 'overlap' ? '겹침' : problem.kind === 'limit' ? '1만 개 한도' : '범위 초과'} · 배치 불가 · ${y}층`
        : `${surface ? '표면' : this.lastPointer.shiftKey ? '지정 높이' : '바닥'} · ${y}층 · ${w} × ${d} · ${this.rotation}°`;
      this.readout.classList.toggle('blocked', blocked);
      this.readout.hidden = false;
    }
  }

  private pointerMove(event: PointerEvent) {
    if (this.drag && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) this.drag.moved = true;
    this.lastPointer = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
    this.updatePreview();
    this.render();
  }

  private resizeGrid(size: number) {
    this.gridSize = size;
    this.base.scale.set(size / 32, 1, size / 32);
    for (const { grid, center, color } of [
      { grid: this.grid, center: 0xaaa99d, color: 0xc8c8ba },
      { grid: this.levelGrid, center: 0x74a88c, color: 0xabc5b3 },
    ]) {
      const replacement = new THREE.GridHelper(size, size, center, color);
      grid.geometry.dispose();
      grid.geometry = replacement.geometry;
      (replacement.material as THREE.Material).dispose();
    }
    const scale = Math.max(1, size / 32);
    this.controls.maxZoom = 4 * scale;
    this.sun.position.set(-18 * scale, 30 * scale, 18 * scale);
    const camera = this.sun.shadow.camera;
    camera.left = camera.bottom = -25 * scale;
    camera.right = camera.top = 25 * scale;
    camera.far = 500 * scale;
    camera.updateProjectionMatrix();
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    // The isometric diagonal is wider than the top view; fit the whole large floor.
    const halfWidth = Math.max(19, 17 * aspect) * Math.max(1, this.gridSize / 32)
      * (this.view === 'iso' && this.gridSize > 32 ? 1.45 : 1);
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfWidth / aspect;
    this.camera.bottom = -halfWidth / aspect;
    this.camera.updateProjectionMatrix();
    this.updatePreview();
    this.render();
  }

  private render() { this.renderer.render(this.scene, this.camera); }
}
