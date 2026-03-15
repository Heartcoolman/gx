import { distanceMatrix } from './distanceMatrix';
import { random } from './rng';
import { computeRealisticTravelDuration } from './ridingModel';
import type { StationCategory } from '../types/station';
import { CATEGORY_ORDER } from '../types/station';
import type {
  ActiveRideV2,
  EnvironmentEvent,
  RiderActivityWindow,
  RiderAgentProfile,
  ScenarioPackage,
  SlotEnvironmentContext,
} from '../types/scenario';
import type { DemandRecord } from '../types/demand';
import type { PriceIncentive } from '../types/incentive';
import { useSimEnvStore } from '../store/simEnvStore';
import { STATIONS } from '../data/stations';
import { StationStateManagerV2 } from './stateManagerV2';
import { SLOT_DURATION_MS } from '../data/constants';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Poisson random variate.
 * - λ ≤ 30: Knuth's algorithm (exact)
 * - λ > 30: Normal approximation (fast, accurate for large λ)
 *
 * Naturally non-negative, discrete, and matches real arrival processes.
 */
function poissonSample(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda <= 30) {
    // Knuth algorithm
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= random();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation for large λ
  const u1 = Math.max(1e-6, random());
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(Math.sqrt(lambda) * z + lambda));
}

function isSlotInWindow(slotIndex: number, startSlot: number, endSlot: number): boolean {
  return slotIndex >= startSlot && slotIndex <= endSlot;
}

function windowCurve(slotIndex: number, startSlot: number, endSlot: number): number {
  const mid = (startSlot + endSlot) / 2;
  const halfWidth = Math.max(1, (endSlot - startSlot) / 2);
  const dist = Math.abs(slotIndex - mid) / halfWidth;
  return clamp(1.15 - dist * 0.45, 0.55, 1.22);
}

function weightedPick(weights: number[]): number {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return Math.floor(random() * weights.length);
  let threshold = random() * total;
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i];
    if (threshold <= 0) return i;
  }
  return weights.length - 1;
}

function categoryBoost(
  event: EnvironmentEvent,
  category: StationCategory,
): number {
  const boost = event.destinationBoost?.[category] ?? 1;
  return boost;
}

export class AgentSimulator {
  readonly scenario: ScenarioPackage;
  private activeIncentives: PriceIncentive[] = [];
  /** Cached origin weights per window ID — invalidated when incentives change. */
  private originWeightCache: Map<string, number[]> = new Map();
  /** Cached destination weights per (origin, window, profile) key — invalidated each slot. */
  private destinationWeightCache: Map<string, number[]> = new Map();
  private incentivesVersion = 0;
  private lastCacheSlot = -1;

  constructor(scenario: ScenarioPackage) {
    this.scenario = scenario;
  }

  /** Update the active price incentives from the latest dispatch cycle. */
  setIncentives(incentives: PriceIncentive[]): void {
    this.activeIncentives = incentives;
    this.incentivesVersion++;
    this.originWeightCache.clear();
    this.destinationWeightCache.clear();
  }

  buildEnvironmentContext(slotIndex: number): SlotEnvironmentContext {
    const weatherWindow = this.scenario.weatherTimeline.find((window) =>
      isSlotInWindow(slotIndex, window.startSlot, window.endSlot),
    ) ?? this.scenario.weatherTimeline[0];

    const activeEvents = this.scenario.environmentEvents.filter((event) =>
      isSlotInWindow(slotIndex, event.startSlot, event.endSlot),
    );

    let demandMultiplier = this.scenario.baseDemandMultiplier * weatherWindow.demandMultiplier;
    let travelTimeMultiplier = weatherWindow.travelTimeMultiplier;
    const categoryDemandBoost: Partial<Record<StationCategory, number>> = {};

    for (const event of activeEvents) {
      demandMultiplier *= event.demandMultiplier;
      travelTimeMultiplier *= event.travelTimeMultiplier;
      for (const category of CATEGORY_ORDER) {
        const nextBoost = categoryBoost(event, category);
        categoryDemandBoost[category] = (categoryDemandBoost[category] ?? 1) * nextBoost;
      }
    }

    return {
      slotIndex,
      weather: weatherWindow.weather,
      weatherLabel: weatherWindow.label,
      activeEvents,
      demandMultiplier: clamp(demandMultiplier, 0.45, 1.85),
      travelTimeMultiplier: clamp(travelTimeMultiplier, 1, 1.55),
      shortTripBoost: weatherWindow.shortTripBoost,
      categoryDemandBoost,
    };
  }

