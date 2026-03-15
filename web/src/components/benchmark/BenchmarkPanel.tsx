import { useState } from 'react';
import {
  runBenchmark,
  autoTune,
  type BenchmarkResult,
  type BenchmarkProgress,
  type TuningIteration,
  type TunerProgress,
  type TuningParams,
} from '../../simulation/benchmark';
import { useSimulationStore } from '../../store/simulationStore';
import { STATIONS } from '../../data/stations';

type Mode = 'menu' | 'compare-run' | 'compare-done' | 'tune-run' | 'tune-done';

function pct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

function delta(base: number, opt: number, lower: boolean): { text: string; color: string } {
  if (base === 0) return { text: '-', color: '#64748b' };
  const d = ((opt - base) / base) * 100;
  const good = lower ? d < 0 : d > 0;
  return { text: `${d > 0 ? '+' : ''}${d.toFixed(1)}%`, color: good ? '#16a34a' : '#dc2626' };
}

function ParamTag({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', margin: '1px 2px',
      background: '#f1f5f9', borderRadius: 4, fontSize: 10, color: '#475569',
    }}>
      {label}: <strong>{value}</strong>
    </span>
  );
}

function ParamsDisplay({ p }: { p: TuningParams }) {
  return (
    <div style={{ lineHeight: 1.8 }}>
      <ParamTag label="车辆" value={`${p.vehicleCount}`} />
      <ParamTag label="容量" value={`${p.vehicleCapacity}`} />
      <ParamTag label="间隔" value={`${p.rebalanceIntervalMinutes}min`} />
      <ParamTag label="缓冲" value={`${(p.safetyBufferRatio * 100).toFixed(0)}%`} />
      <ParamTag label="峰值" value={`${p.peakMultiplier}x`} />
      <ParamTag label="预测" value={`${p.predictionHorizonSlots}槽`} />
    </div>
  );
}

