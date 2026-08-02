/**
 * 指やマウスの操作を、殴る位置とカメラの動きに変える。
 *
 *  ・触れた瞬間に1発（すぐ手応えが返る）
 *  ・そのまま動かすと石像が回る
 *  ・止めたまま押し続けると溜まり、たまると渾身の一撃
 *  ・2本指で近づけたり離したりすると寄り引きできる
 */

/** 渾身の一撃が出るまでの押しっぱなし時間（ミリ秒） */
export const CHARGE_MS = 520;
/** ここを超えて動かしたら「回す」操作とみなす（画面の短辺に対する割合） */
export const DRAG_RATIO = 0.022;

export interface PunchRequest {
  x: number;
  y: number;
}

interface Touch {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  chargeStart: number;
  dragging: boolean;
}

export interface InputHandlers {
  punch: (punch: PunchRequest, heavy: boolean) => void;
  orbit: (dx: number, dy: number) => void;
  zoom: (factor: number) => void;
  release: () => void;
  firstTouch: () => void;
}

export class PointerInput {
  private readonly touches = new Map<number, Touch>();
  private enabled = false;
  private pinchDistance = 0;

  constructor(
    private readonly element: HTMLElement,
    private readonly size: () => { width: number; height: number },
    private readonly handlers: InputHandlers,
  ) {
    element.addEventListener('pointerdown', this.handleDown);
    element.addEventListener('pointermove', this.handleMove);
    element.addEventListener('pointerup', this.handleUp);
    element.addEventListener('pointercancel', this.handleUp);
    element.addEventListener('contextmenu', this.preventDefault);
    element.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) {
      this.touches.clear();
      this.pinchDistance = 0;
    }
  }

  /** 押しっぱなしの溜まり具合（0〜1）。回している間は 0 */
  get charge(): number {
    if (this.touches.size !== 1) return 0;
    const now = performance.now();
    for (const touch of this.touches.values()) {
      if (touch.dragging) return 0;
      return Math.min(1, (now - touch.chargeStart) / CHARGE_MS);
    }
    return 0;
  }

  /** 毎フレーム呼ぶ。溜まりきった指があれば強打を出す */
  update(now: number): void {
    if (!this.enabled || this.touches.size !== 1) return;
    for (const touch of this.touches.values()) {
      if (touch.dragging) continue;
      if (now - touch.chargeStart >= CHARGE_MS) {
        touch.chargeStart = now;
        this.handlers.punch({ x: touch.x, y: touch.y }, true);
      }
    }
  }

  dispose(): void {
    const element = this.element;
    element.removeEventListener('pointerdown', this.handleDown);
    element.removeEventListener('pointermove', this.handleMove);
    element.removeEventListener('pointerup', this.handleUp);
    element.removeEventListener('pointercancel', this.handleUp);
    element.removeEventListener('contextmenu', this.preventDefault);
    element.removeEventListener('wheel', this.handleWheel);
  }

  private preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  /**
   * ボタンや案内画面の上で始まった操作は、こちらでは扱わない。
   * ここで捕まえてしまうと、押した先のボタンが反応しなくなる。
   */
  private onWidget(event: PointerEvent): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    return target.closest('button, a, input, .screen, [data-ui]') !== null;
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dragThreshold(): number {
    const { width, height } = this.size();
    return Math.min(width, height) * DRAG_RATIO;
  }

  private handleDown = (event: PointerEvent): void => {
    // ボタンを押したときも音を出せるようにしておく（iPad で最初に必要）
    this.handlers.firstTouch();
    if (!this.enabled || this.onWidget(event)) return;
    event.preventDefault();
    const point = this.local(event);
    this.touches.set(event.pointerId, {
      id: event.pointerId,
      x: point.x,
      y: point.y,
      startX: point.x,
      startY: point.y,
      lastX: point.x,
      lastY: point.y,
      chargeStart: performance.now(),
      dragging: false,
    });
    this.element.setPointerCapture?.(event.pointerId);

    if (this.touches.size === 2) {
      this.pinchDistance = this.currentPinch();
      // 2本目が触れたら回転・殴打はいったん止めて寄り引きに専念する
      for (const touch of this.touches.values()) touch.dragging = true;
      return;
    }
    if (this.touches.size === 1) {
      this.handlers.punch({ x: point.x, y: point.y }, false);
    }
  };

  private handleMove = (event: PointerEvent): void => {
    if (!this.enabled) return;
    const touch = this.touches.get(event.pointerId);
    if (!touch) return;
    const point = this.local(event);
    const dx = point.x - touch.lastX;
    const dy = point.y - touch.lastY;
    touch.x = point.x;
    touch.y = point.y;
    touch.lastX = point.x;
    touch.lastY = point.y;

    if (this.touches.size >= 2) {
      const distance = this.currentPinch();
      if (this.pinchDistance > 0 && distance > 0) {
        this.handlers.zoom(distance / this.pinchDistance);
      }
      this.pinchDistance = distance;
      return;
    }

    if (!touch.dragging) {
      const moved = Math.hypot(point.x - touch.startX, point.y - touch.startY);
      if (moved > this.dragThreshold()) touch.dragging = true;
    }
    if (touch.dragging) {
      const { width, height } = this.size();
      const scale = 2.6 / Math.min(width, height);
      this.handlers.orbit(dx * scale, dy * scale);
    }
  };

  private handleUp = (event: PointerEvent): void => {
    this.touches.delete(event.pointerId);
    if (this.touches.size < 2) this.pinchDistance = 0;
    if (this.touches.size === 0) this.handlers.release();
  };

  private handleWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    // トラックパッドのつまむ操作は ctrl 付きで来る。細かく効かせたいので刻みは小さめ
    const strength = event.ctrlKey ? 0.006 : 0.0008;
    const amount = Math.max(-120, Math.min(120, event.deltaY));
    this.handlers.zoom(Math.exp(-amount * strength));
  };

  private currentPinch(): number {
    const list = Array.from(this.touches.values());
    if (list.length < 2) return 0;
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  }
}