  step(
    slotIndex: number,
    slotStartMs: number,
    stateManager: StationStateManagerV2,
  ): { context: SlotEnvironmentContext; observations: DemandRecord[] } {
    const simEnv = useSimEnvStore.getState();
    const context = this.buildEnvironmentContext(slotIndex);
    const observations: DemandRecord[] = [];
    stateManager.beginSlot(slotIndex);
    stateManager.processMaintenance(slotIndex);

    // Invalidate destination cache per slot (context changes each slot)
    if (slotIndex !== this.lastCacheSlot) {
      this.destinationWeightCache.clear();
      this.lastCacheSlot = slotIndex;
    }

    let rideCounter = 0;
    for (const profile of this.scenario.riderProfiles) {
      for (const window of profile.activityWindows) {
        if (!isSlotInWindow(slotIndex, window.startSlot, window.endSlot)) continue;

        const peakScale = window.baseIntensity >= 0.8 ? simEnv.peakIntensity : 1;
        const baseline = (
          profile.baseDailyTrips
          * profile.share
          * window.baseIntensity
          * peakScale
          * windowCurve(slotIndex, window.startSlot, window.endSlot)
        ) / Math.max(1, (window.endSlot - window.startSlot + 1) * 0.72);

        const expectedAttempts = baseline * context.demandMultiplier * simEnv.demandMultiplier;
        const noisyAttempts = poissonSample(expectedAttempts * (1 + (simEnv.noiseFactor - 0.2) * 0.5));

        for (let attempt = 0; attempt < noisyAttempts; attempt++) {
          const origin = this.pickOriginStation(window);
          if (origin === null) continue;

          const destination = this.pickDestinationStation(origin, window, context, profile);
          if (destination === null || origin === destination) continue;

          const distanceMeters = distanceMatrix[origin][destination];
          if (this.shouldCancelForWeather(profile, context, distanceMeters)) {
            stateManager.recordFailure(origin, 'weather_cancelled');
            continue;
          }

          const travelDurationMs = computeRealisticTravelDuration({
            distanceMeters,
            weather: context.weather,
            purpose: window.purpose,
            slotIndex,
            travelTimeMultiplier: context.travelTimeMultiplier,
          });
          const offsetMs = Math.floor(random() * SLOT_DURATION_MS);
          const departureTimeMs = slotStartMs + offsetMs;
          const arrivalTimeMs = departureTimeMs + travelDurationMs;
          observations.push({
            origin,
            destination,
            departure_time: new Date(departureTimeMs).toISOString(),
            arrival_time: new Date(arrivalTimeMs).toISOString(),
          });

          const pickup = this.tryResolvePickup(origin, window, slotIndex, stateManager);
          if (!pickup.ok) {
            // Queue waiting: rider may decide to wait if no bike is available
            const waitProb = window.waitProbability ?? 0.3;
            if (random() < waitProb) {
              const maxWait = window.maxWaitSlots ?? 5;
              stateManager.enqueueWaiter(origin, maxWait, slotIndex);
            }
            continue;
          }

          const bikeId = pickup.bikeId;

          stateManager.ageBike(
            bikeId,
            distanceMeters,
            this.weatherWearMultiplier(context.weather),
          );

          const originCategoryIndex = CATEGORY_ORDER.indexOf(STATIONS[origin].category);
          const destinationCategoryIndex = CATEGORY_ORDER.indexOf(STATIONS[destination].category);
          if (originCategoryIndex >= 0 && destinationCategoryIndex >= 0) {
            stateManager.recordCategoryFlow(originCategoryIndex, destinationCategoryIndex);
          }

          const ride: ActiveRideV2 = {
            rideId: `ride-${slotIndex}-${rideCounter}`,
            bikeId,
            origin,
            destination,
            plannedDestination: destination,
            fallbackStations: this.rankNearbyStations(destination),
            departureTime: departureTimeMs,
            arrivalTime: arrivalTimeMs,
            progress: 0,
            purpose: window.purpose,
            riderProfileId: profile.id,
            weather: context.weather,
            distanceMeters,
            overflowMeters: 0,
          };
          rideCounter++;
          stateManager.createRide(ride);
        }
      }
    }

    return { context, observations };
  }

  private pickOriginStation(window: RiderActivityWindow): number | null {
    const cacheKey = window.id;
    let weights = this.originWeightCache.get(cacheKey);
    if (!weights) {
      weights = STATIONS.map((station) => {
        if (!window.originCategories.includes(station.category)) return 0;
        return this.scenario.stationHotness[station.id] * (this.scenario.initialDistributionBias[station.category] ?? 0.1);
      });
      // Departure discounts boost origin weight — riders prefer stations offering deals.
      this.applyOriginIncentiveBoost(weights);
      this.originWeightCache.set(cacheKey, weights);
    }
    if (weights.every((value) => value <= 0)) return null;
    return weightedPick(weights);
  }

