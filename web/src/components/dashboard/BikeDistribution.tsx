import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSimulationStore } from '../../store/simulationStore';
import { STATIONS } from '../../data/stations';

export default function BikeDistribution() {
  const { bikes, latestTargets } = useSimulationStore();

  const data = STATIONS.map((st) => {
    const target = latestTargets.find(t => t.station_id === st.id);
    return {
      name: st.name.replace(/第[一二]/, '').slice(0, 4),
      current: bikes[st.id] ?? 0,
      capacity: st.capacity,
      target: target?.target_bikes ?? 0,
    };
  });

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#334155' }}>
        各站点车辆分布
      </div>
      <ResponsiveContainer width="100%" height="85%">
        <BarChart data={data} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="current" fill="#3b82f6" name="当前车辆" radius={[2, 2, 0, 0]} />
          <Bar dataKey="target" fill="#f97316" name="目标车辆" radius={[2, 2, 0, 0]} opacity={0.6} />
          <Bar dataKey="capacity" fill="#e2e8f0" name="总容量" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
