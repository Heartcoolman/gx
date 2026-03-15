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

// ── Time-of-day congestion coefficient (smooth Gaussian LUT) ──

/** Gaussian bump: returns depth at minute-of-day distance from center. */
function gaussianBump(minute: number, centerMinute: number, sigmaHours: number, depth: number): number {
  const dx = (minute - centerMinute) / (sigmaHours * 60);
  return depth * Math.exp(-0.5 * dx * dx);
}

/**
 * Pre-computed 1440-element lookup table (one per minute of day).
 * Congestion = 1.0 − sum of Gaussian peaks.
 *   Morning  7:45  (σ=0.8h, depth=0.15)
 *   Lunch   11:45  (σ=0.7h, depth=0.12)
 *   Evening 16:45  (σ=0.9h, depth=0.15)
 */
const CONGESTION_LUT: Float64Array = (() => {
  const lut = new Float64Array(1440);
  const peaks = [
    { center: 7 * 60 + 45, sigma: 0.8, depth: 0.15 },
    { center: 11 * 60 + 45, sigma: 0.7, depth: 0.12 },
    { center: 16 * 60 + 45, sigma: 0.9, depth: 0.15 },
  ];
  for (let m = 0; m < 1440; m++) {
    let reduction = 0;
    for (const p of peaks) {
      reduction += gaussianBump(m, p.center, p.sigma, p.depth);
    }
    lut[m] = 1.0 - reduction;
  }
  return lut;
})();

/** Exported for reuse by dispatch vehicle congestion. */
export function congestionCoefficient(slotIndex: number): number {
  const minute = Math.min(Math.max(slotIndex, 0), 1439);
  return CONGESTION_LUT[minute];
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
  /** 0–1 position within the rider's activity window (0 = start, 1 = end). */
  windowProgress?: number;
}

/**
 * Compute realistic travel duration in milliseconds.
 *
 * Replaces the old `(distance / 3.2) * 1000 + 50_000` formula.
 */
export function computeRealisticTravelDuration(params: RidingModelParams): number {
  const { distanceMeters, weather, purpose, slotIndex, travelTimeMultiplier, windowProgress } = params;

  const actualDistance = distanceMeters * PATH_DETOUR_FACTOR;

  // Urgency speed tweak: late-window class riders speed up, early-window social riders slow down
  let urgencySpeedFactor = 1.0;
  if (windowProgress !== undefined) {
    if (purpose === 'class' && windowProgress > 0.5) {
      // Up to +8% speed in the last half of the window
      urgencySpeedFactor = 1.0 + 0.08 * ((windowProgress - 0.5) / 0.5);
    } else if (purpose === 'social' && windowProgress < 0.5) {
      // Up to -5% speed in the first half of the window
      urgencySpeedFactor = 1.0 - 0.05 * (1 - windowProgress / 0.5);
    }
  }

  const speed =
    baseSpeedForDistance(distanceMeters)
    * weatherCoefficient(weather)
    * purposeCoefficient(purpose)
    * congestionCoefficient(slotIndex)
    * urgencySpeedFactor
    * speedJitter();

  const ridingMs = (actualDistance / speed) * 1000;
  const dockMs = dockOperationMs();

  return Math.round((ridingMs + dockMs) * travelTimeMultiplier);
}
