/**
 * 模擬驅動器：把真實時間轉換為固定步進的遊戲分鐘。
 * 畫面每一幀呼叫 update()，模擬內部維持獨立的時間累加器與步數上限。
 */

import type { GameState } from "../core/types.ts";
import { TIME_CONFIG } from "./config.ts";
import { stepMinute } from "./simulation.ts";

const MAX_REAL_DELTA_SECONDS = 0.5;

export class SimulationRunner {
  private state: GameState;
  private accumulator = 0;
  private lastSteppedMinutes = 0;

  constructor(state: GameState) {
    this.state = state;
  }

  /** 推進模擬；回傳本次實際推進了幾個遊戲分鐘。 */
  update(dtSeconds: number): number {
    const speed = this.state.clock.speed;
    if (speed === 0) {
      return 0;
    }
    const dt = Math.min(Math.max(dtSeconds, 0), MAX_REAL_DELTA_SECONDS);
    this.accumulator += dt * TIME_CONFIG.minutesPerSecond * speed;

    let steps = Math.floor(this.accumulator);
    this.accumulator -= steps;
    if (steps <= 0) {
      return 0;
    }
    if (steps > TIME_CONFIG.maxStepsPerUpdate) {
      // 明確策略：落後太多時放棄補算，避免分頁切回造成大量計算。
      steps = TIME_CONFIG.maxStepsPerUpdate;
      this.accumulator = 0;
    }
    for (let i = 0; i < steps; i++) {
      stepMinute(this.state);
    }
    this.lastSteppedMinutes += steps;
    return steps;
  }

  get totalSteppedMinutes(): number {
    return this.lastSteppedMinutes;
  }
}
