import { SCENARIO_BUNDLES, getScenarioById } from '../data/scenarioLibrary';
import type { ScenarioBundle, ScenarioPackage, WeatherKind } from '../types/scenario';
import { SeededRandom } from './rng';

export interface CompilerOptions {
  seed?: number;
  demandBias?: number;
  weatherOverride?: WeatherKind;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shiftScenario(
  source: ScenarioPackage,
  random: SeededRandom,
  options: CompilerOptions,
): ScenarioPackage {
  const demandBias = options.demandBias ?? 1;
  const weatherOverride = options.weatherOverride;

  return {
    ...source,
    seed: options.seed ?? source.seed,
    baseDemandMultiplier: clamp(source.baseDemandMultiplier * demandBias, 0.65, 1.4),
    weatherTimeline: source.weatherTimeline.map((window) => ({
      ...window,
      weather: weatherOverride ?? window.weather,
      label: weatherOverride ? `${window.label} / 自定义天气` : window.label,
      demandMultiplier: weatherOverride === 'storm'
        ? clamp(window.demandMultiplier * 0.72, 0.45, 1.2)
        : weatherOverride === 'rain'
          ? clamp(window.demandMultiplier * 0.88, 0.5, 1.2)
          : window.demandMultiplier,
      travelTimeMultiplier: weatherOverride === 'storm'
        ? clamp(window.travelTimeMultiplier * 1.18, 1, 1.5)
        : weatherOverride === 'rain'
          ? clamp(window.travelTimeMultiplier * 1.1, 1, 1.4)
          : window.travelTimeMultiplier,
      healthWearMultiplier: weatherOverride === 'storm'
        ? clamp(window.healthWearMultiplier * 1.2, 1, 2)
        : weatherOverride === 'rain'
          ? clamp(window.healthWearMultiplier * 1.1, 1, 1.8)
          : window.healthWearMultiplier,
    })),
    stationHotness: source.stationHotness.map((value) => clamp(value * (0.94 + random.next() * 0.18), 0.72, 1.5)),
  };
}

export function compileScenarioBundle(
  scenarioId: string,
  options: CompilerOptions = {},
): ScenarioBundle {
  const source = getScenarioById(scenarioId);
  const random = new SeededRandom(options.seed ?? source.seed);
  const scenario = shiftScenario(source, random, options);

  const syntheticTripCorpus = Array.from(
    { length: scenario.syntheticCorpus.previewDays },
    (_, dayIndex) => {
      const tripVariance = 0.9 + random.next() * 0.22;
      const weather = scenario.weatherTimeline[dayIndex % scenario.weatherTimeline.length];
      const expectedTrips = Math.round(
        scenario.syntheticCorpus.dailyTripTarget
        * scenario.baseDemandMultiplier
        * tripVariance,
      );

      return {
        dayIndex,
        expectedTrips,
        dominantWeather: weather.weather,
        highlightedEvents: scenario.environmentEvents
          .slice(dayIndex % 2, dayIndex % 2 + 2)
          .map((event) => event.label),
      };
    },
  );

  return { scenario, syntheticTripCorpus };
}

export function compileScenarioCatalog(): ScenarioBundle[] {
  return SCENARIO_BUNDLES.map((bundle, index) =>
    compileScenarioBundle(bundle.scenario.id, { seed: bundle.scenario.seed + index }),
  );
}

export function serializeScenarioBundle(bundle: ScenarioBundle): string {
  return JSON.stringify(bundle, null, 2);
}
