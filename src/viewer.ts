import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { definition, footprint, type Blueprint, type Placement } from './data';
import { placementProblem } from './placement';

export class CityViewer {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 300);
  private controls: OrbitControls;
  private city = new THREE.Group();
  private grid = new THREE.GridHelper(32, 32, 0xaaa99d, 0xc8c8ba);
  private levelGrid = new THREE.GridHelper(32, 32, 0x74a88c, 0xabc5b3);
  private ghost = new THREE.Group();
  private ghostKey = '';
  private ghostBlocked?: boolean;
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

  constructor(private container: HTMLElement, private onSelect: (id?: string) => void, private onPlace: (position: Placement['position']) => void, private onHover: (position?: Placement['position']) => void) {
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
    const sun = new THREE.DirectionalLight(0xfff4dd, 3);
    sun.position.set(-18, 30, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -25;
    sun.shadow.camera.right = 25;
    sun.shadow.camera.top = 25;
    sun.shadow.camera.bottom = -25;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    const base = new THREE.Mesh(new THREE.BoxGeometry(32, 0.42, 32), new THREE.MeshStandardMaterial({ color: '#d2d2be', roughness: 1 }));
    base.position.y = -0.25;
    base.receiveShadow = true;
    this.scene.add(base);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#eaece3', roughness: 1 }));
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
    this.ghost.visible = false;
    this.canvas.addEventListener('pointerdown', event => { this.pointerStart = { x: event.clientX, y: event.clientY }; });
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
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stopMovement(); });
    window.addEventListener('blur', () => { this.stopMovement(); this.lastPointer = undefined; this.updatePreview(); this.render(); });
    this.canvas.addEventListener('pointerup', event => {
      if (event.button !== 0 || Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) > 5) return;
      this.setRay(event);
      if (this.tool !== 'select') {
        this.pointerMove(event);
        if (this.hovered) this.onPlace({ ...this.hovered });
      } else {
        this.onSelect(this.objectHit()?.group.userData.id);
      }
    });
    new ResizeObserver(() => this.resize()).observe(container);
    this.setView('iso');
    this.resize();
  }

  private navigationBlocked() {
    const active = document.activeElement;
    return document.hidden || !!document.querySelector('dialog[open]')
      || (active instanceof HTMLElement && (active.isContentEditable || !!active.closest('input:not([type="range"]), textarea, select')));
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
    offset.normalize().multiplyScalar(seconds * 10 * this.movementSpeed / this.camera.zoom);
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

  private model(item: Placement) {
    const type = definition(item.objectType);
    const [w, h, d] = type.size;
    const group = new THREE.Group();
    const color = this.blueprint?.faction === 'iron-teeth' && type.kind === 'house' ? '#8c979d' : type.color;
    if (type.kind === 'platform') {
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
    group.position.set(item.position.x + rw / 2 - 16, item.position.y, item.position.z + rd / 2 - 16);
    group.rotation.y = -item.rotation * Math.PI / 180;
    group.userData.id = item.id;
    group.visible = !this.cut || item.position.y <= this.floor;
    return group;
  }

  update(blueprint: Blueprint, selected: string | undefined, floor: number, cut: boolean, problemIds: Set<string>) {
    this.blueprint = blueprint;
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
    for (const item of blueprint.objects) this.city.add(this.model(item));
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
    this.updatePreview();
    this.render();
  }

  setTool(tool: string, rotation: Placement['rotation']) {
    this.tool = tool;
    this.rotation = rotation;
    this.controls.mouseButtons.LEFT = tool === 'select' ? THREE.MOUSE.ROTATE : null as unknown as THREE.MOUSE;
    this.canvas.style.cursor = tool === 'select' ? 'grab' : 'crosshair';
    this.updatePreview();
    this.render();
  }

  setView(view: 'iso' | 'top') {
    this.controls.target.set(0, 1, 0);
    this.camera.position.set(view === 'top' ? 0 : 30, view === 'top' ? 50 : 28, view === 'top' ? 0.01 : 34);
    this.camera.zoom = 1;
    this.controls.update();
    this.resize();
  }

  zoom(factor: number) {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, 0.45, 4);
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
    // Local +Z is the same front used by the placed model; the whole group rotates.
    const front = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, h + 0.12, 0), d / 2 + 0.55, 0xe6a43a, 0.38, 0.28);
    // Own these geometries: ArrowHelper internally shares its defaults across instances.
    front.line.geometry = front.line.geometry.clone();
    front.cone.geometry = front.cone.geometry.clone();
    this.ghost.add(front);
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
    this.readout.hidden = true;
    this.hovered = undefined;
    if (!this.lastPointer) { this.onHover(); return; }
    this.camera.updateMatrixWorld();
    this.setRay(this.lastPointer);
    const intersection = new THREE.Vector3();
    // Viewing a high layer must not turn automatic placement into a height lock.
    const planeHeight = this.tool === 'select' || this.lastPointer.shiftKey ? this.floor : 0;
    let hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeHeight), intersection);
    let y = planeHeight;
    let surface = false;
    if (this.tool !== 'select' && !this.lastPointer.shiftKey) {
      const object = this.objectHit();
      const normal = object?.hit.face?.normal.clone().transformDirection(object.hit.object.matrixWorld);
      const placement = this.blueprint?.objects.find(item => item.id === object?.group.userData.id);
      if (object && normal && normal.y > 0.5 && placement && definition(placement.objectType).kind !== 'path') {
        const top = Math.round(placement.position.y + footprint(placement)[1]);
        intersection.copy(object.hit.point);
        hit = intersection;
        y = top;
        surface = true;
      }
    }
    const x = Math.floor(intersection.x + 16);
    const z = Math.floor(intersection.z + 16);
    this.hovered = hit && x >= 0 && x < 32 && z >= 0 && z < 32 && y <= 12 ? { x, y, z } : undefined;
    this.onHover(this.hovered);
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
      this.ghost.position.set(x + w / 2 - 16, y, z + d / 2 - 16);
      this.ghost.rotation.y = -this.rotation * Math.PI / 180;
      const rect = this.canvas.getBoundingClientRect();
      this.readout.style.left = `${Math.min(rect.width - 180, this.lastPointer.clientX - rect.left + 18)}px`;
      this.readout.style.top = `${Math.min(rect.height - 60, this.lastPointer.clientY - rect.top + 20)}px`;
      this.readout.textContent = problem
        ? `${problem.kind === 'overlap' ? '겹침' : '범위 초과'} · 배치 불가 · ${y}층`
        : `${surface ? '표면' : this.lastPointer.shiftKey ? '지정 높이' : '바닥'} · ${y}층 · ${w} × ${d} · ${this.rotation}°`;
      this.readout.classList.toggle('blocked', blocked);
      this.readout.hidden = false;
    }
  }

  private pointerMove(event: PointerEvent) {
    this.lastPointer = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
    this.updatePreview();
    this.render();
  }

  private resize() {
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const halfWidth = Math.max(19, 17 * aspect);
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
