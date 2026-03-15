#!/usr/bin/env npx tsx
/// <reference types="node" />
/**
 * CLI Benchmark — uses the EXACT same modules as the browser.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001/api/v1 npx tsx scripts/benchmark-cli.ts
 *   API_BASE_URL=http://localhost:3001/api/v1 npx tsx scripts/benchmark-cli.ts --days 3 --seed 42
 */

import { runBenchmark, type BenchmarkProgress, type BenchmarkResult } from '../src/simulation/benchmark';
import { STATIONS } from '../src/data/stations';
import type { DayKind } from '../src/types/time';

// ── Args ──
const args = process.argv.slice(2);
function getArg(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const days = parseInt(getArg('days', '2'), 10);
const seed = parseInt(getArg('seed', '42'), 10);
const dayKind: DayKind = getArg('day-kind', 'weekday') as DayKind;

// ── Helpers ──
function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

function delta(base: number, opt: number, lowerBetter: boolean): string {
  if (base === 0) return '-';
  const d = (opt - base) / base * 100;
  const arrow = d < 0 ? '↓' : '↑';
  const good = lowerBetter ? d < 0 : d > 0;
  const mark = good ? '✅' : '🔴';
  return `${mark} ${arrow}${Math.abs(d).toFixed(1)}%`;
}

// ── Main ──
async function main() {
  if (!process.env.API_BASE_URL) {
    console.error('❌ 请设置 API_BASE_URL，例如:');
    console.error('   API_BASE_URL=http://localhost:3001/api/v1 npx tsx scripts/benchmark-cli.ts');
    process.exit(1);
  }

  const totalSlots = days * 1440;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  校园共享单车调度算法 A/B 对比实验 (CLI)`);
  console.log(`  模拟天数: ${days}天 (${totalSlots} 个1分钟时段)`);
  console.log(`  随机种子: ${seed}`);
  console.log(`  日类型: ${dayKind}`);
  console.log(`  使用模块: 前端 simulation/* (与浏览器完全一致)`);
  console.log(`${'='.repeat(60)}\n`);

  let lastPhase = '';
  const onProgress = (p: BenchmarkProgress) => {
    if (p.phase !== lastPhase) {
      if (lastPhase) console.log();
      const label = p.phase === 'no-dispatch' ? '━ Phase 1: 无调度' :
        p.phase === 'warmup' ? '━ 预热预测模型...' :
          p.phase === 'with-dispatch' ? '━ Phase 2: 有调度' : '━ 完成';
      console.log(label);
      lastPhase = p.phase;
    }
    if (p.currentSlot > 0 && (p.currentSlot % 24 === 0 || p.currentSlot === p.totalSlots)) {
      const pctDone = (p.currentSlot / p.totalSlots * 100).toFixed(0);
      process.stdout.write(`\r    进度: ${p.currentSlot}/${p.totalSlots} (${pctDone}%)`);
    }
  };

  const { baseline, optimized } = await runBenchmark(dayKind, days, onProgress, undefined, seed);
  console.log('\n');

  // ── Results ──
  console.log(`${'='.repeat(60)}`);
  console.log(`  📊 对比结果`);
  console.log(`${'='.repeat(60)}`);

  const header = `  ${'指标'.padEnd(14)}  ${'无调度'.padStart(10)}  ${'有调度'.padStart(10)}  ${'变化'.padStart(14)}`;
  console.log(header);
  console.log('  ' + '-'.repeat(56));

  const rows: [string, string, string, string][] = [
    ['总骑行数', String(baseline.totalRides), String(optimized.totalRides), delta(baseline.totalRides, optimized.totalRides, false)],
    ['阻塞次数', String(baseline.blockedCount), String(optimized.blockedCount), delta(baseline.blockedCount, optimized.blockedCount, true)],
    ['阻塞率', pct(baseline.blockRate), pct(optimized.blockRate), delta(baseline.blockRate, optimized.blockRate, true)],
    ['满足率', pct(baseline.satisfactionRate), pct(optimized.satisfactionRate), delta(baseline.satisfactionRate, optimized.satisfactionRate, false)],
    ['均衡度(σ)', baseline.bikeStdDev.toFixed(3), optimized.bikeStdDev.toFixed(3), delta(baseline.bikeStdDev, optimized.bikeStdDev, true)],
    ['调度次数', '-', String(optimized.dispatchCount), ''],
    ['移动车辆次', '-', String(optimized.totalBikesMoved), ''],
  ];
  for (const [l, b, o, d] of rows) {
    console.log(`  ${l.padEnd(14)}  ${b.padStart(10)}  ${o.padStart(10)}  ${d.padStart(14)}`);
  }

  // ── Per-station distribution ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  🚲 各站点最终车辆分布`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  ${'站点'.padEnd(12)}  ${'容量'.padStart(4)}  ${'无调度'.padStart(6)}  ${'有调度'.padStart(6)}  ${'差值'.padStart(6)}`);
  console.log('  ' + '-'.repeat(42));
  for (const s of STATIONS) {
    const bBikes = baseline.finalBikes[s.id];
    const oBikes = optimized.finalBikes[s.id];
    const diff = oBikes - bBikes;
    const sign = diff > 0 ? '+' : '';
    console.log(`  ${s.name.padEnd(12)}  ${String(s.capacity).padStart(4)}  ${String(bBikes).padStart(6)}  ${String(oBikes).padStart(6)}  ${sign}${String(diff).padStart(5)}`);
  }

  // ── Hourly breakdown (day 1) ──
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  📈 逐时段阻塞率变化 (第1天)`);
  console.log(`${'='.repeat(60)}`);
  if (baseline.snapshots.length === 0 || optimized.snapshots.length === 0) {
    console.log(`  ⚠️  逐时段统计不可用 (Worker 模式下未收集 snapshots)`);
  } else {
    console.log(`  ${'时段'.padEnd(12)}  ${'无调度'.padStart(10)}  ${'有调度'.padStart(10)}`);
    console.log('  ' + '-'.repeat(36));
    for (let hour = 0; hour < 24; hour++) {
      const slotStart = hour * 60;
      const slotEnd = slotStart + 60;
      let bBlocked = 0, oBlocked = 0, bRides = 0, oRides = 0;
      for (let si = slotStart; si < Math.min(slotEnd, baseline.snapshots.length); si++) {
        const snapB = baseline.snapshots[si];
        const snapO = optimized.snapshots[si];
        if (si === 0) {
          bBlocked += snapB.blockedCount; oBlocked += snapO.blockedCount;
          bRides += snapB.totalRides; oRides += snapO.totalRides;
        } else {
          const prevB = baseline.snapshots[si - 1];
          const prevO = optimized.snapshots[si - 1];
          bBlocked += snapB.blockedCount - prevB.blockedCount;
          oBlocked += snapO.blockedCount - prevO.blockedCount;
          bRides += snapB.totalRides - prevB.totalRides;
          oRides += snapO.totalRides - prevO.totalRides;
        }
      }
      const bTotal = bRides + bBlocked;
      const oTotal = oRides + oBlocked;
      const bRate = bTotal > 0 ? `${(bBlocked / bTotal * 100).toFixed(1)}%` : '0.0%';
      const oRate = oTotal > 0 ? `${(oBlocked / oTotal * 100).toFixed(1)}%` : '0.0%';
      console.log(`  ${`${String(hour).padStart(2, '0')}:00-${String(hour).padStart(2, '0')}:59`.padEnd(12)}  ${bRate.padStart(10)}  ${oRate.padStart(10)}`);
    }
  }

  // ── Conclusion ──
  const blockImp = baseline.blockRate > 0 ? (baseline.blockRate - optimized.blockRate) / baseline.blockRate * 100 : 0;
  const rideImp = baseline.totalRides > 0 ? (optimized.totalRides - baseline.totalRides) / baseline.totalRides * 100 : 0;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  📋 实验结论`);
  console.log(`${'='.repeat(60)}`);
  console.log(`
  开启调度算法后:
    • 阻塞率: ${pct(baseline.blockRate)} → ${pct(optimized.blockRate)} (${blockImp > 0 ? '下降' : '上升'} ${Math.abs(blockImp).toFixed(1)}%)
    • 骑行量: ${baseline.totalRides} → ${optimized.totalRides} (${rideImp > 0 ? '提升' : '下降'} ${Math.abs(rideImp).toFixed(1)}%)
    • 均衡度: ${baseline.bikeStdDev.toFixed(3)} → ${optimized.bikeStdDev.toFixed(3)}
    • 共执行 ${optimized.dispatchCount} 次调度, 移动 ${optimized.totalBikesMoved} 辆次
  `);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
