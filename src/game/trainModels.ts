/**
 * 列車型號資料（可擴充的資料表，非寫死在 UI 中）。
 * 每個型號有不同營運定位：價格、容量、速度、能源、維護與舒適度。
 */

import type { TrainModel } from "../core/types.ts";

export const TRAIN_MODELS: readonly TrainModel[] = [
  {
    id: "lt-1",
    name: "輕軌電車 LT-1",
    manufacturer: "河谷車輛",
    purchasePrice: 140_000,
    capacity: 120,
    maxSpeed: 75,
    energyRate: 0.8,
    maintenanceRate: 480,
    comfort: 6,
    unlockLevel: 1,
  },
  {
    id: "re-2",
    name: "區域電聯車 RE-2",
    manufacturer: "河谷車輛",
    purchasePrice: 320_000,
    capacity: 320,
    maxSpeed: 95,
    energyRate: 1.0,
    maintenanceRate: 940,
    comfort: 7,
    unlockLevel: 1,
  },
  {
    id: "ce-3",
    name: "通勤快線 CE-3",
    manufacturer: "北陸重工",
    purchasePrice: 560_000,
    capacity: 460,
    maxSpeed: 125,
    energyRate: 1.15,
    maintenanceRate: 1_420,
    comfort: 8,
    unlockLevel: 1,
  },
  {
    id: "de-4",
    name: "雙層通勤 DE-4",
    manufacturer: "北陸重工",
    purchasePrice: 820_000,
    capacity: 760,
    maxSpeed: 105,
    energyRate: 1.45,
    maintenanceRate: 2_150,
    comfort: 8,
    unlockLevel: 2,
  },
  {
    id: "ic-5",
    name: "城際特快 IC-5",
    manufacturer: "明石工業",
    purchasePrice: 1_050_000,
    capacity: 540,
    maxSpeed: 170,
    energyRate: 1.3,
    maintenanceRate: 2_600,
    comfort: 9,
    unlockLevel: 3,
  },
  {
    id: "hs-9",
    name: "高速列車 HS-9",
    manufacturer: "明石工業",
    purchasePrice: 1_900_000,
    capacity: 620,
    maxSpeed: 260,
    energyRate: 1.6,
    maintenanceRate: 4_300,
    comfort: 10,
    unlockLevel: 5,
  },
];

export function trainModelById(id: string): TrainModel | undefined {
  return TRAIN_MODELS.find((m) => m.id === id);
}
