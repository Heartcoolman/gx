import type { DemandRecord } from '../types/demand';
import type { StationCategory } from '../types/station';
import { STATIONS } from '../data/stations';
import { DEMAND_PROFILES, CATEGORY_AFFINITY, BASE_RIDES_PER_SLOT } from '../data/demandProfiles';
import { distanceMatrix } from './distanceMatrix';
import { random } from './rng';
import { useSimEnvStore } from '../store/simEnvStore';
import type { SimEnvConfig } from '../store/simEnvStore';
import { SLOTS_PER_DAY } from '../types/time';
import { SLOT_DURATION_MS } from '../data/constants';

/** Per-station cap to prevent browser freeze under extreme settings */
const MAX_PICKUPS_PER_STATION = 200;

function gaussianNoise(mean: number, sigma: number): number {
  // Box-Muller transform
  const u1 = random();
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + z * sigma);
}

function weightedRandomPick(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return Math.floor(random() * weights.length);
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * Generate synthetic demand records for a given time slot.
 * Returns ~1-4 records per 1-minute slot depending on time of day.
 */
export function generateDemand(
  slotIndex: number,
  baseTimeISO: string,
  envOverride?: Partial<SimEnvConfig>,
): DemandRecord[] {
  const records: DemandRecord[] = [];
  const storeEnv = useSimEnvStore.getState();
  const demandMultiplier = envOverride?.demandMultiplier ?? storeEnv.demandMultiplier;
  const peakIntensity = envOverride?.peakIntensity ?? storeEnv.peakIntensity;
  const noiseFactor = envOverride?.noiseFactor ?? storeEnv.noiseFactor;

  for (const station of STATIONS) {
    const cat = station.category;
    const profile = DEMAND_PROFILES[cat];
    const baseRate = BASE_RIDES_PER_SLOT[cat] * demandMultiplier;

    // Pickup count with noise — scale profile peaks by peakIntensity
    const profileValue = profile.pickup[slotIndex];
    const scaledProfile = profileValue > 0.3 ? profileValue * peakIntensity : profileValue;
    const pickupRate = scaledProfile * baseRate;
    const pickupCount = Math.min(
      Math.round(gaussianNoise(pickupRate, pickupRate * noiseFactor)),
      MAX_PICKUPS_PER_STATION,
    );

    for (let i = 0; i < pickupCount; i++) {
      const dest = pickDestination(station.id, cat);
      if (dest === station.id) continue; // skip self

      const baseTime = new Date(baseTimeISO);
      // Random offset within the 1-minute slot
      const offsetMs = random() * SLOT_DURATION_MS;
      const departureTime = new Date(baseTime.getTime() + offsetMs);

      // Travel time based on distance (assume ~3m/s bike speed)
      const dist = distanceMatrix[station.id][dest];
      const travelMs = (dist / 3) * 1000 + 60000; // +1min for unlock/lock
      const arrivalTime = new Date(departureTime.getTime() + travelMs);

      records.push({
        origin: station.id,
        destination: dest,
        departure_time: departureTime.toISOString(),
        arrival_time: arrivalTime.toISOString(),
      });
    }
  }

  return records;
}

function pickDestination(originId: number, originCat: StationCategory): number {
  const affinities = CATEGORY_AFFINITY[originCat];
  const weights = STATIONS.map((s) => {
    if (s.id === originId) return 0;
    const catAffinity = affinities[s.category];
    const dist = distanceMatrix[originId][s.id];
    return catAffinity / Math.max(dist, 50); // avoid div by zero
  });
  return weightedRandomPick(weights);
}

/**
 * Generate a full day of historical demand for backend warm-up.
 */
export function generateFullDayHistory(
  dayKindISO: string,
  envOverride?: Partial<SimEnvConfig>,
): DemandRecord[][] {
  const slots: DemandRecord[][] = [];
  const baseDate = new Date(dayKindISO);
  baseDate.setHours(0, 0, 0, 0);

  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    const slotTime = new Date(baseDate.getTime() + slot * SLOT_DURATION_MS);
    slots.push(generateDemand(slot, slotTime.toISOString(), envOverride));
  }
  return slots;
}
