/**
 * 極簡狀態容器：遊戲狀態的單一來源，UI 層訂閱後重繪。
 * 模擬邏輯透過 command 函式修改狀態，不得由 UI 直接各自複製狀態。
 */

export type StoreListener<T> = (state: T) => void;

export class Store<T> {
  private state: T;
  private listeners = new Set<StoreListener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  /** 以完整新狀態取代（用於讀檔）。 */
  replace(next: T): void {
    this.state = next;
    this.emit();
  }

  /** 以 mutator 就地修改後通知訂閱者。 */
  update(mutator: (state: T) => void): void {
    mutator(this.state);
    this.emit();
  }

  /** 訂閱狀態變更，回傳取消訂閱函式。 */
  subscribe(listener: StoreListener<T>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 狀態被外部（例如模擬核心）就地修改後，通知訂閱者而不重新指派。 */
  notify(): void {
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
