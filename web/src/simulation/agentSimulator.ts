import { distanceMatrix } from './distanceMatrix';
import { random } from './rng';
import { computeRealisticTravelDuration } from './ridingModel';
import { interpolateWeatherState } from '../data/scenarioLibrary';
import type { StationCategory } from '../types/station';
import { CATEGORY_ORDER } from '../types/station';
import type {
  ActiveRideV2,
  EnvironmentEvent,
  RidePurpose,
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
import { clamp } from '../utils/math';

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

/**
 * Compute urgency-based scaling factors for retry and wait behavior.
 * Returns retryScale (>1 = more likely to retry) and waitScale (<1 = less patient).
 */
function purposeUrgency(
  purpose: RidePurpose,
  windowProgress: number,
): { retryScale: number; waitScale: number } {
  switch (purpose) {
    case 'class': {
      // Late in window → very urgent: retry +30%, wait tolerance -40%
      const lateRamp = Math.max(0, (windowProgress - 0.4) / 0.6);
      return { retryScale: 1.0 + 0.30 * lateRamp, waitScale: 1.0 - 0.40 * lateRamp };
    }
    case 'commute': {
      const lateRamp = Math.max(0, (windowProgress - 0.4) / 0.6);
      return { retryScale: 1.0 + 0.20 * lateRamp, waitScale: 1.0 - 0.25 * lateRamp };
    }
    case 'exercise':
      return { retryScale: 0.80, waitScale: 1.50 };
    case 'social':
      return { retryScale: 0.70, waitScale: 1.60 };
    default:
      return { retryScale: 1.0, waitScale: 1.0 };
  }
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

    const weatherState = interpolateWeatherState(slotIndex, this.scenario.weatherTimeline);

    return {
      slotIndex,
      weather: weatherWindow.weather,
      weatherLabel: weatherWindow.label,
      activeEvents,
      demandMultiplier: clamp(demandMultiplier, 0.45, 1.85),
      travelTimeMultiplier: clamp(travelTimeMultiplier, 1, 1.55),
      shortTripBoost: weatherWindow.shortTripBoost,
      categoryDemandBoost,
      weatherState,
      temperature: weatherState.temperature,
      windSpeed: weatherState.windSpeed,
      humidity: weatherState.humidity,
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
    // Track rides per profile this slot for fatigue
    const profileRideCount = new Map<string, number>();
    for (const profile of this.scenario.riderProfiles) {
      for (const window of profile.activityWindows) {
        if (!isSlotInWindow(slotIndex, window.startSlot, window.endSlot)) continue;

        // ── Urgency: how far through the activity window are we? ──
        const windowSpan = Math.max(1, window.endSlot - window.startSlot);
        const windowProgress = (slotIndex - window.startSlot) / windowSpan;
        const urgencyFactor = purposeUrgency(window.purpose, windowProgress);

        const peakScale = window.baseIntensity >= 0.8 ? simEnv.peakIntensity : 1;
        const baseline = (
          profile.baseDailyTrips
          * profile.share
          * window.baseIntensity
          * peakScale
          * windowCurve(slotIndex, window.startSlot, window.endSlot)
        ) / Math.max(1, (window.endSlot - window.startSlot + 1) * 0.72);

        const expectedAttempts = baseline * context.demandMultiplier * simEnv.demandMultiplier;
        // Multi-ride fatigue: reduce demand slightly after many rides from same profile
        const currentCount = profileRideCount.get(profile.id) ?? 0;
        const fatigueFactor = 1.0 / (1.0 + currentCount * 0.002);
        const fatigueAdjustedAttempts = expectedAttempts * fatigueFactor;
        const noisyAttempts = poissonSample(fatigueAdjustedAttempts * (1 + (simEnv.noiseFactor - 0.2) * 0.5));

        // Group riding: 10-15% of rides are in groups of 2-4
        const isGroupRide = random() < 0.125; // 12.5% chance
        const groupSize = isGroupRide ? 2 + Math.floor(random() * 3) : 1; // 2-4 riders

        for (let attempt = 0; attempt < noisyAttempts; attempt++) {
          // Sample rider traits for this individual attempt
          const riderFitness = 0.7 + random() * 0.6;  // 0.7-1.3 fitness multiplier
          const riderExperience = 0.5 + random() * 0.5; // 0.5-1.0 experience level
          const weatherTolerance = profile.weatherSensitivity * (0.6 + random() * 0.8); // individual variation

          const origin = this.pickOriginStation(window);
          if (origin === null) continue;

          // Group riding: check if enough bikes for the group
          if (isGroupRide && groupSize > 1) {
            const availableBikes = stateManager.getAvailableCount(origin);
            if (availableBikes < groupSize) {
              if (availableBikes === 0) {
                stateManager.recordFailure(origin, 'no_bike');
                continue;
              }
              // Only some of the group rides — proceed with reduced count
            }
          }

          const destination = this.pickDestinationStation(origin, window, context, profile);
          if (destination === null || origin === destination) continue;

          const distanceMeters = distanceMatrix[origin][destination];
          // Use individual weatherTolerance instead of profile-level sensitivity
          const distanceFactor = distanceMeters > 850 ? 1.22 : distanceMeters < 350 ? 0.84 / context.shortTripBoost : 1;
          const weatherCancelBase = context.weather === 'storm'
            ? 0.18
            : context.weather === 'rain'
              ? 0.08
              : context.weather === 'cold_front'
                ? 0.05
                : 0;
          if (random() < weatherCancelBase * (1 + weatherTolerance) * distanceFactor) {
            stateManager.recordFailure(origin, 'weather_cancelled');
            continue;
          }

          const travelDurationMs = computeRealisticTravelDuration({
            distanceMeters,
            weather: context.weather,
            purpose: window.purpose,
            slotIndex,
            travelTimeMultiplier: context.travelTimeMultiplier,
            windowProgress,
          });
          // Fitness-adjusted travel duration: fitter riders are faster
          const fitnessFactor = 1.0 / riderFitness;
          const adjustedDuration = Math.round(travelDurationMs * fitnessFactor);

          const offsetMs = Math.floor(random() * SLOT_DURATION_MS);
          const departureTimeMs = slotStartMs + offsetMs;
          const arrivalTimeMs = departureTimeMs + adjustedDuration;
          observations.push({
            origin,
            destination,
            departure_time: new Date(departureTimeMs).toISOString(),
            arrival_time: new Date(arrivalTimeMs).toISOString(),
          });

          // Adaptive walk tolerance based on weather and rider fitness
          const adaptiveWalkTolerance = window.walkToleranceMeters
            * (context.weather === 'storm' ? 0.5 : context.weather === 'rain' ? 0.7 : 1.0)
            * (0.8 + riderFitness * 0.3);

          const pickup = this.tryResolvePickup(origin, window, slotIndex, stateManager, urgencyFactor, adaptiveWalkTolerance);
          if (!pickup.ok) {
            const waitProb = (window.waitProbability ?? 0.3) * urgencyFactor.waitScale;
            if (random() < waitProb) {
              const maxWait = Math.max(1, Math.round((window.maxWaitSlots ?? 5) * urgencyFactor.waitScale));
              stateManager.enqueueWaiter(origin, maxWait, slotIndex);
            }
            continue;
          }

          // Experienced riders may reject low-health bikes
          const bikeHealth = stateManager.getBikeHealth(pickup.bikeId);
          if (bikeHealth !== undefined && bikeHealth < 0.5) {
            const rejectChance = riderExperience * profile.bikeFaultSensitivity * (1 - bikeHealth);
            if (random() < rejectChance) {
              stateManager.recordFailure(origin, 'bike_fault');
              continue;
            }
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

          // Create rides for group members with slightly staggered times
          const ridesToCreate = isGroupRide ? Math.min(groupSize, stateManager.getAvailableCount(origin) + 1) : 1;
          for (let g = 0; g < ridesToCreate; g++) {
            let memberBikeId: string;
            if (g === 0) {
              memberBikeId = bikeId;
            } else {
              const extra = this.tryResolvePickup(origin, window, slotIndex, stateManager, urgencyFactor, adaptiveWalkTolerance);
              if (!extra.ok) continue; // group member couldn't get a bike
              stateManager.ageBike(extra.bikeId, distanceMeters, this.weatherWearMultiplier(context.weather));
              memberBikeId = extra.bikeId;
            }
            const stagger = g * Math.floor(random() * 15000); // up to 15s stagger per group member
            const ride: ActiveRideV2 = {
              rideId: `ride-${slotIndex}-${rideCounter}`,
              bikeId: memberBikeId,
              origin,
              destination,
              plannedDestination: destination,
              fallbackStations: this.rankNearbyStations(destination),
              departureTime: departureTimeMs + stagger,
              arrivalTime: arrivalTimeMs + stagger,
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
          // Update fatigue tracking
          profileRideCount.set(profile.id, (profileRideCount.get(profile.id) ?? 0) + ridesToCreate);
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

  private tryResolvePickup(
    initialStationId: number,
    window: RiderActivityWindow,
    slotIndex: number,
    stateManager: StationStateManagerV2,
    urgency: { retryScale: number; waitScale: number },
    walkTolerance: number,
  ): { ok: true; bikeId: string } | { ok: false } {
    const firstTry = stateManager.tryCheckoutBike(initialStationId, slotIndex);
    if (firstTry.ok) {
      return { ok: true, bikeId: firstTry.bike.id };
    }

    if (random() >= window.retryProbability * urgency.retryScale) {
      stateManager.recordFailure(initialStationId, firstTry.reason);
      return { ok: false };
    }

    const alternatives = this.rankNearbyStations(initialStationId)
      .filter((stationId) => stationId !== initialStationId)
      .filter((stationId) => distanceMatrix[initialStationId][stationId] <= walkTolerance);

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
