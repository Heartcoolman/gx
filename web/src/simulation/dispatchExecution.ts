import type { DispatchVehicle, RouteStop, VehicleRoute } from '../types/dispatch';
import { congestionCoefficient } from './ridingModel';

/** Base vehicle speed in m/s (motor vehicle on campus). */
const BASE_VEHICLE_SPEED_MPS = 5;

/** @deprecated Replaced by variableLoadUnloadTimeMs */
const _LOAD_UNLOAD_TIME_PER_BIKE_S = 35; void _LOAD_UNLOAD_TIME_PER_BIKE_S;

export interface DispatchEnvironment {
  /** Hour of day (0-23) for congestion calculation. */
  hour?: number;
  /** Weather factor: 'clear' = 1.0, 'rain' = 0.8, 'storm' = 0.6. */
  weatherSpeedFactor?: number;
}

export interface PlannedDispatchStop {
  stop: RouteStop;
  fromStationId: number;
  segmentStartMs: number;
  executeAtMs: number;
}

export interface VehicleDispatchExecution {
  vehicleId: number;
  routeStartMs: number;
  busyUntilMs: number;
  path: number[];
  stops: PlannedDispatchStop[];
  nextStopIndex: number;
}

export interface VehicleAnimationState {
  vehicleId: number;
  path: number[];
  currentSegmentIndex: number;
  progress: number;
}

function distanceBetween(distanceMatrix: number[][], fromStationId: number, toStationId: number): number {
  return distanceMatrix[fromStationId]?.[toStationId] ?? 0;
}

/**
 * Time-of-day congestion factor for dispatch vehicles.
 * @deprecated Replaced by campusVehicleCongestion
 */
function _congestionFactor(hour: number): number {
  const minute = Math.min(Math.max(Math.round(hour * 60), 0), 1439);
  const riderCongestion = congestionCoefficient(minute);
  return 1.0 - (1.0 - riderCongestion) / 0.9;
}
void _congestionFactor;

/**
 * Enhanced campus traffic model for dispatch vehicles.
 * Vehicles are more affected by campus road congestion than bikes.
 * Add lunch-hour and class-change specific vehicle congestion.
 */
function campusVehicleCongestion(slotIndex: number): number {
  const minute = Math.min(Math.max(slotIndex, 0), 1439);
  const baseCongestion = congestionCoefficient(minute);

  // Additional vehicle-specific congestion during class changes
  // Vehicles share narrow campus roads with pedestrians
  const classChangePeaks = [
    { center: 7 * 60 + 50, sigma: 0.3, depth: 0.12 },  // morning class change
    { center: 9 * 60 + 50, sigma: 0.2, depth: 0.08 },   // period break
    { center: 11 * 60 + 50, sigma: 0.3, depth: 0.10 },  // lunch rush
    { center: 13 * 60 + 50, sigma: 0.2, depth: 0.08 },  // afternoon start
    { center: 17 * 60 + 0, sigma: 0.3, depth: 0.10 },   // evening rush
  ];

  let extraReduction = 0;
  for (const peak of classChangePeaks) {
    const dx = (minute - peak.center) / (peak.sigma * 60);
    extraReduction += peak.depth * Math.exp(-0.5 * dx * dx);
  }

  return Math.max(0.4, baseCongestion - extraReduction);
}

/** Weather speed factors for dispatch vehicles (more conservative than bikes) */
function vehicleWeatherSpeedFactor(weatherSpeedFactor?: number): number {
  // Vehicles are heavier and need more braking distance in bad weather
  const base = weatherSpeedFactor ?? 1.0;
  // Amplify the weather penalty for vehicles
  if (base < 0.7) return base * 0.85;  // storm: even slower
  if (base < 0.85) return base * 0.92; // rain: slightly slower
  return base;
}

function effectiveVehicleSpeed(env?: DispatchEnvironment): number {
  const weatherFactor = vehicleWeatherSpeedFactor(env?.weatherSpeedFactor);
  const slotIndex = env?.hour != null ? Math.round(env.hour * 60) : 720;
  const congestion = campusVehicleCongestion(slotIndex);
  return BASE_VEHICLE_SPEED_MPS * weatherFactor * congestion;
}

function travelDurationMs(
  distanceMatrix: number[][],
  fromStationId: number,
  toStationId: number,
  env?: DispatchEnvironment,
): number {
  const distanceMeters = distanceBetween(distanceMatrix, fromStationId, toStationId);
  const speed = effectiveVehicleSpeed(env);
  return (distanceMeters / speed) * 1000;
}

/**
 * Load/unload time with diminishing efficiency.
 * First few bikes are fast, but as the vehicle fills up, each bike takes longer.
 */
function variableLoadUnloadTimeMs(bikeCount: number): number {
  if (bikeCount <= 0) return 0;
  let totalSeconds = 0;
  for (let i = 1; i <= bikeCount; i++) {
    // Base 30s per bike, +2s for each additional bike (crowding penalty)
    totalSeconds += 30 + Math.min(i - 1, 10) * 2;
  }
  return totalSeconds * 1000;
}

export function planVehicleExecution(
  vehicle: DispatchVehicle,
  route: VehicleRoute,
  routeStartMs: number,
  distanceMatrix: number[][],
  env?: DispatchEnvironment,
): VehicleDispatchExecution | null {
  if (route.stops.length === 0) {
    return null;
  }

  const path = [vehicle.current_position];
  const stops: PlannedDispatchStop[] = [];

  let currentStationId = vehicle.current_position;
  let currentTimeMs = routeStartMs;

  for (const stop of route.stops) {
    const segmentStartMs = currentTimeMs;
    // Travel time
    currentTimeMs += travelDurationMs(distanceMatrix, currentStationId, stop.station_id, env);
    // Load/unload time at station
    currentTimeMs += variableLoadUnloadTimeMs(stop.bike_count);
    path.push(stop.station_id);
    stops.push({
      stop,
      fromStationId: currentStationId,
      segmentStartMs,
      executeAtMs: currentTimeMs,
    });
    currentStationId = stop.station_id;
  }

  return {
    vehicleId: vehicle.id,
    routeStartMs,
    busyUntilMs: currentTimeMs,
    path,
    stops,
    nextStopIndex: 0,
  };
}

export function deriveVehicleAnimation(
  execution: VehicleDispatchExecution | null,
  nowMs: number,
): VehicleAnimationState | null {
  if (!execution || execution.path.length < 2 || nowMs >= execution.busyUntilMs) {
    return null;
  }

  const lastSegmentIndex = execution.stops.length - 1;
  let currentSegmentIndex = execution.nextStopIndex;
  if (currentSegmentIndex > lastSegmentIndex) {
    currentSegmentIndex = lastSegmentIndex;
  }

  const segmentStartMs = currentSegmentIndex === 0
    ? execution.routeStartMs
    : execution.stops[currentSegmentIndex - 1].executeAtMs;
  const segmentEndMs = execution.stops[currentSegmentIndex].executeAtMs;
  const segmentDurationMs = Math.max(segmentEndMs - segmentStartMs, 1);
  const progress = Math.min(
    Math.max((nowMs - segmentStartMs) / segmentDurationMs, 0),
    1,
  );

  return {
    vehicleId: execution.vehicleId,
    path: execution.path,
    currentSegmentIndex,
    progress,
  };
}
