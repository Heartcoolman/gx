/**
 * Variable riding speed model.
 *
 * Replaces the fixed 3.2m/s + 50s buffer with a realistic model that
 * accounts for distance, weather, rider type, time-of-day congestion,
 * path detour, and dock operations.
 */
import { random } from './rng';
import type { WeatherKind, RidePurpose } from '../types/scenario';

// ── Speed by distance band ──

function baseSpeedForDistance(distanceMeters: number): number {
  if (distanceMeters < 400) return 2.5;     // short trip — slow start/stop
  if (distanceMeters < 1000) return 3.2;    // medium
  return 3.8;                                // long — sustained cruising
}

// ── Weather coefficient ──

function weatherCoefficient(weather: WeatherKind): number {
  switch (weather) {
    case 'storm': return 0.70;
    case 'rain': return 0.85;
    case 'cold_front': return 0.92;
    case 'cloudy': return 0.98;
    case 'clear': return 1.0;
  }
}

// ── Rider purpose coefficient ──

function purposeCoefficient(purpose: RidePurpose): number {
  switch (purpose) {
    case 'class': return 1.10;     // rushing to class
    case 'exercise': return 1.15;  // athletic riders
    case 'commute': return 1.05;   // purposeful
    case 'meal': return 1.0;
    case 'study': return 0.95;
    case 'errand': return 0.95;
    case 'social': return 0.90;    // leisurely
  }
}

// ── Time-of-day congestion coefficient ──

function congestionCoefficient(slotIndex: number): number {
  const hour = Math.floor(slotIndex / 60);
  // Morning peak 7-9, lunch 11-13, afternoon 16-18
  if ((hour >= 7 && hour <= 8) || (hour >= 11 && hour <= 12) || (hour >= 16 && hour <= 17)) {
    return 0.85;
  }
  return 1.0;
}

// ── Constants ──

/** Path detour factor: campus paths ≈ 1.35x straight-line distance. */
const PATH_DETOUR_FACTOR = 1.35;

/** Dock operation time: unlock (15s) + lock (15s) + random 0-20s. */
function dockOperationMs(): number {
  return (15 + 15 + random() * 20) * 1000;
}

/** Random speed jitter: ±15% */
function speedJitter(): number {
  return 0.85 + random() * 0.30;
}

// ── Public API ──

export interface RidingModelParams {
  distanceMeters: number;
  weather: WeatherKind;
  purpose: RidePurpose;
  slotIndex: number;
  travelTimeMultiplier: number;
}

/**
 * Compute realistic travel duration in milliseconds.
 *
 * Replaces the old `(distance / 3.2) * 1000 + 50_000` formula.
 */
export function computeRealisticTravelDuration(params: RidingModelParams): number {
  const { distanceMeters, weather, purpose, slotIndex, travelTimeMultiplier } = params;

  const actualDistance = distanceMeters * PATH_DETOUR_FACTOR;
  const speed =
    baseSpeedForDistance(distanceMeters)
    * weatherCoefficient(weather)
    * purposeCoefficient(purpose)
    * congestionCoefficient(slotIndex)
    * speedJitter();

  const ridingMs = (actualDistance / speed) * 1000;
  const dockMs = dockOperationMs();

  return Math.round((ridingMs + dockMs) * travelTimeMultiplier);
}
