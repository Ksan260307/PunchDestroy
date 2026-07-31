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

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dragThreshold(): number {
    const { width, height } = this.size();
    return Math.min(width, height) * DRAG_RATIO;
  }

  private handleDown = (event: PointerEvent): void => {
    this.handlers.firstTouch();
    if (!this.enabled) return;
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
    this.handlers.zoom(event.deltaY > 0 ? 0.92 : 1.08);
  };

  private currentPinch(): number {
    const list = Array.from(this.touches.values());
    if (list.length < 2) return 0;
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  }
}
