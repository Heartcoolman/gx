import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { STATIONS } from '../../data/stations';

export default function BikeDistribution() {
  const { bikes, brokenBikes, maintenanceBikes, stationPressure } = useSimulationStore(useShallow(s => ({
    bikes: s.bikes,
    brokenBikes: s.brokenBikes,
    maintenanceBikes: s.maintenanceBikes,
    stationPressure: s.stationPressure,
  })));

  const data = STATIONS.map((st) => {
    return {
      name: st.name.replace(/第[一二]/, '').slice(0, 4),
      current: bikes[st.id] ?? 0,
      broken: brokenBikes[st.id] ?? 0,
      maintenance: maintenanceBikes[st.id] ?? 0,
      capacity: st.capacity,
      pressure: Math.round((stationPressure[st.id] ?? 0) * 100),
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
          <Bar dataKey="broken" fill="#ef4444" name="坏车" radius={[2, 2, 0, 0]} />
          <Bar dataKey="maintenance" fill="#f59e0b" name="维修" radius={[2, 2, 0, 0]} />
          <Bar dataKey="pressure" fill="#14b8a6" name="压力指数" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
