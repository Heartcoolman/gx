/**
 * CLI benchmark runner — run with: npx tsx scripts/bench.ts
 * Simulates N days and reports block rate / satisfaction rate.
 * Talks to the Rust backend at localhost:3001.
 */

// ─── Inline the core logic (avoid browser imports) ───

const API = 'http://localhost:3001/api/v1';

// --- Tunable parameters (EDIT THESE) ---
const DAYS = 2;
const VEHICLE_COUNT = 8;
const VEHICLE_CAPACITY = 30;
const REBALANCE_EVERY_SLOTS = 1;   // 2 = every 30min, 1 = every 15min
const SAFETY_BUFFER = 0.40;
const PEAK_MULTIPLIER = 2.5;
const PREDICTION_HORIZON = 12;     // 3 hours lookahead
const PEAK_PERCENTILE = 0.3;       // lower = more stations get peak multiplier
const EWMA_ALPHA = 0.5;            // higher = more responsive to recent data
const WARMUP_DAYS = 3;             // more warmup = better predictor
// ----------------------------------------

interface Station {
  id: number; name: string; category: string; capacity: number;
  latitude: number; longitude: number;
}

const STATIONS: Station[] = [
  { id: 0, name: '东区宿舍A', category: 'dormitory', capacity: 30, latitude: 28.7838, longitude: 115.8590 },
  { id: 1, name: '东区宿舍B', category: 'dormitory', capacity: 30, latitude: 28.7843, longitude: 115.8615 },
  { id: 2, name: '西区宿舍A', category: 'dormitory', capacity: 30, latitude: 28.7840, longitude: 115.8545 },
  { id: 3, name: '西区宿舍B', category: 'dormitory', capacity: 30, latitude: 28.7835, longitude: 115.8520 },
  { id: 4, name: '第一教学楼', category: 'academic_building', capacity: 25, latitude: 28.7885, longitude: 115.8560 },
  { id: 5, name: '第二教学楼', category: 'academic_building', capacity: 25, latitude: 28.7890, longitude: 115.8590 },
  { id: 6, name: '实验楼', category: 'academic_building', capacity: 25, latitude: 28.7895, longitude: 115.8540 },
  { id: 7, name: '实训中心', category: 'academic_building', capacity: 25, latitude: 28.7900, longitude: 115.8620 },
  { id: 8, name: '第一食堂', category: 'cafeteria', capacity: 20, latitude: 28.7860, longitude: 115.8555 },
  { id: 9, name: '第二食堂', category: 'cafeteria', capacity: 20, latitude: 28.7862, longitude: 115.8600 },
  { id: 10, name: '图书馆', category: 'library', capacity: 20, latitude: 28.7875, longitude: 115.8578 },
  { id: 11, name: '体育馆', category: 'sports_field', capacity: 15, latitude: 28.7870, longitude: 115.8505 },
  { id: 12, name: '运动场', category: 'sports_field', capacity: 15, latitude: 28.7880, longitude: 115.8498 },
  { id: 13, name: '南大门', category: 'main_gate', capacity: 15, latitude: 28.7825, longitude: 115.8575 },
  { id: 14, name: '北大门', category: 'main_gate', capacity: 15, latitude: 28.7922, longitude: 115.8580 },
];

const TOTAL_BIKES = 200;

// Haversine
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
const distMatrix = STATIONS.map(a => STATIONS.map(b => haversine(a.latitude, a.longitude, b.latitude, b.longitude)));

