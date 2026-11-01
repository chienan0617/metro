/**
 * 可重現的 Perlin（柏林）梯度雜訊。
 * 無固定邊界（無限域），所有輸出只取決於 seed 與座標，
 * 適合用來生成無限大的地形、溫度與濕度場。
 */

/** 將整數座標雜湊為 32 位元無號整數（穩定且快速）。 */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

/** 由雜湊取得單位圓上的梯度向量（8 方向查表，便宜且穩定）。 */
const GRAD_X = [1, -1, 1, -1, 1, -1, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 1, -1];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class PerlinNoise {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** 柏林雜訊，輸出大致落在 [-1, 1]。 */
  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);

    const n00 = this.dot(xi, yi, xf, yf);
    const n10 = this.dot(xi + 1, yi, xf - 1, yf);
    const n01 = this.dot(xi, yi + 1, xf, yf - 1);
    const n11 = this.dot(xi + 1, yi + 1, xf - 1, yf - 1);

    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return a + (b - a) * v;
  }

  /** 多層次分形雜訊（fBm），輸出大致落在 [-1, 1]。 */
  fbm(x: number, y: number, octaves = 3, lacunarity = 2.07, persistence = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** 脊狀雜訊（山脈感）：1 - |noise| 疊加。 */
  ridged(x: number, y: number, octaves = 3): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += amp * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.05;
    }
    return sum / norm;
  }

  private dot(ix: number, iy: number, dx: number, dy: number): number {
    const g = hash2(this.seed, ix, iy) & 7;
    return (GRAD_X[g] as number) * dx + (GRAD_Y[g] as number) * dy;
  }
}
