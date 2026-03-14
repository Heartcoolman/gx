#!/usr/bin/env python3
"""Display rebalance cycle result in a friendly format."""
import sys
import json

data = json.load(sys.stdin)
names = {1: "东区宿舍", 2: "第一教学楼", 3: "中心食堂", 4: "图书馆"}
current = {1: 5, 2: 22, 3: 8, 4: 10}

print()
print("=" * 58)
print("  STEP 1: 需求预测 -> 目标库存")
print("=" * 58)
print()
header = "  {:12s}  {:>6s}  {:>6s}  {:>6s}  {}".format(
    "站点", "当前", "目标", "缺口", "状态"
)
print(header)
print("  " + "-" * 52)
for t in data["targets"]:
    sid = t["station_id"]
    name = names.get(sid, "站%d" % sid)
    cur = current.get(sid, 0)
    gap = t["target_bikes"] - cur
    if gap > 0:
        status = "!!! 需补 %d 辆" % gap
    elif gap < 0:
        status = ">>> 可调出 %d 辆" % abs(gap)
    else:
        status = "--- 平衡"
    peak = " [高峰]" if t["is_peak"] else ""
    print("  %-10s  %6d  %6d  %+6d  %s%s" % (name, cur, t["target_bikes"], gap, status, peak))

print()
print("=" * 58)
print("  STEP 2: 调度计划")
print("=" * 58)
plan = data["dispatch_plan"]
print()
print("  总调车量: %d 辆" % plan["total_bikes_moved"])
print("  出动车辆: %d 辆调度车" % len(plan["vehicle_routes"]))

actions = {"pickup": "装车", "dropoff": "卸车"}
for route in plan["vehicle_routes"]:
    print()
    print("  [调度车 #%d] 载量上限 %d 辆" % (route["vehicle_id"], route["capacity"]))
    for stop in route["stops"]:
        sid = stop["station_id"]
        name = names.get(sid, "站%d" % sid)
        act = actions.get(stop["action"], stop["action"])
        arrow = "  +++" if stop["action"] == "pickup" else "  ---"
        print("    %s %s @ %s  %d辆  (车上: %d辆)" % (
            arrow, act, name, stop["bike_count"], stop["load_after"]
        ))
    print("    *** 路程: %.0fm, 耗时: %.1f分钟" % (
        route["total_distance_meters"], route["estimated_duration_minutes"]
    ))

if data.get("incentives"):
    print()
    print("=" * 58)
    print("  STEP 3: 价格激励")
    print("=" * 58)
    print()
    types = {
        "arrival_reward": "到达奖励(吸引车辆来此)",
        "departure_discount": "出发折扣(鼓励骑走)",
    }
    for inc in data["incentives"]:
        sid = inc["station_id"]
        name = names.get(sid, "站%d" % sid)
        itype = types.get(inc["incentive_type"], inc["incentive_type"])
        print("  %s: %s  折扣 %.0f%%" % (name, itype, inc["discount_percent"]))

print()
print("=" * 58)
print("  调度完成!")
print("=" * 58)