// Demand profiles
function makeProfile(peaks: [number,number,number][]): number[] {
  const arr = new Array(96).fill(0.1);
  for (const [s, e, v] of peaks) {
    const mid = (s+e)/2, hw = (e-s)/2;
    for (let i = s; i <= e && i < 96; i++) {
      const d = Math.abs(i - mid) / hw;
      arr[i] = v * (1 - 0.5*d*d);
    }
  }
  return arr;
}
const PROFILES: Record<string, { pickup: number[]; ret: number[] }> = {
  dormitory:         { pickup: makeProfile([[28,35,1.8],[44,48,0.6],[68,76,0.7]]), ret: makeProfile([[68,76,1.8],[36,40,0.5],[28,32,0.3]]) },
  academic_building: { pickup: makeProfile([[36,40,0.5],[48,52,0.4],[68,76,1.6]]), ret: makeProfile([[28,35,1.6],[52,56,0.6],[44,48,0.4]]) },
  cafeteria:         { pickup: makeProfile([[24,28,0.8],[44,48,1.2],[68,72,0.9]]), ret: makeProfile([[26,30,0.8],[46,50,1.2],[70,74,0.9]]) },
  library:           { pickup: makeProfile([[80,88,1.5],[48,52,0.4]]),              ret: makeProfile([[32,48,0.8],[52,68,0.9],[28,32,0.5]]) },
  sports_field:      { pickup: makeProfile([[64,72,1.2],[76,80,0.6]]),              ret: makeProfile([[72,80,1.2],[64,68,0.4]]) },
  main_gate:         { pickup: makeProfile([[68,76,0.8],[80,88,0.5]]),              ret: makeProfile([[28,36,0.8],[8,16,0.4]]) },
};
const BASE_RATE: Record<string, number> = { dormitory:4, academic_building:3, cafeteria:2.5, library:2, sports_field:1.5, main_gate:1 };
const AFFINITY: Record<string, Record<string, number>> = {
  dormitory: { dormitory:0.05, academic_building:0.35, cafeteria:0.25, library:0.15, sports_field:0.10, main_gate:0.10 },
  academic_building: { dormitory:0.35, academic_building:0.05, cafeteria:0.20, library:0.20, sports_field:0.05, main_gate:0.15 },
  cafeteria: { dormitory:0.30, academic_building:0.25, cafeteria:0.05, library:0.15, sports_field:0.10, main_gate:0.15 },
  library: { dormitory:0.30, academic_building:0.20, cafeteria:0.20, library:0.05, sports_field:0.10, main_gate:0.15 },
  sports_field: { dormitory:0.35, academic_building:0.10, cafeteria:0.20, library:0.10, sports_field:0.10, main_gate:0.15 },
  main_gate: { dormitory:0.25, academic_building:0.20, cafeteria:0.15, library:0.15, sports_field:0.10, main_gate:0.15 },
};

function gaussian(mean: number, sigma: number): number {
  const u1 = Math.random(), u2 = Math.random();
  return Math.max(0, mean + Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2)*sigma);
}
function weightedPick(w: number[]): number {
  const t = w.reduce((a,b)=>a+b,0);
  if (t===0) return Math.floor(Math.random()*w.length);
  let r = Math.random()*t;
  for (let i=0;i<w.length;i++) { r-=w[i]; if(r<=0) return i; }
  return w.length-1;
}

interface Ride { origin:number; destination:number; departure_time:string; arrival_time:string; }

function generateDemand(slotIndex: number, baseISO: string): Ride[] {
  const rides: Ride[] = [];
  for (const st of STATIONS) {
    const prof = PROFILES[st.category];
    const rate = prof.pickup[slotIndex] * BASE_RATE[st.category];
    const count = Math.round(gaussian(rate, rate*0.2));
    for (let i=0; i<count; i++) {
      const aff = AFFINITY[st.category];
      const weights = STATIONS.map(s => s.id===st.id ? 0 : aff[s.category]/Math.max(distMatrix[st.id][s.id],50));
      const dest = weightedPick(weights);
      if (dest===st.id) continue;
      const base = new Date(baseISO);
      const dep = new Date(base.getTime() + Math.random()*15*60*1000);
      const arr = new Date(dep.getTime() + (distMatrix[st.id][dest]/3)*1000 + 60000);
      rides.push({ origin:st.id, destination:dest, departure_time:dep.toISOString(), arrival_time:arr.toISOString() });
    }
  }
  return rides;
}

