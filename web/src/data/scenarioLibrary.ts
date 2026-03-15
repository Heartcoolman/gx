import { CATEGORY_AFFINITY } from './demandProfiles';
import { STATIONS } from './stations';
import type {
  EnvironmentEvent,
  RiderAgentProfile,
  ScenarioBundle,
  ScenarioPackage,
  WeatherWindow,
} from '../types/scenario';
import type { DayKind } from '../types/time';
import type { StationCategory } from '../types/station';

function hotness(defaultValue: number, overrides: Record<number, number>): number[] {
  return STATIONS.map((station) => overrides[station.id] ?? defaultValue);
}

function makeWeatherTimeline(kind: 'clear' | 'rainy' | 'exam_rain' | 'festival' | 'weekend'): WeatherWindow[] {
  if (kind === 'rainy') {
    return [
      { startSlot: 0, endSlot: 419, weather: 'cloudy', label: '清晨多云', demandMultiplier: 0.95, travelTimeMultiplier: 1.02, healthWearMultiplier: 1.0, shortTripBoost: 1.02 },
      { startSlot: 420, endSlot: 1154, weather: 'rain', label: '日间降雨', demandMultiplier: 0.76, travelTimeMultiplier: 1.18, healthWearMultiplier: 1.55, shortTripBoost: 1.15 },
      { startSlot: 1155, endSlot: 1439, weather: 'cold_front', label: '夜间寒潮', demandMultiplier: 0.82, travelTimeMultiplier: 1.1, healthWearMultiplier: 1.35, shortTripBoost: 1.08 },
    ];
  }
  if (kind === 'exam_rain') {
    return [
      { startSlot: 0, endSlot: 479, weather: 'cloudy', label: '阴天备考', demandMultiplier: 0.92, travelTimeMultiplier: 1.03, healthWearMultiplier: 1.05, shortTripBoost: 1.03 },
      { startSlot: 480, endSlot: 1034, weather: 'rain', label: '午后阵雨', demandMultiplier: 0.8, travelTimeMultiplier: 1.15, healthWearMultiplier: 1.45, shortTripBoost: 1.12 },
      { startSlot: 1035, endSlot: 1439, weather: 'cloudy', label: '夜间阴凉', demandMultiplier: 0.88, travelTimeMultiplier: 1.06, healthWearMultiplier: 1.1, shortTripBoost: 1.05 },
    ];
  }
  if (kind === 'festival') {
    return [
      { startSlot: 0, endSlot: 1439, weather: 'clear', label: '活动日晴朗', demandMultiplier: 1.08, travelTimeMultiplier: 1.0, healthWearMultiplier: 1.0, shortTripBoost: 1.02 },
    ];
  }
  if (kind === 'weekend') {
    return [
      { startSlot: 0, endSlot: 539, weather: 'clear', label: '周末清晨', demandMultiplier: 0.82, travelTimeMultiplier: 1.0, healthWearMultiplier: 1.0, shortTripBoost: 1.0 },
      { startSlot: 540, endSlot: 1154, weather: 'clear', label: '周末午后', demandMultiplier: 1.04, travelTimeMultiplier: 1.0, healthWearMultiplier: 1.0, shortTripBoost: 1.02 },
      { startSlot: 1155, endSlot: 1439, weather: 'cloudy', label: '周末夜晚', demandMultiplier: 0.92, travelTimeMultiplier: 1.04, healthWearMultiplier: 1.03, shortTripBoost: 1.03 },
    ];
  }
  return [
    { startSlot: 0, endSlot: 479, weather: 'clear', label: '清晨晴朗', demandMultiplier: 0.96, travelTimeMultiplier: 1.0, healthWearMultiplier: 1.0, shortTripBoost: 1.0 },
    { startSlot: 480, endSlot: 1154, weather: 'clear', label: '白天舒适', demandMultiplier: 1.05, travelTimeMultiplier: 1.0, healthWearMultiplier: 1.0, shortTripBoost: 1.0 },
    { startSlot: 1155, endSlot: 1439, weather: 'cloudy', label: '夜间微凉', demandMultiplier: 0.9, travelTimeMultiplier: 1.03, healthWearMultiplier: 1.05, shortTripBoost: 1.04 },
  ];
}

