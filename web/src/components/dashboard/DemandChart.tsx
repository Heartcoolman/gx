import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { STATIONS } from '../../data/stations';
import { slotToTime } from '../../types/time';
import { useUIStore } from '../../store/uiStore';

export default function DemandChart() {
  const { snapshots } = useSimulationStore(useShallow(s => ({
    snapshots: s.snapshots,
  })));
  const { selectedStationId } = useUIStore();

  if (snapshots.length === 0) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-icon">📊</div>
        <div className="chart-empty-text">点击「播放」启动仿真，查看实时趋势</div>
      </div>
    );
  }

  const data = snapshots.map((snap) => {
    const entry: Record<string, number | string> = {
      time: slotToTime(snap.slotIndex),
      slot: snap.slotIndex,
      totalRides: snap.cumulativeServed,
      blocked: snap.cumulativeUnmet,
      walkTransfers: snap.walkTransfers,
      overflowEvents: snap.overflowEvents,
    };

    if (selectedStationId !== null) {
      entry.bikes = snap.bikes[selectedStationId] ?? 0;
      entry.pressure = (snap.pressure[selectedStationId] ?? 0) * 100;
    } else {
      entry.bikes = snap.bikes.reduce((a, b) => a + b, 0);
      entry.pressure = (snap.pressure.reduce((a, b) => a + b, 0) / Math.max(1, snap.pressure.length)) * 100;
    }
    return entry;
  });

  const label = selectedStationId !== null
    ? STATIONS[selectedStationId]?.name ?? '未知站点'
    : '全站';

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#334155' }}>
        {label} - 车辆数趋势
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="gradientBikes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
            </linearGradient>
            <linearGradient id="gradientBlocked" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: 'rgba(255, 255, 255, 0.92)',
              backdropFilter: 'blur(8px)',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => {
              if (name.includes('压力')) return [`${value.toFixed(1)}%`, name];
              return [Math.round(value).toLocaleString(), name];
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="bikes"
            stroke="#3b82f6"
            name={selectedStationId !== null ? '站点可借车' : '全站可借车'}
            strokeWidth={2}
            fill="url(#gradientBikes)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="totalRides"
            stroke="#22c55e"
            name="累计骑行"
            strokeWidth={1.5}
            fill="none"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="blocked"
            stroke="#ef4444"
            name="阻塞次数"
            strokeWidth={1.5}
            fill="url(#gradientBlocked)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="pressure"
            stroke="#f59e0b"
            name={selectedStationId !== null ? '站点压力' : '平均压力'}
            strokeWidth={1.5}
            fill="none"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