// State manager
class State {
  bikes: number[];
  totalRides = 0;
  blockedCount = 0;
  inTransit: Ride[] = [];
  constructor() {
    this.bikes = new Array(15).fill(0);
    // 70% in dorms
    const perDorm = Math.floor(TOTAL_BIKES*0.7/4);
    for (let i=0;i<4;i++) this.bikes[i]=Math.min(perDorm, 30);
    let rem = TOTAL_BIKES - this.bikes.slice(0,4).reduce((a,b)=>a+b,0);
    const others = STATIONS.filter(s=>s.id>=4);
    const totalCap = others.reduce((s,st)=>s+st.capacity,0);
    for (const st of others) {
      const share = Math.round(st.capacity/totalCap*rem);
      this.bikes[st.id] = Math.min(share, st.capacity);
    }
    let total = this.bikes.reduce((a,b)=>a+b,0);
    while (total<TOTAL_BIKES) { for(let i=0;i<15&&total<TOTAL_BIKES;i++) { if(this.bikes[i]<STATIONS[i].capacity){this.bikes[i]++;total++;} } }
  }
  depart(rides: Ride[]): Ride[] {
    const acc: Ride[] = [];
    for (const r of rides) {
      if (this.bikes[r.origin]>0) { this.bikes[r.origin]--; acc.push(r); this.totalRides++; this.inTransit.push(r); }
      else this.blockedCount++;
    }
    return acc;
  }
  arrive(nowISO: string) {
    const nowMs = new Date(nowISO).getTime();
    const remaining: Ride[] = [];
    for (const r of this.inTransit) {
      if (new Date(r.arrival_time).getTime() <= nowMs) {
        const space = STATIONS[r.destination].capacity - this.bikes[r.destination];
        if (space > 0) this.bikes[r.destination]++;
        // else bike is "lost" (overflow) — rare edge case
      } else {
        remaining.push(r);
      }
    }
    this.inTransit = remaining;
  }
  applyPlan(plan: any) {
    for (const route of plan.vehicle_routes ?? []) {
      for (const stop of route.stops ?? []) {
        const sid = typeof stop.station_id === 'object' ? stop.station_id[0] ?? stop.station_id : stop.station_id;
        if (stop.action === 'pickup') {
          const actual = Math.min(stop.bike_count, this.bikes[sid]);
          this.bikes[sid] -= actual;
        } else {
          const space = STATIONS[sid].capacity - this.bikes[sid];
          this.bikes[sid] += Math.min(stop.bike_count, space);
        }
      }
    }
  }
  buildStatus() {
    return STATIONS.map(st => ({
      station_id: st.id,
      available_bikes: this.bikes[st.id],
      available_docks: st.capacity - this.bikes[st.id],
      timestamp: Math.floor(Date.now()/1000),
    }));
  }
}

