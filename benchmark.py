#!/usr/bin/env python3
"""
Benchmark: dispatch ON vs OFF via direct API calls.

Usage:
    python3 benchmark.py          # default 2-day sim
    python3 benchmark.py --days 3 # 3-day sim
"""
import argparse
import json
import math
import random
import sys
import time
import urllib.request
import urllib.error

API = "http://localhost:3001/api/v1"

# ── HTTP helpers (stdlib only) ──

def api_post(path, payload):
    """POST JSON to API, return parsed JSON response."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(f"{API}{path}", data=data,
                                headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))

def api_get(path):
    """GET from API, return parsed JSON response."""
    req = urllib.request.Request(f"{API}{path}")
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))

# ── Station data (mirrors web/src/data/stations.ts) ──

STATIONS = [
    {"id": 0,  "name": "东区宿舍A",  "category": "dormitory",          "capacity": 30, "latitude": 28.7838, "longitude": 115.8590},
    {"id": 1,  "name": "东区宿舍B",  "category": "dormitory",          "capacity": 30, "latitude": 28.7843, "longitude": 115.8615},
    {"id": 2,  "name": "西区宿舍A",  "category": "dormitory",          "capacity": 30, "latitude": 28.7840, "longitude": 115.8545},
    {"id": 3,  "name": "西区宿舍B",  "category": "dormitory",          "capacity": 30, "latitude": 28.7835, "longitude": 115.8520},
    {"id": 4,  "name": "第一教学楼",  "category": "academic_building",  "capacity": 25, "latitude": 28.7885, "longitude": 115.8560},
    {"id": 5,  "name": "第二教学楼",  "category": "academic_building",  "capacity": 25, "latitude": 28.7890, "longitude": 115.8590},
    {"id": 6,  "name": "实验楼",     "category": "academic_building",  "capacity": 25, "latitude": 28.7895, "longitude": 115.8540},
    {"id": 7,  "name": "实训中心",   "category": "academic_building",  "capacity": 25, "latitude": 28.7900, "longitude": 115.8620},
    {"id": 8,  "name": "第一食堂",   "category": "cafeteria",          "capacity": 20, "latitude": 28.7860, "longitude": 115.8555},
    {"id": 9,  "name": "第二食堂",   "category": "cafeteria",          "capacity": 20, "latitude": 28.7862, "longitude": 115.8600},
    {"id": 10, "name": "图书馆",     "category": "library",            "capacity": 20, "latitude": 28.7875, "longitude": 115.8578},
    {"id": 11, "name": "体育馆",     "category": "sports_field",       "capacity": 15, "latitude": 28.7870, "longitude": 115.8505},
    {"id": 12, "name": "运动场",     "category": "sports_field",       "capacity": 15, "latitude": 28.7880, "longitude": 115.8498},
    {"id": 13, "name": "南大门",     "category": "main_gate",          "capacity": 15, "latitude": 28.7825, "longitude": 115.8575},
    {"id": 14, "name": "北大门",     "category": "main_gate",          "capacity": 15, "latitude": 28.7922, "longitude": 115.8580},
]

TOTAL_BIKES = 200
NUM_STATIONS = len(STATIONS)
DORM_IDS = [0, 1, 2, 3]

BASE_RIDES_PER_SLOT = {
    "dormitory": 4.0, "academic_building": 3.0, "cafeteria": 2.5,
    "library": 2.0, "sports_field": 1.5, "main_gate": 1.0,
}

CATEGORY_AFFINITY = {
    "dormitory":         {"dormitory": 0.05, "academic_building": 0.35, "cafeteria": 0.25, "library": 0.15, "sports_field": 0.10, "main_gate": 0.10},
    "academic_building": {"dormitory": 0.35, "academic_building": 0.05, "cafeteria": 0.20, "library": 0.20, "sports_field": 0.05, "main_gate": 0.15},
    "cafeteria":         {"dormitory": 0.30, "academic_building": 0.25, "cafeteria": 0.05, "library": 0.15, "sports_field": 0.10, "main_gate": 0.15},
    "library":           {"dormitory": 0.30, "academic_building": 0.20, "cafeteria": 0.20, "library": 0.05, "sports_field": 0.10, "main_gate": 0.15},
    "sports_field":      {"dormitory": 0.35, "academic_building": 0.10, "cafeteria": 0.20, "library": 0.10, "sports_field": 0.10, "main_gate": 0.15},
    "main_gate":         {"dormitory": 0.25, "academic_building": 0.20, "cafeteria": 0.15, "library": 0.15, "sports_field": 0.10, "main_gate": 0.15},
}

# ── Demand profiles (mirrors web/src/data/demandProfiles.ts) ──

def make_profile(peak_defs):
    arr = [0.1] * 96
    for start, end, peak_val in peak_defs:
        mid = (start + end) / 2
        half_w = (end - start) / 2
        for i in range(start, min(end + 1, 96)):
            dist = abs(i - mid) / half_w if half_w > 0 else 0
            arr[i] = peak_val * (1 - 0.5 * dist * dist)
    return arr

PICKUP_PROFILES = {
    "dormitory":         make_profile([(28, 35, 1.8), (44, 48, 0.6), (68, 76, 0.7)]),
    "academic_building": make_profile([(36, 40, 0.5), (48, 52, 0.4), (68, 76, 1.6)]),
    "cafeteria":         make_profile([(24, 28, 0.8), (44, 48, 1.2), (68, 72, 0.9)]),
    "library":           make_profile([(80, 88, 1.5), (48, 52, 0.4)]),
    "sports_field":      make_profile([(64, 72, 1.2), (76, 80, 0.6)]),
    "main_gate":         make_profile([(68, 76, 0.8), (80, 88, 0.5)]),
}

# ── Distance matrix (haversine approx) ──

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return 2 * R * math.asin(math.sqrt(a))

DIST_MATRIX = [[haversine(s1["latitude"], s1["longitude"], s2["latitude"], s2["longitude"])
                 for s2 in STATIONS] for s1 in STATIONS]

# ── Demand generator ──

def gaussian_noise(mean, sigma):
    u1 = max(random.random(), 1e-10)
    u2 = random.random()
    z = math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)
    return max(0, mean + z * sigma)

def weighted_pick(weights):
    total = sum(weights)
    if total == 0:
        return random.randint(0, len(weights) - 1)
    r = random.random() * total
    for i, w in enumerate(weights):
        r -= w
        if r <= 0:
            return i
    return len(weights) - 1

def pick_destination(origin_id, origin_cat):
    aff = CATEGORY_AFFINITY[origin_cat]
    weights = []
    for s in STATIONS:
        if s["id"] == origin_id:
            weights.append(0)
        else:
            cat_aff = aff[s["category"]]
            dist = max(DIST_MATRIX[origin_id][s["id"]], 50)
            weights.append(cat_aff / dist)
    return weighted_pick(weights)

def generate_demand(slot_index, base_time_iso):
    """Generate demand records for a given time slot."""
    records = []
    for st in STATIONS:
        cat = st["category"]
        profile = PICKUP_PROFILES[cat]
        base_rate = BASE_RIDES_PER_SLOT[cat]
        pickup_rate = profile[slot_index] * base_rate
        pickup_count = round(gaussian_noise(pickup_rate, pickup_rate * 0.2))
        for _ in range(pickup_count):
            dest = pick_destination(st["id"], cat)
            if dest == st["id"]:
                continue
            offset_s = random.random() * 15 * 60
            dep_ts = base_time_iso + offset_s
            dist = DIST_MATRIX[st["id"]][dest]
            travel_s = dist / 3 + 60
            arr_ts = dep_ts + travel_s
            records.append({
                "origin": st["id"],
                "destination": dest,
                "dep_ts": dep_ts,
                "arr_ts": arr_ts,
            })
    return records

# ── Simulation state manager ──

class StationState:
    def __init__(self):
        self.bikes = [0] * NUM_STATIONS
        self.total_rides = 0
        self.blocked = 0
        self._init_distribution()
        self.snapshots = []

    def _init_distribution(self):
        dorm_bikes = round(TOTAL_BIKES * 0.7)
        per_dorm = dorm_bikes // len(DORM_IDS)
        for did in DORM_IDS:
            self.bikes[did] = min(per_dorm, STATIONS[did]["capacity"])
        remaining = TOTAL_BIKES - sum(self.bikes[d] for d in DORM_IDS)
        others = [s for s in STATIONS if s["id"] not in DORM_IDS]
        total_cap = sum(s["capacity"] for s in others)
        for s in others:
            share = round((s["capacity"] / total_cap) * remaining)
            self.bikes[s["id"]] = min(share, s["capacity"])
        total = sum(self.bikes)
        while total < TOTAL_BIKES:
            for i in range(NUM_STATIONS):
                if total >= TOTAL_BIKES:
                    break
                if self.bikes[i] < STATIONS[i]["capacity"]:
                    self.bikes[i] += 1
                    total += 1

    def process_departures(self, records):
        accepted = []
        for r in records:
            oid = r["origin"]
            if self.bikes[oid] > 0:
                self.bikes[oid] -= 1
                self.total_rides += 1
                accepted.append(r)
            else:
                self.blocked += 1
        return accepted

    def process_arrivals(self, records):
        for r in records:
            did = r["destination"]
            if self.bikes[did] < STATIONS[did]["capacity"]:
                self.bikes[did] += 1
            else:
                for s in STATIONS:
                    if self.bikes[s["id"]] < s["capacity"]:
                        self.bikes[s["id"]] += 1
                        break

    def apply_dispatch(self, plan):
        for route in plan.get("vehicle_routes", []):
            for stop in route.get("stops", []):
                sid = stop["station_id"]
                if stop["action"] == "pickup":
                    actual = min(stop["bike_count"], self.bikes[sid])
                    self.bikes[sid] -= actual
                else:
                    space = STATIONS[sid]["capacity"] - self.bikes[sid]
                    actual = min(stop["bike_count"], space)
                    self.bikes[sid] += actual

    def build_status(self, timestamp):
        return [
            {"station_id": s["id"], "available_bikes": self.bikes[s["id"]],
             "available_docks": s["capacity"] - self.bikes[s["id"]], "timestamp": timestamp}
            for s in STATIONS
        ]

    def snapshot(self, slot_idx):
        self.snapshots.append({
            "slot": slot_idx,
            "bikes": list(self.bikes),
            "rides": self.total_rides,
            "blocked": self.blocked,
        })

# ── Run one phase ──

def run_phase(day_kind, total_slots, dispatch_enabled, rebalance_interval=2,
              vehicle_count=3, vehicle_capacity=15, seed=42):
    random.seed(seed)
    sm = StationState()
    dispatch_count = 0
    total_moved = 0
    slots_since_rebalance = 0

    # Warmup predictor if dispatch is enabled
    if dispatch_enabled:
        print("    预热预测模型 (96 slots)...", end="", flush=True)
        random.seed(seed + 1000)
        for s in range(96):
            base_time = s * 15 * 60.0
            recs = generate_demand(s, base_time)
            hour = (s * 15) // 60
            minute = (s * 15) % 60
            api_recs = [{"origin": r["origin"], "destination": r["destination"],
                         "departure_time": f"2026-03-13T{hour:02d}:{minute:02d}:00Z",
                         "arrival_time": f"2026-03-13T{hour:02d}:{min(minute+10,59):02d}:00Z"
                         } for r in recs[:20]]
            if api_recs:
                try:
                    api_post("/predict/observe", {"records": api_recs, "day_kind": day_kind})
                except Exception:
                    pass
        print(" 完成")
        random.seed(seed)

    for i in range(total_slots):
        slot_idx = i % 96
        base_time = slot_idx * 15 * 60.0

        recs = generate_demand(slot_idx, base_time)
        accepted = sm.process_departures(recs)
        sm.process_arrivals(accepted)

        # Feed backend predictor
        if dispatch_enabled and accepted:
            hour = (slot_idx * 15) // 60
            minute = (slot_idx * 15) % 60
            api_recs = [{"origin": r["origin"], "destination": r["destination"],
                         "departure_time": f"2026-03-13T{hour:02d}:{minute:02d}:00Z",
                         "arrival_time": f"2026-03-13T{hour:02d}:{min(minute+10,59):02d}:00Z"
                         } for r in accepted[:30]]
            try:
                api_post("/predict/observe", {"records": api_recs, "day_kind": day_kind})
            except Exception:
                pass

        slots_since_rebalance += 1

        # Dispatch
        if dispatch_enabled and slots_since_rebalance >= rebalance_interval:
            slots_since_rebalance = 0
            ts = int(time.time())
            vehicles = [{"id": v, "capacity": vehicle_capacity, "current_position": 0}
                        for v in range(vehicle_count)]
            try:
                data = api_post("/rebalance/cycle", {
                    "stations": STATIONS,
                    "current_status": sm.build_status(ts),
                    "distance_matrix": DIST_MATRIX,
                    "vehicles": vehicles,
                    "current_slot": {"day_kind": day_kind, "slot_index": slot_idx},
                })
                plan = data["dispatch_plan"]
                sm.apply_dispatch(plan)
                dispatch_count += 1
                total_moved += plan["total_bikes_moved"]
            except Exception:
                pass

        sm.snapshot(slot_idx)

        if (i + 1) % 24 == 0 or i == total_slots - 1:
            pct = (i + 1) / total_slots * 100
            print(f"\r    进度: {i+1}/{total_slots} ({pct:.0f}%)  "
                  f"骑行={sm.total_rides}  阻塞={sm.blocked}", end="", flush=True)

    print()

    total_attempts = sm.total_rides + sm.blocked
    block_rate = sm.blocked / total_attempts if total_attempts > 0 else 0
    satisfaction = sm.total_rides / total_attempts if total_attempts > 0 else 1
    ratios = [sm.bikes[s["id"]] / s["capacity"] for s in STATIONS]
    mean_r = sum(ratios) / len(ratios)
    var_r = sum((r - mean_r)**2 for r in ratios) / len(ratios)

    return {
        "total_rides": sm.total_rides,
        "blocked": sm.blocked,
        "block_rate": block_rate,
        "satisfaction": satisfaction,
        "dispatch_count": dispatch_count,
        "total_moved": total_moved,
        "bike_std_dev": math.sqrt(var_r),
        "final_bikes": list(sm.bikes),
        "snapshots": sm.snapshots,
    }

# ── Main ──

def main():
    parser = argparse.ArgumentParser(description="Benchmark dispatch ON vs OFF")
    parser.add_argument("--days", type=int, default=2, help="Number of simulated days")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    total_slots = args.days * 96
    print(f"\n{'='*60}")
    print(f"  校园共享单车调度算法 A/B 对比实验")
    print(f"  模拟天数: {args.days}天 ({total_slots} 个15分钟时段)")
    print(f"  随机种子: {args.seed}")
    print(f"{'='*60}\n")

    # Check backend
    try:
        api_get("/config")
        print("  ✅ 后端 API 已连接\n")
    except Exception:
        print("  ❌ 后端 API 未启动 (http://localhost:3001)")
        print("     请先运行: PORT=3001 cargo run --release -p bike-server")
        sys.exit(1)

    # Phase 1: No dispatch
    print("━" * 60)
    print("  Phase 1: 无调度（自然流动）")
    print("━" * 60)
    baseline = run_phase("weekday", total_slots, dispatch_enabled=False, seed=args.seed)

    # Phase 2: With dispatch
    print("\n" + "━" * 60)
    print("  Phase 2: 有调度（贪心调度 + VRP + 价格激励）")
    print("━" * 60)
    optimized = run_phase("weekday", total_slots, dispatch_enabled=True, seed=args.seed)

    # ── Results ──
    print("\n" + "=" * 60)
    print("  📊 对比结果")
    print("=" * 60)

    def delta(base_val, opt_val, lower_is_better=False):
        if base_val == 0:
            return "-"
        d = (opt_val - base_val) / base_val * 100
        arrow = "↓" if d < 0 else "↑"
        good = (d < 0) if lower_is_better else (d > 0)
        mark = "✅" if good else "🔴"
        return f"{mark} {arrow}{abs(d):.1f}%"

    header = f"  {'指标':<14s}  {'无调度':>10s}  {'有调度':>10s}  {'变化':>14s}"
    print(header)
    print("  " + "-" * 56)

    rows = [
        ("总骑行数",   str(baseline["total_rides"]),   str(optimized["total_rides"]),   delta(baseline["total_rides"], optimized["total_rides"])),
        ("阻塞次数",   str(baseline["blocked"]),        str(optimized["blocked"]),        delta(baseline["blocked"], optimized["blocked"], True)),
        ("阻塞率",     f'{baseline["block_rate"]*100:.1f}%', f'{optimized["block_rate"]*100:.1f}%', delta(baseline["block_rate"], optimized["block_rate"], True)),
        ("满足率",     f'{baseline["satisfaction"]*100:.1f}%', f'{optimized["satisfaction"]*100:.1f}%', delta(baseline["satisfaction"], optimized["satisfaction"])),
        ("均衡度(σ)",  f'{baseline["bike_std_dev"]:.3f}',     f'{optimized["bike_std_dev"]:.3f}',     delta(baseline["bike_std_dev"], optimized["bike_std_dev"], True)),
        ("调度次数",   "-",                             str(optimized["dispatch_count"]), ""),
        ("移动车辆次", "-",                             str(optimized["total_moved"]),     ""),
    ]
    for label, bv, ov, dv in rows:
        print(f"  {label:<14s}  {bv:>10s}  {ov:>10s}  {dv:>14s}")

    # ── Per-station final distribution ──
    print("\n" + "=" * 60)
    print("  🚲 各站点最终车辆分布")
    print("=" * 60)
    print(f"  {'站点':<12s}  {'容量':>4s}  {'无调度':>6s}  {'有调度':>6s}  {'差值':>6s}")
    print("  " + "-" * 42)
    for s in STATIONS:
        sid = s["id"]
        b_bikes = baseline["final_bikes"][sid]
        o_bikes = optimized["final_bikes"][sid]
        diff = o_bikes - b_bikes
        sign = "+" if diff > 0 else ""
        print(f"  {s['name']:<12s}  {s['capacity']:>4d}  {b_bikes:>6d}  {o_bikes:>6d}  {sign}{diff:>5d}")

    # ── Hourly breakdown (1st day) ──
    print("\n" + "=" * 60)
    print("  📈 逐时段阻塞率变化 (第1天)")
    print("=" * 60)
    print(f"  {'时段':<12s}  {'无调度阻塞':>10s}  {'有调度阻塞':>10s}")
    print("  " + "-" * 36)
    for hour in range(24):
        slot_start = hour * 4
        slot_end = slot_start + 4
        b_blocked = 0
        o_blocked = 0
        b_rides = 0
        o_rides = 0
        for si in range(slot_start, min(slot_end, len(baseline["snapshots"]))):
            snap_b = baseline["snapshots"][si]
            snap_o = optimized["snapshots"][si]
            if si == 0:
                b_blocked += snap_b["blocked"]
                o_blocked += snap_o["blocked"]
                b_rides += snap_b["rides"]
                o_rides += snap_o["rides"]
            else:
                prev_b = baseline["snapshots"][si - 1]
                prev_o = optimized["snapshots"][si - 1]
                b_blocked += snap_b["blocked"] - prev_b["blocked"]
                o_blocked += snap_o["blocked"] - prev_o["blocked"]
                b_rides += snap_b["rides"] - prev_b["rides"]
                o_rides += snap_o["rides"] - prev_o["rides"]
        b_total = b_rides + b_blocked
        o_total = o_rides + o_blocked
        b_rate = f"{b_blocked/b_total*100:.1f}%" if b_total > 0 else "0.0%"
        o_rate = f"{o_blocked/o_total*100:.1f}%" if o_total > 0 else "0.0%"
        time_label = f"{hour:02d}:00-{hour:02d}:59"
        print(f"  {time_label:<12s}  {b_rate:>10s}  {o_rate:>10s}")

    # ── Conclusion ──
    print("\n" + "=" * 60)
    print("  📋 实验结论")
    print("=" * 60)
    block_imp = ((baseline["block_rate"] - optimized["block_rate"]) / baseline["block_rate"] * 100
                 if baseline["block_rate"] > 0 else 0)
    ride_imp = ((optimized["total_rides"] - baseline["total_rides"]) / baseline["total_rides"] * 100
                if baseline["total_rides"] > 0 else 0)
    print(f"""
  开启调度算法后:
    • 阻塞率: {baseline['block_rate']*100:.1f}% → {optimized['block_rate']*100:.1f}% ({"下降" if block_imp > 0 else "上升"} {abs(block_imp):.1f}%)
    • 骑行量: {baseline['total_rides']} → {optimized['total_rides']} ({"提升" if ride_imp > 0 else "下降"} {abs(ride_imp):.1f}%)
    • 均衡度: {baseline['bike_std_dev']:.3f} → {optimized['bike_std_dev']:.3f}
    • 共执行 {optimized['dispatch_count']} 次调度, 移动 {optimized['total_moved']} 辆次
""")

    # ── Save raw data as JSON ──
    output = {
        "config": {"days": args.days, "seed": args.seed, "total_slots": total_slots},
        "baseline": {k: v for k, v in baseline.items() if k != "snapshots"},
        "optimized": {k: v for k, v in optimized.items() if k != "snapshots"},
    }
    with open("/Users/liji/gx/benchmark_results.json", "w") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    print("  结果已保存至 benchmark_results.json")

if __name__ == "__main__":
    main()