function makeEvents(kind: ScenarioPackage['id']): EnvironmentEvent[] {
  const base: EnvironmentEvent[] = [
    {
      id: `${kind}-lecture-peak`,
      label: '整点换课潮',
      type: 'lecture_peak',
      startSlot: 435,
      endSlot: 539,
      demandMultiplier: 1.25,
      travelTimeMultiplier: 1.05,
      affectedCategories: ['dormitory', 'academic_building', 'main_gate'],
      destinationBoost: { academic_building: 1.25 },
      pressureBoost: { academic_building: 0.22, dormitory: 0.14 },
    },
    {
      id: `${kind}-lunch-surge`,
      label: '午餐高峰',
      type: 'cafeteria_surge',
      startSlot: 660,
      endSlot: 749,
      demandMultiplier: 1.18,
      travelTimeMultiplier: 1.02,
      affectedCategories: ['academic_building', 'cafeteria', 'library'],
      destinationBoost: { cafeteria: 1.35 },
      pressureBoost: { cafeteria: 0.2 },
    },
    {
      id: `${kind}-library-close`,
      label: '图书馆闭馆回流',
      type: 'library_closure',
      startSlot: 1230,
      endSlot: 1349,
      demandMultiplier: 1.12,
      travelTimeMultiplier: 1.0,
      affectedCategories: ['library', 'dormitory'],
      destinationBoost: { dormitory: 1.22 },
      pressureBoost: { dormitory: 0.12, library: 0.08 },
    },
  ];

  if (kind === 'festival-day') {
    base.push({
      id: `${kind}-festival`,
      label: '校园活动日',
      type: 'campus_festival',
      startSlot: 840,
      endSlot: 1214,
      demandMultiplier: 1.35,
      travelTimeMultiplier: 1.06,
      affectedCategories: ['main_gate', 'sports_field', 'cafeteria'],
      destinationBoost: { sports_field: 1.35, main_gate: 1.25 },
      pressureBoost: { sports_field: 0.28, main_gate: 0.18, cafeteria: 0.12 },
    });
  }

  if (kind === 'exam-week') {
    base.push({
      id: `${kind}-exam`,
      label: '考试周高压',
      type: 'exam_pressure',
      startSlot: 480,
      endSlot: 1154,
      demandMultiplier: 0.94,
      travelTimeMultiplier: 1.02,
      affectedCategories: ['library', 'academic_building', 'dormitory'],
      destinationBoost: { library: 1.28, academic_building: 1.12 },
      pressureBoost: { library: 0.3, academic_building: 0.18 },
    });
  }

  if (kind === 'weekend-freeplay') {
    base.push({
      id: `${kind}-sports`,
      label: '周末运动热区',
      type: 'sports_event',
      startSlot: 900,
      endSlot: 1214,
      demandMultiplier: 1.16,
      travelTimeMultiplier: 1.0,
      affectedCategories: ['sports_field', 'dormitory', 'cafeteria'],
      destinationBoost: { sports_field: 1.32, cafeteria: 1.12 },
      pressureBoost: { sports_field: 0.24, cafeteria: 0.1 },
    });
  }

  return base;
}

