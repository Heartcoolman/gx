import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.cwd(), 'public/generated-scenarios');

const catalog = [
  {
    id: 'weekday-spring',
    label: '工作日常态',
    description: '常规教学周的晴朗工作日，换课潮、午餐峰和闭馆回流明显。',
    dayKind: 'weekday',
    seed: 20260314,
    weatherTimeline: [
      { label: '清晨晴朗', weather: 'clear' },
      { label: '白天舒适', weather: 'clear' },
      { label: '夜间微凉', weather: 'cloudy' },
    ],
    events: ['整点换课潮', '午餐高峰', '图书馆闭馆回流'],
    syntheticTripCorpus: [
      { dayIndex: 0, expectedTrips: 428, dominantWeather: 'clear', highlightedEvents: ['整点换课潮', '午餐高峰'] },
      { dayIndex: 1, expectedTrips: 441, dominantWeather: 'clear', highlightedEvents: ['午餐高峰', '图书馆闭馆回流'] },
    ],
  },
  {
    id: 'rainy-commute',
    label: '雨天通勤',
    description: '全天降雨叠加寒潮，短途保留，长距离和运动需求下降，坏车率更高。',
    dayKind: 'weekday',
    seed: 20260315,
    weatherTimeline: [
      { label: '清晨多云', weather: 'cloudy' },
      { label: '日间降雨', weather: 'rain' },
      { label: '夜间寒潮', weather: 'cold_front' },
    ],
    events: ['整点换课潮', '午餐高峰', '图书馆闭馆回流'],
    syntheticTripCorpus: [
      { dayIndex: 0, expectedTrips: 352, dominantWeather: 'rain', highlightedEvents: ['整点换课潮', '午餐高峰'] },
      { dayIndex: 1, expectedTrips: 366, dominantWeather: 'rain', highlightedEvents: ['午餐高峰', '图书馆闭馆回流'] },
    ],
  },
  {
    id: 'exam-week',
    label: '考试周',
    description: '图书馆和教学区压力明显上升，晚间回宿舍延后，需求更集中。',
    dayKind: 'exam_period',
    seed: 20260316,
    weatherTimeline: [
      { label: '阴天备考', weather: 'cloudy' },
      { label: '午后阵雨', weather: 'rain' },
      { label: '夜间阴凉', weather: 'cloudy' },
    ],
    events: ['整点换课潮', '午餐高峰', '考试周高压'],
    syntheticTripCorpus: [
      { dayIndex: 0, expectedTrips: 448, dominantWeather: 'cloudy', highlightedEvents: ['考试周高压', '午餐高峰'] },
      { dayIndex: 1, expectedTrips: 457, dominantWeather: 'rain', highlightedEvents: ['整点换课潮', '考试周高压'] },
    ],
  },
  {
    id: 'festival-day',
    label: '活动日',
    description: '傍晚大型活动让运动场和校门成为热点，晚高峰和短时溢出都更明显。',
    dayKind: 'holiday',
    seed: 20260317,
    weatherTimeline: [
      { label: '活动日晴朗', weather: 'clear' },
    ],
    events: ['整点换课潮', '午餐高峰', '校园活动日'],
    syntheticTripCorpus: [
      { dayIndex: 0, expectedTrips: 520, dominantWeather: 'clear', highlightedEvents: ['校园活动日', '午餐高峰'] },
      { dayIndex: 1, expectedTrips: 538, dominantWeather: 'clear', highlightedEvents: ['整点换课潮', '校园活动日'] },
    ],
  },
  {
    id: 'weekend-freeplay',
    label: '周末休闲',
    description: '学习通勤减弱，运动、社交和短途餐饮出行更分散。',
    dayKind: 'saturday',
    seed: 20260318,
    weatherTimeline: [
      { label: '周末清晨', weather: 'clear' },
      { label: '周末午后', weather: 'clear' },
      { label: '周末夜晚', weather: 'cloudy' },
    ],
    events: ['整点换课潮', '午餐高峰', '周末运动热区'],
    syntheticTripCorpus: [
      { dayIndex: 0, expectedTrips: 356, dominantWeather: 'clear', highlightedEvents: ['周末运动热区', '午餐高峰'] },
      { dayIndex: 1, expectedTrips: 369, dominantWeather: 'cloudy', highlightedEvents: ['周末运动热区'] },
    ],
  },
];

fs.mkdirSync(outDir, { recursive: true });

const manifest = {
  version: '2.0.0',
  generatedAt: new Date().toISOString(),
  scenarios: catalog.map(({ id, label, description, dayKind, seed }) => ({
    id,
    label,
    description,
    dayKind,
    seed,
  })),
};

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

for (const entry of catalog) {
  const bundle = {
    version: '2.0.0',
    scenario: {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      dayKind: entry.dayKind,
      seed: entry.seed,
      weatherTimeline: entry.weatherTimeline,
      events: entry.events,
    },
    syntheticTripCorpus: entry.syntheticTripCorpus,
  };

  fs.writeFileSync(
    path.join(outDir, `${entry.id}.json`),
    `${JSON.stringify(bundle, null, 2)}\n`,
    'utf8',
  );
}

console.log(`Generated ${catalog.length} scenario bundles in ${outDir}`);