  private pickDestinationStation(
    originStationId: number,
    window: RiderActivityWindow,
    context: SlotEnvironmentContext,
    profile: RiderAgentProfile,
  ): number | null {
    const cacheKey = `${originStationId}-${window.id}-${profile.id}`;
    let weights = this.destinationWeightCache.get(cacheKey);
    if (!weights) {
      const originStation = STATIONS[originStationId];
      weights = STATIONS.map((station) => {
        if (station.id === originStationId) return 0;
        if (!window.destinationCategories.includes(station.category)) return 0;
        const affinity = this.scenario.categoryAffinity[originStation.category][station.category] ?? 0.05;
        const distance = Math.max(distanceMatrix[originStationId][station.id], 60);
        const distancePenalty = Math.pow(distance / 180, profile.distancePreferenceExponent);
        const contextBoost = context.categoryDemandBoost[station.category] ?? 1;
        return (affinity * this.scenario.stationHotness[station.id] * contextBoost) / distancePenalty;
      });
      // Arrival rewards boost destination weight — riders prefer stations offering rewards.
      this.applyDestinationIncentiveBoost(weights);
      this.destinationWeightCache.set(cacheKey, weights);
    }
    if (weights.every((value) => value <= 0)) return null;
    return weightedPick(weights);
  }

  private shouldCancelForWeather(
    profile: RiderAgentProfile,
    context: SlotEnvironmentContext,
    distanceMeters: number,
  ): boolean {
    const distanceFactor = distanceMeters > 850 ? 1.22 : distanceMeters < 350 ? 0.84 / context.shortTripBoost : 1;
    const baseChance = context.weather === 'storm'
      ? 0.18
      : context.weather === 'rain'
        ? 0.08
        : context.weather === 'cold_front'
          ? 0.05
          : 0;
    return random() < baseChance * (1 + profile.weatherSensitivity) * distanceFactor;
  }

  private tryResolvePickup(
    initialStationId: number,
    window: RiderActivityWindow,
    slotIndex: number,
    stateManager: StationStateManagerV2,
  ): { ok: true; bikeId: string } | { ok: false } {
    const firstTry = stateManager.tryCheckoutBike(initialStationId, slotIndex);
    if (firstTry.ok) {
      return { ok: true, bikeId: firstTry.bike.id };
    }

    if (random() >= window.retryProbability) {
      stateManager.recordFailure(initialStationId, firstTry.reason);
      return { ok: false };
    }

    const alternatives = this.rankNearbyStations(initialStationId)
      .filter((stationId) => stationId !== initialStationId)
      .filter((stationId) => distanceMatrix[initialStationId][stationId] <= window.walkToleranceMeters);

    if (alternatives.length === 0) {
      stateManager.recordFailure(initialStationId, 'walk_transfer_exceeded');
      return { ok: false };
    }

    stateManager.markWalkTransfer();
    for (const stationId of alternatives) {
      const retry = stateManager.tryCheckoutBike(stationId, slotIndex);
      if (retry.ok) {
        return { ok: true, bikeId: retry.bike.id };
      }
    }

    stateManager.recordFailure(alternatives[0], 'gave_up_after_retry');
    return { ok: false };
  }

  private rankNearbyStations(originStationId: number): number[] {
    return STATIONS
      .map((station) => ({ stationId: station.id, distance: distanceMatrix[originStationId][station.id] }))
      .sort((left, right) => left.distance - right.distance)
      .map((entry) => entry.stationId);
  }

  private weatherWearMultiplier(weather: SlotEnvironmentContext['weather']): number {
    if (weather === 'storm') return this.scenario.bikeHealth.rainWearMultiplier * 1.25;
    if (weather === 'rain') return this.scenario.bikeHealth.rainWearMultiplier;
    if (weather === 'cold_front') return 1.1;
    return 1;
  }

  // ── Incentive integration ──

  /** Boost origin weights for stations with active departure discounts. */
  private applyOriginIncentiveBoost(weights: number[]): void {
    for (const incentive of this.activeIncentives) {
      if (
        incentive.incentive_type === 'departure_discount'
        && incentive.station_id < weights.length
        && weights[incentive.station_id] > 0
      ) {
        const influence = this.incentiveInfluence(incentive.discount_percent);
        // Origin boost: ~1.3x at 10% discount, ~1.8x at 30%, ~2.1x at 50%
        weights[incentive.station_id] *= 1.0 + influence * 3.5;
      }
    }
  }

  /** Boost destination weights for stations with active arrival rewards. */
  private applyDestinationIncentiveBoost(weights: number[]): void {
    for (const incentive of this.activeIncentives) {
      if (
        incentive.incentive_type === 'arrival_reward'
        && incentive.station_id < weights.length
        && weights[incentive.station_id] > 0
      ) {
        const influence = this.incentiveInfluence(incentive.discount_percent);
        // Destination boost is stronger — riders are more flexible about where to return.
        // ~1.4x at 10% discount, ~2.0x at 30%, ~2.5x at 50%
        weights[incentive.station_id] *= 1.0 + influence * 4.5;
      }
    }
  }

  /**
   * Logistic influence curve: maps discount percentage → behavioral change factor.
   * Mirrors the backend's logistic_response but expressed as a 0–0.30 multiplier.
   *   10% discount → ~0.08 influence
   *   30% discount → ~0.20 influence
   *   50% discount → ~0.26 influence
   */
  private incentiveInfluence(discountPercent: number): number {
    const k = 0.065;
    const mid = 22;
    return 0.30 / (1 + Math.exp(-k * (discountPercent - mid)));
  }
}