function baseProfiles(): RiderAgentProfile[] {
  return [
    {
      id: 'commuter',
      label: '上课通勤学生',
      share: 0.4,
      baseDailyTrips: 170,
      homeCategories: ['dormitory', 'main_gate'],
      weatherSensitivity: 0.2,
      bikeFaultSensitivity: 0.15,
      distancePreferenceExponent: 1.1,
      activityWindows: [
        { id: 'class-am', label: '早高峰上课', startSlot: 420, endSlot: 554, purpose: 'class', baseIntensity: 1.15, originCategories: ['dormitory', 'main_gate'], destinationCategories: ['academic_building'], retryProbability: 0.72, walkToleranceMeters: 320 },
        { id: 'class-pm', label: '午后上课', startSlot: 780, endSlot: 884, purpose: 'class', baseIntensity: 0.65, originCategories: ['cafeteria', 'dormitory'], destinationCategories: ['academic_building'], retryProbability: 0.55, walkToleranceMeters: 260 },
        { id: 'class-back', label: '晚间回宿舍', startSlot: 1020, endSlot: 1214, purpose: 'commute', baseIntensity: 1.05, originCategories: ['academic_building', 'library'], destinationCategories: ['dormitory'], retryProbability: 0.6, walkToleranceMeters: 280 },
      ],
    },
    {
      id: 'meal-runner',
      label: '短途就餐学生',
      share: 0.22,
      baseDailyTrips: 120,
      homeCategories: ['dormitory', 'academic_building'],
      weatherSensitivity: 0.32,
      bikeFaultSensitivity: 0.22,
      distancePreferenceExponent: 1.4,
      activityWindows: [
        { id: 'breakfast', label: '早餐窗口', startSlot: 360, endSlot: 449, purpose: 'meal', baseIntensity: 0.55, originCategories: ['dormitory'], destinationCategories: ['cafeteria'], retryProbability: 0.48, walkToleranceMeters: 220 },
        { id: 'lunch', label: '午餐窗口', startSlot: 660, endSlot: 764, purpose: 'meal', baseIntensity: 1.1, originCategories: ['academic_building', 'library'], destinationCategories: ['cafeteria'], retryProbability: 0.58, walkToleranceMeters: 220 },
        { id: 'dinner', label: '晚餐窗口', startSlot: 1020, endSlot: 1124, purpose: 'meal', baseIntensity: 0.9, originCategories: ['academic_building', 'sports_field'], destinationCategories: ['cafeteria', 'dormitory'], retryProbability: 0.5, walkToleranceMeters: 210 },
      ],
    },
    {
      id: 'library-focused',
      label: '图书馆长留型',
      share: 0.16,
      baseDailyTrips: 80,
      homeCategories: ['dormitory'],
      weatherSensitivity: 0.18,
      bikeFaultSensitivity: 0.12,
      distancePreferenceExponent: 1.0,
      activityWindows: [
        { id: 'study-in', label: '白天去图书馆', startSlot: 540, endSlot: 854, purpose: 'study', baseIntensity: 0.65, originCategories: ['dormitory', 'academic_building'], destinationCategories: ['library'], retryProbability: 0.66, walkToleranceMeters: 300 },
        { id: 'study-out', label: '晚间离馆', startSlot: 1200, endSlot: 1334, purpose: 'study', baseIntensity: 0.88, originCategories: ['library'], destinationCategories: ['dormitory', 'cafeteria'], retryProbability: 0.52, walkToleranceMeters: 280 },
      ],
    },
    {
      id: 'sports-social',
      label: '运动社交型',
      share: 0.12,
      baseDailyTrips: 55,
      homeCategories: ['dormitory', 'cafeteria'],
      weatherSensitivity: 0.42,
      bikeFaultSensitivity: 0.26,
      distancePreferenceExponent: 1.25,
      activityWindows: [
        { id: 'sports-go', label: '傍晚去运动场', startSlot: 960, endSlot: 1154, purpose: 'exercise', baseIntensity: 0.92, originCategories: ['dormitory', 'cafeteria'], destinationCategories: ['sports_field'], retryProbability: 0.44, walkToleranceMeters: 240 },
        { id: 'sports-back', label: '运动后返程', startSlot: 1110, endSlot: 1274, purpose: 'social', baseIntensity: 0.72, originCategories: ['sports_field'], destinationCategories: ['dormitory', 'cafeteria'], retryProbability: 0.38, walkToleranceMeters: 210 },
      ],
    },
    {
      id: 'gate-connector',
      label: '校门往返人群',
      share: 0.1,
      baseDailyTrips: 46,
      homeCategories: ['main_gate', 'dormitory'],
      weatherSensitivity: 0.25,
      bikeFaultSensitivity: 0.18,
      distancePreferenceExponent: 0.95,
      activityWindows: [
        { id: 'gate-am', label: '晨间入校', startSlot: 390, endSlot: 524, purpose: 'commute', baseIntensity: 0.55, originCategories: ['main_gate'], destinationCategories: ['academic_building', 'dormitory'], retryProbability: 0.72, walkToleranceMeters: 340 },
        { id: 'gate-pm', label: '夜间离校', startSlot: 1140, endSlot: 1334, purpose: 'errand', baseIntensity: 0.68, originCategories: ['dormitory', 'academic_building'], destinationCategories: ['main_gate'], retryProbability: 0.65, walkToleranceMeters: 340 },
      ],
    },
  ];
}