export interface KeyHandlers {
  punchCenter: (heavy: boolean) => void;
  orbit: (dx: number, dy: number) => void;
  zoom: (factor: number) => void;
  restart: () => void;
  title: () => void;
}

/** パソコンでの操作。押しっぱなしにも対応する */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private enabled = false;

  constructor(private readonly handlers: KeyHandlers) {
    window.addEventListener('keydown', this.handleDown);
    window.addEventListener('keyup', this.handleUp);
    window.addEventListener('blur', this.clear);
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    this.held.clear();
  }

  /** 毎フレーム呼ぶ。押しっぱなしの回転と拡大を進める */
  update(dt: number): void {
    if (!this.enabled) return;
    const speed = 1.8 * dt;
    let dx = 0;
    let dy = 0;
    if (this.held.has('ArrowLeft')) dx -= speed;
    if (this.held.has('ArrowRight')) dx += speed;
    if (this.held.has('ArrowUp')) dy -= speed;
    if (this.held.has('ArrowDown')) dy += speed;
    if (dx !== 0 || dy !== 0) this.handlers.orbit(dx, dy);

    let zoom = 0;
    if (this.held.has('Equal') || this.held.has('NumpadAdd')) zoom += 1;
    if (this.held.has('Minus') || this.held.has('NumpadSubtract')) zoom -= 1;
    if (zoom !== 0) this.handlers.zoom(Math.exp(zoom * dt * 1.6));
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleDown);
    window.removeEventListener('keyup', this.handleUp);
    window.removeEventListener('blur', this.clear);
  }

  private clear = (): void => {
    this.held.clear();
  };

  private handleDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (event.code === 'Escape') {
      this.handlers.title();
      return;
    }
    if (!this.enabled) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      this.handlers.punchCenter(event.shiftKey);
      return;
    }
    if (event.code === 'KeyR') {
      this.handlers.restart();
      return;
    }
    this.held.add(event.code);
  };

  private handleUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };
}