export default function BenchmarkPanel() {
  const dayKind = useSimulationStore(s => s.dayKind);
  const [mode, setMode] = useState<Mode>('menu');
  const [days, setDays] = useState(2);
  const [seed, setSeed] = useState(42);

  // Compare state
  const [cmpProgress, setCmpProgress] = useState<BenchmarkProgress | null>(null);
  const [baseline, setBaseline] = useState<BenchmarkResult | null>(null);
  const [optimized, setOptimized] = useState<BenchmarkResult | null>(null);

  // Tune state
  const [tuneProgress, setTuneProgress] = useState<TunerProgress | null>(null);
  const [tuneHistory, setTuneHistory] = useState<TuningIteration[]>([]);

  // ─── Handlers ───
  const startCompare = async () => {
    setMode('compare-run');
    const r = await runBenchmark(dayKind, days, (p) => setCmpProgress({ ...p }), undefined, seed);
    setBaseline(r.baseline);
    setOptimized(r.optimized);
    setMode('compare-done');
  };

  const startTune = async () => {
    setMode('tune-run');
    setTuneHistory([]);
    const history = await autoTune(dayKind, days, 0.01, 0.98, (p) => {
      setTuneProgress({ ...p });
      if (p.history.length > 0) setTuneHistory([...p.history]);
    }, seed);
    setTuneHistory(history);
    setMode('tune-done');
  };

  // ─── Menu ───
  if (mode === 'menu') {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
          调度算法评估
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>
            模拟天数
            <select value={days} onChange={e => setDays(Number(e.target.value))}
              style={{ marginLeft: 8, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12 }}>
              <option value={1}>1天</option>
              <option value={2}>2天</option>
              <option value={3}>3天</option>
            </select>
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>
            随机种子
            <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
              style={{ marginLeft: 8, width: 80, padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12 }} />
          </label>
        </div>

        <button onClick={startCompare} style={{ ...btnFull, background: 'linear-gradient(135deg, #2563eb, #3b82f6)', marginBottom: 8 }}>
          对比实验（默认参数）
        </button>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
          用默认参数跑两轮（无调度 vs 有调度），查看基准效果。
        </div>

        <button onClick={startTune} style={{ ...btnFull, background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
          自动调优（目标: 阻塞率≤1%, 满足率≥98%）
        </button>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
          自动尝试多组参数，逐步提升调度效果，直到达标或穷尽搜索空间。
        </div>
      </div>
    );
  }

  // ─── Compare running ───
  if (mode === 'compare-run' && cmpProgress) {
    const label = cmpProgress.phase === 'no-dispatch' ? '第1轮: 无调度' :
      cmpProgress.phase === 'warmup' ? '预热模型...' : '第2轮: 有调度';
    const pctDone = cmpProgress.totalSlots > 0 ? cmpProgress.currentSlot / cmpProgress.totalSlots : 0;
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>对比实验中</div>
        <div style={{ fontSize: 13, color: '#334155', marginBottom: 6 }}>{label}</div>
        <ProgressBar value={pctDone} color={cmpProgress.phase === 'no-dispatch' ? '#f97316' : '#2563eb'} />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          {cmpProgress.currentSlot} / {cmpProgress.totalSlots} 时段
        </div>
      </div>
    );
  }

  // ─── Compare done ───
  if (mode === 'compare-done' && baseline && optimized) {
    return (
      <div style={{ padding: 16, overflow: 'auto', maxHeight: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>对比结果（{days}天）</div>
        <ComparisonTable baseline={baseline} optimized={optimized} />
        <BikeDistCompare baseline={baseline} optimized={optimized} />
        <Conclusion baseline={baseline} optimized={optimized} />
        <button onClick={() => setMode('menu')} style={{ ...btnFull, background: '#e2e8f0', color: '#334155', marginTop: 10 }}>
          返回
        </button>
      </div>
    );
  }

  // ─── Tune running ───
  if (mode === 'tune-run' && tuneProgress) {
    const pctDone = tuneProgress.totalSlots > 0 ? tuneProgress.currentSlot / tuneProgress.totalSlots : 0;
    return (
      <div style={{ padding: 16, overflow: 'auto', maxHeight: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>自动调优中</div>
        <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>
          迭代 {tuneProgress.iteration} / {tuneProgress.totalIterations}
        </div>
        <ProgressBar value={pctDone} color="#7c3aed" />
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, marginBottom: 10 }}>
          {tuneProgress.currentSlot} / {tuneProgress.totalSlots} 时段
        </div>

        {tuneProgress.bestSoFar && (
          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', marginBottom: 4 }}>当前最优</div>
            <div style={{ fontSize: 12 }}>
              阻塞率: <strong>{pct(tuneProgress.bestSoFar.result.blockRate)}</strong>
              {' '}满足率: <strong>{pct(tuneProgress.bestSoFar.result.satisfactionRate)}</strong>
            </div>
          </div>
        )}

        {tuneHistory.length > 0 && (
          <div style={{ fontSize: 11, color: '#64748b' }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>已完成的迭代:</div>
            {tuneHistory.map((it, i) => (
              <div key={i} style={{
                padding: '4px 0', borderBottom: '1px solid #f1f5f9',
                color: it.result.blockRate <= 0.01 ? '#16a34a' : '#334155',
              }}>
                #{i + 1} 阻塞 {pct(it.result.blockRate)} | 满足 {pct(it.result.satisfactionRate)}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Tune done ───
  if (mode === 'tune-done' && tuneHistory.length > 0) {
    const best = tuneHistory.reduce((a, b) => a.result.blockRate < b.result.blockRate ? a : b);
    const met = best.result.blockRate <= 0.01 && best.result.satisfactionRate >= 0.98;

    return (
      <div style={{ padding: 16, overflow: 'auto', maxHeight: '100%' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
          调优完成 — {met ? '目标达成!' : '最优结果'}
        </div>

        {/* Best result highlight */}
        <div style={{
          background: met ? '#f0fdf4' : '#fffbeb', border: `1px solid ${met ? '#bbf7d0' : '#fde68a'}`,
          borderRadius: 10, padding: 12, marginBottom: 12,
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: met ? '#16a34a' : '#d97706', marginBottom: 6 }}>
            阻塞率 {pct(best.result.blockRate)} | 满足率 {pct(best.result.satisfactionRate)}
          </div>
          <div style={{ fontSize: 12, color: '#334155', marginBottom: 6 }}>
            总骑行 {best.result.totalRides} | 阻塞 {best.result.blockedCount} | 调度 {best.result.dispatchCount}次 | 移动 {best.result.totalBikesMoved}辆次
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>最优参数:</div>
          <ParamsDisplay p={best.params} />
        </div>

        {/* Full iteration history */}
        <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
          全部迭代记录 ({tuneHistory.length}轮)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={th}>#</th>
              <th style={th}>车辆</th>
              <th style={th}>容量</th>
              <th style={th}>间隔</th>
              <th style={th}>缓冲</th>
              <th style={th}>阻塞率</th>
              <th style={th}>满足率</th>
            </tr>
          </thead>
          <tbody>
            {tuneHistory.map((it, i) => {
              const isBest = it === best;
              return (
                <tr key={i} style={{ background: isBest ? '#f0fdf4' : 'transparent', borderBottom: '1px solid #f1f5f9' }}>
                  <td style={td}>{i + 1}</td>
                  <td style={td}>{it.params.vehicleCount}</td>
                  <td style={td}>{it.params.vehicleCapacity}</td>
                  <td style={td}>{it.params.rebalanceIntervalMinutes}m</td>
                  <td style={td}>{(it.params.safetyBufferRatio * 100).toFixed(0)}%</td>
                  <td style={{ ...td, color: it.result.blockRate <= 0.01 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                    {pct(it.result.blockRate)}
                  </td>
                  <td style={{ ...td, color: it.result.satisfactionRate >= 0.98 ? '#16a34a' : '#d97706', fontWeight: 600 }}>
                    {pct(it.result.satisfactionRate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <BikeDistSingle label="最优参数下车辆分布" bikes={best.result.finalBikes} />

        <button onClick={() => setMode('menu')} style={{ ...btnFull, background: '#e2e8f0', color: '#334155', marginTop: 10 }}>
          返回
        </button>
      </div>
    );
  }

  return null;
}

// ─── Sub-components ───

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${value * 100}%`, background: color, borderRadius: 4, transition: 'width 0.1s' }} />
    </div>
  );
}

function ComparisonTable({ baseline, optimized }: { baseline: BenchmarkResult; optimized: BenchmarkResult }) {
  const rows = [
    { l: '总骑行数', b: baseline.totalRides.toString(), o: optimized.totalRides.toString(), d: delta(baseline.totalRides, optimized.totalRides, false) },
    { l: '阻塞次数', b: baseline.blockedCount.toString(), o: optimized.blockedCount.toString(), d: delta(baseline.blockedCount, optimized.blockedCount, true) },
    { l: '阻塞率', b: pct(baseline.blockRate), o: pct(optimized.blockRate), d: delta(baseline.blockRate, optimized.blockRate, true) },
    { l: '满足率', b: pct(baseline.satisfactionRate), o: pct(optimized.satisfactionRate), d: delta(baseline.satisfactionRate, optimized.satisfactionRate, false) },
    { l: '均衡度', b: baseline.bikeStdDev.toFixed(3), o: optimized.bikeStdDev.toFixed(3), d: delta(baseline.bikeStdDev, optimized.bikeStdDev, true) },
    { l: '调度次数', b: '-', o: optimized.dispatchCount.toString(), d: { text: '', color: '#64748b' } },
    { l: '调度车辆', b: '-', o: optimized.totalBikesMoved.toString(), d: { text: '', color: '#64748b' } },
  ];

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: '#f1f5f9' }}>
          <th style={{ ...th, textAlign: 'left' }}>指标</th>
          <th style={{ ...th, color: '#f97316' }}>无调度</th>
          <th style={{ ...th, color: '#2563eb' }}>有调度</th>
          <th style={th}>改善</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ l, b, o, d }) => (
          <tr key={l} style={{ borderBottom: '1px solid #f1f5f9' }}>
            <td style={{ ...td, fontWeight: 500 }}>{l}</td>
            <td style={{ ...td, textAlign: 'center' }}>{b}</td>
            <td style={{ ...td, textAlign: 'center' }}>{o}</td>
            <td style={{ ...td, textAlign: 'center', color: d.color, fontWeight: 600 }}>{d.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BikeDistCompare({ baseline, optimized }: { baseline: BenchmarkResult; optimized: BenchmarkResult }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>最终车辆分布</div>
      {STATIONS.map(st => (
        <div key={st.id} style={{ marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: '#64748b' }}>{st.name}</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <Bar ratio={baseline.finalBikes[st.id] / st.capacity} color="#f97316" bg="#fed7aa" />
            <Bar ratio={optimized.finalBikes[st.id] / st.capacity} color="#2563eb" bg="#bfdbfe" />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
        <span><span style={{ color: '#f97316' }}>--</span> 无调度</span>
        <span><span style={{ color: '#2563eb' }}>--</span> 有调度</span>
      </div>
    </div>
  );
}

function BikeDistSingle({ label, bikes }: { label: string; bikes: number[] }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#334155', marginBottom: 4 }}>{label}</div>
      {STATIONS.map(st => (
        <div key={st.id} style={{ marginBottom: 3 }}>
          <div style={{ fontSize: 10, color: '#64748b' }}>{st.name} ({bikes[st.id]}/{st.capacity})</div>
          <Bar ratio={bikes[st.id] / st.capacity} color="#7c3aed" bg="#ede9fe" />
        </div>
      ))}
    </div>
  );
}

function Bar({ ratio, color, bg }: { ratio: number; color: string; bg: string }) {
  return (
    <div style={{ flex: 1, height: 6, background: bg, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${Math.min(ratio, 1) * 100}%`, background: color, borderRadius: 3 }} />
    </div>
  );
}

function Conclusion({ baseline, optimized }: { baseline: BenchmarkResult; optimized: BenchmarkResult }) {
  const blockImp = baseline.blockRate > 0 ? ((baseline.blockRate - optimized.blockRate) / baseline.blockRate * 100).toFixed(1) : '0';
  const rideImp = baseline.totalRides > 0 ? ((optimized.totalRides - baseline.totalRides) / baseline.totalRides * 100).toFixed(1) : '0';

  return (
    <div style={{ padding: 10, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#166534', marginBottom: 3 }}>实验结论</div>
      <div style={{ fontSize: 11, color: '#15803d', lineHeight: 1.6 }}>
        启用调度后阻塞率下降 {blockImp}%，骑行量提升 {rideImp}%，
        均衡度从 {baseline.bikeStdDev.toFixed(3)} 降至 {optimized.bikeStdDev.toFixed(3)}。
        共执行 {optimized.dispatchCount} 次调度，移动 {optimized.totalBikesMoved} 辆次。
      </div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '5px 3px', fontSize: 10, fontWeight: 600, textAlign: 'center' };
const td: React.CSSProperties = { padding: '4px 3px', textAlign: 'center' };
const btnFull: React.CSSProperties = {
  width: '100%', padding: '10px 0', border: 'none', borderRadius: 8,
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
};
