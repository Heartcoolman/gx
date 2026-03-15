export interface BenchmarkResult {
  totalRides: number;
  blockedCount: number;
  blockRate: number;
  dispatchCount: number;
  totalBikesMoved: number;
  bikeStdDev: number;
  satisfactionRate: number;
  finalBikes: number[];
}

export interface TuningParams {
  vehicleCount: number;
  vehicleCapacity: number;
  rebalanceIntervalMinutes: number;
  safetyBufferRatio: number;
  peakMultiplier: number;
  predictionHorizonSlots: number;
  peakPercentile: number;
}

export interface Snapshot {
  slotIndex: number;
  bikes: number[];
  totalRides: number;
  blockedCount: number;
}
