import type { DispatchVehicle, RouteStop, VehicleRoute } from '../types/dispatch';

/** Base vehicle speed in m/s (motor vehicle on campus). */
const BASE_VEHICLE_SPEED_MPS = 5;

/** Time to load/unload one bike, in seconds (~35s per bike). */
const LOAD_UNLOAD_TIME_PER_BIKE_S = 35;

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
 * Peak hours slow vehicles down on campus roads.
 */
function congestionFactor(hour: number): number {
  // Morning 7-9, lunch 11-13, afternoon 16-18
  if ((hour >= 7 && hour <= 8) || (hour >= 11 && hour <= 12) || (hour >= 16 && hour <= 17)) {
    return 0.75;
  }
  // Mild congestion around peaks
  if ((hour >= 9 && hour <= 10) || (hour >= 13 && hour <= 14) || (hour >= 15 && hour <= 15)) {
    return 0.88;
  }
  return 1.0;
}

function effectiveVehicleSpeed(env?: DispatchEnvironment): number {
  const weatherFactor = env?.weatherSpeedFactor ?? 1.0;
  const congestion = congestionFactor(env?.hour ?? 12);
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
 * Load/unload time for a given number of bikes at a station.
 */
function loadUnloadTimeMs(bikeCount: number): number {
  return bikeCount * LOAD_UNLOAD_TIME_PER_BIKE_S * 1000;
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
    currentTimeMs += loadUnloadTimeMs(stop.bike_count);
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