function tunedProfiles(mode: ScenarioPackage['id']): RiderAgentProfile[] {
  return baseProfiles().map((profile) => {
    if (mode === 'exam-week' && profile.id === 'library-focused') {
      return { ...profile, share: 0.22, baseDailyTrips: 112 };
    }
    if (mode === 'festival-day' && profile.id === 'sports-social') {
      return { ...profile, share: 0.18, baseDailyTrips: 92 };
    }
    if (mode === 'weekend-freeplay' && profile.id === 'commuter') {
      return { ...profile, share: 0.18, baseDailyTrips: 88 };
    }
    if (mode === 'weekend-freeplay' && profile.id === 'sports-social') {
      return { ...profile, share: 0.22, baseDailyTrips: 86 };
    }
    return profile;
  });
}

const SCENARIO_SEEDS: Record<string, number> = {
  'weekday-spring': 20260314,
  'rainy-commute': 20260315,
  'exam-week': 20260316,
  'festival-day': 20260317,
  'weekend-freeplay': 20260318,
};

function makeScenario(
  id: string,
  label: string,
  description: string,
  dayKind: DayKind,
  weatherKind: 'clear' | 'rainy' | 'exam_rain' | 'festival' | 'weekend',
  totalBikes: number,
  baseDemandMultiplier: number,
  stationOverrides: Record<number, number>,
  initialDistributionBias: Partial<Record<StationCategory, number>>,
): ScenarioPackage {
  return {
    version: '2.0.0',
    id,
    label,
    description,
    dayKind,
    seed: SCENARIO_SEEDS[id],
    semesterPhase: id === 'exam-week'
      ? 'exam_week'
      : id === 'festival-day'
        ? 'festival_day'
        : id === 'weekend-freeplay'
          ? 'weekend_mode'
          : 'spring_term',
    stations: STATIONS,
    totalBikes,
    baseDemandMultiplier,
    initialDistributionBias,
    stationHotness: hotness(1, stationOverrides),
    weatherTimeline: makeWeatherTimeline(weatherKind),
    environmentEvents: makeEvents(id),
    riderProfiles: tunedProfiles(id),
    categoryAffinity: CATEGORY_AFFINITY,
    bikeHealth: {
      failureThreshold: 0.42,
      outageThreshold: 0.18,
      wearPerKm: 0.035,
      rainWearMultiplier: weatherKind === 'rainy' || weatherKind === 'exam_rain' ? 1.25 : 1,
      repairProbabilityPerSlot: id === 'exam-week' ? 0.2 / 15 : 0.24 / 15,
      recoverySlots: id === 'festival-day' ? 15 : 30,
    },
    syntheticCorpus: {
      dailyTripTarget: id === 'festival-day' ? 520 : id === 'weekend-freeplay' ? 360 : 430,
      previewDays: 5,
      calibrationNote: 'Synthetic corpus generated from scenario template, station hotness, and rider archetype mix.',
      tripCorpusSeed: SCENARIO_SEEDS[id] + 77,
    },
  };
}

