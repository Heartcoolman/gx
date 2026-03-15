import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSimulationStore } from '../../store/simulationStore';
import { STATIONS } from '../../data/stations';
import { slotToTime } from '../../types/time';
import { useUIStore } from '../../store/uiStore';

export default function DemandChart() {
  const { snapshots } = useSimulationStore();
  const { selectedStationId } = useUIStore();

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
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="bikes"
            stroke="#3b82f6"
            name={selectedStationId !== null ? '站点可借车' : '全站可借车'}
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="totalRides"
            stroke="#22c55e"
            name="累计骑行"
            strokeWidth={1.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="blocked"
            stroke="#ef4444"
            name="阻塞次数"
            strokeWidth={1.5}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="pressure"
            stroke="#f59e0b"
            name={selectedStationId !== null ? '站点压力' : '平均压力'}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