// API helpers
async function post(path: string, body: any) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return res.json();
}
async function putConfig(cfg: any) {
  const res = await fetch(`${API}/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
  });
  return res.json();
}
async function getConfigApi() {
  const res = await fetch(`${API}/config`);
  return res.json();
}

// ─── Main ───
async function main() {
  console.log('=== 基准测试 ===');
  console.log(`参数: 车辆=${VEHICLE_COUNT} 容量=${VEHICLE_CAPACITY} 间隔=${REBALANCE_EVERY_SLOTS*15}min 缓冲=${SAFETY_BUFFER} 峰值=${PEAK_MULTIPLIER}x 预测=${PREDICTION_HORIZON}槽`);
  console.log(`模拟: ${DAYS}天 (${DAYS*96}个时段)\n`);

  // Update backend config
  const cfg = await getConfigApi();
  await putConfig({
    ...cfg,
    safety_buffer_ratio: SAFETY_BUFFER,
    peak_multiplier: PEAK_MULTIPLIER,
    prediction_horizon_slots: PREDICTION_HORIZON,
    dispatch_vehicle_count: VEHICLE_COUNT,
    dispatch_vehicle_capacity: VEHICLE_CAPACITY,
    rebalance_interval_minutes: REBALANCE_EVERY_SLOTS * 15,
    peak_percentile: PEAK_PERCENTILE,
    ewma_alpha: EWMA_ALPHA,
  });

  const totalSlots = DAYS * 96;

  // --- Phase 1: No dispatch ---
  console.log('--- 第1轮: 无调度 ---');
  const s1 = new State();
  for (let i = 0; i < totalSlots; i++) {
    const slot = i % 96;
    const t = new Date(); t.setHours(0,0,0,0);
    const iso = new Date(t.getTime() + slot*15*60*1000).toISOString();
    const endIso = new Date(t.getTime() + (slot+1)*15*60*1000).toISOString();
    const rides = generateDemand(slot, iso);
    s1.depart(rides);
    s1.arrive(endIso);
  }
  const total1 = s1.totalRides + s1.blockedCount;
  const br1 = total1>0 ? s1.blockedCount/total1 : 0;
  console.log(`  骑行=${s1.totalRides} 阻塞=${s1.blockedCount} 阻塞率=${(br1*100).toFixed(1)}% 满足率=${((1-br1)*100).toFixed(1)}%`);

  // --- Phase 2: With dispatch ---
  console.log('\n--- 第2轮: 有调度 ---');
  // Warmup: send multiple days of history
  console.log(`  预热中... (${WARMUP_DAYS}天数据)`);
  for (let day = 0; day < WARMUP_DAYS; day++) {
    for (let slot = 0; slot < 96; slot++) {
      const t = new Date(); t.setHours(0,0,0,0);
      const iso = new Date(t.getTime() + slot*15*60*1000).toISOString();
      const rides = generateDemand(slot, iso);
      if (rides.length > 0) {
        await post('/predict/observe', { records: rides, day_kind: 'weekday' });
      }
    }
  }

  const s2 = new State();
  let slotsSinceReb = 0;
  let dispatchCount = 0, bikesMoved = 0;

  for (let i = 0; i < totalSlots; i++) {
    const slot = i % 96;
    const t = new Date(); t.setHours(0,0,0,0);
    const iso = new Date(t.getTime() + slot*15*60*1000).toISOString();
    const endIso = new Date(t.getTime() + (slot+1)*15*60*1000).toISOString();
    const rides = generateDemand(slot, iso);
    const accepted = s2.depart(rides);
    s2.arrive(endIso);

    // Feed observations
    if (accepted.length > 0) {
      await post('/predict/observe', { records: accepted, day_kind: 'weekday' });
    }

    slotsSinceReb++;
    if (slotsSinceReb >= REBALANCE_EVERY_SLOTS) {
      slotsSinceReb = 0;
      const vehicles = Array.from({length: VEHICLE_COUNT}, (_, vi) => ({
        id: vi, capacity: VEHICLE_CAPACITY, current_position: 0,
      }));
      try {
        const resp = await post('/rebalance/cycle', {
          stations: STATIONS,
          current_status: s2.buildStatus(),
          distance_matrix: distMatrix,
          vehicles,
          current_slot: { day_kind: 'weekday', slot_index: slot },
        });
        if (i < 5 || i === 28 || i === 29 || i === 30 || i === 68 || i === 69 || (i % 48 === 0)) {
          const targets = (resp.targets ?? []).map((t: any) => `${STATIONS[t.station_id]?.name?.slice(0,2) ?? t.station_id}:${t.target_bikes}${t.is_peak?'*':''}`).join(' ');
          const bikes = s2.bikes.map((b: number,idx: number) => `${STATIONS[idx].name.slice(0,2)}:${b}`).join(' ');
          const plan = resp.dispatch_plan ?? resp;
          console.log(`  [slot ${i} (${Math.floor(i%96/4)}:${(i%96%4)*15 || '00'})] bikes=[${bikes}] targets=[${targets}] moved=${plan.total_bikes_moved}`);
        }
        s2.applyPlan(resp.dispatch_plan ?? resp);
        dispatchCount++;
        bikesMoved += resp.dispatch_plan?.total_bikes_moved ?? 0;
      } catch (e) {
        console.error('  dispatch error:', e);
      }
    }

    if (i % 48 === 47) {
      const total = s2.totalRides + s2.blockedCount;
      const br = total>0 ? s2.blockedCount/total : 0;
      const bikeStr = s2.bikes.map((b,idx) => `${STATIONS[idx].name.slice(0,2)}:${b}`).join(' ');
      console.log(`  slot ${i+1}/${totalSlots}: 阻塞率=${(br*100).toFixed(1)}% 在途=${s2.inTransit.length} 分布=[${bikeStr}]`);
    }
  }

  const total2 = s2.totalRides + s2.blockedCount;
  const br2 = total2>0 ? s2.blockedCount/total2 : 0;
  console.log(`\n  骑行=${s2.totalRides} 阻塞=${s2.blockedCount} 阻塞率=${(br2*100).toFixed(1)}% 满足率=${((1-br2)*100).toFixed(1)}%`);
  console.log(`  调度=${dispatchCount}次 移动=${bikesMoved}辆次`);

  // --- Summary ---
  console.log('\n=== 对比 ===');
  console.log(`         无调度    有调度    改善`);
  console.log(`阻塞率   ${(br1*100).toFixed(1).padStart(5)}%   ${(br2*100).toFixed(1).padStart(5)}%   ${(((br1-br2)/br1)*100).toFixed(1)}%`);
  console.log(`满足率   ${((1-br1)*100).toFixed(1).padStart(5)}%   ${((1-br2)*100).toFixed(1).padStart(5)}%`);
  console.log(`\n车辆分布:`);
  for (const st of STATIONS) {
    const bar1 = '█'.repeat(Math.round(s1.bikes[st.id]/st.capacity*20)).padEnd(20);
    const bar2 = '█'.repeat(Math.round(s2.bikes[st.id]/st.capacity*20)).padEnd(20);
    console.log(`  ${st.name.padEnd(8)} ${bar1} ${s1.bikes[st.id].toString().padStart(2)}/${st.capacity} | ${bar2} ${s2.bikes[st.id].toString().padStart(2)}/${st.capacity}`);
  }
}

main().catch(console.error);