export const SCENARIO_LIBRARY: ScenarioPackage[] = [
  makeScenario(
    'weekday-spring',
    '工作日常态',
    '常规教学周的晴朗工作日，换课潮、午餐峰和闭馆回流明显。',
    'weekday',
    'clear',
    210,
    1.0,
    { 4: 1.18, 5: 1.22, 8: 1.14, 10: 1.25 },
    {
      dormitory: 0.46,
      academic_building: 0.26,
      cafeteria: 0.1,
      library: 0.08,
      sports_field: 0.04,
      main_gate: 0.06,
    },
  ),
  makeScenario(
    'rainy-commute',
    '雨天通勤',
    '全天降雨叠加寒潮，短途保留，长距离和运动需求下降，坏车率更高。',
    'weekday',
    'rainy',
    205,
    0.9,
    { 0: 1.1, 1: 1.08, 8: 1.18, 13: 1.14 },
    {
      dormitory: 0.5,
      academic_building: 0.22,
      cafeteria: 0.12,
      library: 0.06,
      sports_field: 0.02,
      main_gate: 0.08,
    },
  ),
  makeScenario(
    'exam-week',
    '考试周',
    '图书馆和教学区压力明显上升，晚间回宿舍延后，需求更集中。',
    'exam_period',
    'exam_rain',
    215,
    0.98,
    { 6: 1.1, 7: 1.14, 10: 1.36, 14: 1.08 },
    {
      dormitory: 0.42,
      academic_building: 0.27,
      cafeteria: 0.08,
      library: 0.14,
      sports_field: 0.02,
      main_gate: 0.07,
    },
  ),
  makeScenario(
    'festival-day',
    '活动日',
    '傍晚大型活动让运动场和校门成为热点，晚高峰和短时溢出都更明显。',
    'holiday',
    'festival',
    225,
    1.16,
    { 9: 1.12, 11: 1.28, 12: 1.32, 13: 1.22, 14: 1.22 },
    {
      dormitory: 0.4,
      academic_building: 0.18,
      cafeteria: 0.12,
      library: 0.06,
      sports_field: 0.12,
      main_gate: 0.12,
    },
  ),
  makeScenario(
    'weekend-freeplay',
    '周末休闲',
    '学习通勤减弱，运动、社交和短途餐饮出行更分散。',
    'saturday',
    'weekend',
    198,
    0.84,
    { 2: 1.08, 8: 1.1, 11: 1.22, 12: 1.2 },
    {
      dormitory: 0.48,
      academic_building: 0.12,
      cafeteria: 0.12,
      library: 0.08,
      sports_field: 0.12,
      main_gate: 0.08,
    },
  ),
];

export const DEFAULT_SCENARIO_ID = 'weekday-spring';

export const SCENARIO_INDEX = new Map(SCENARIO_LIBRARY.map((scenario) => [scenario.id, scenario]));

export function getScenarioById(id: string): ScenarioPackage {
  return SCENARIO_INDEX.get(id) ?? SCENARIO_INDEX.get(DEFAULT_SCENARIO_ID)!;
}

export function getDefaultScenarioForDayKind(dayKind: DayKind): ScenarioPackage {
  if (dayKind === 'exam_period') return getScenarioById('exam-week');
  if (dayKind === 'holiday') return getScenarioById('festival-day');
  if (dayKind === 'saturday' || dayKind === 'sunday') return getScenarioById('weekend-freeplay');
  return getScenarioById(DEFAULT_SCENARIO_ID);
}

export const SCENARIO_BUNDLES: ScenarioBundle[] = SCENARIO_LIBRARY.map((scenario) => ({
  scenario,
  syntheticTripCorpus: Array.from({ length: scenario.syntheticCorpus.previewDays }, (_, dayIndex) => ({
    dayIndex,
    expectedTrips: Math.round(scenario.syntheticCorpus.dailyTripTarget * (0.92 + dayIndex * 0.03)),
    dominantWeather: scenario.weatherTimeline[Math.min(dayIndex % scenario.weatherTimeline.length, scenario.weatherTimeline.length - 1)].weather,
    highlightedEvents: scenario.environmentEvents
      .slice(dayIndex % 2, dayIndex % 2 + 2)
      .map((event) => event.label),
  })),
}));
