import { useSimulationStore } from '../../store/simulationStore';
import { TOTAL_BIKES } from '../../data/constants';

export default function RebalanceMetrics() {
  const { totalRides, blockedCount, dispatchCount, totalBikesMoved, bikes } = useSimulationStore();

  const blockRate = totalRides > 0 ? blockedCount / (totalRides + blockedCount) : 0;
  const totalAvailable = bikes.reduce((a, b) => a + b, 0);

  const cards: Array<{ label: string; value: string; color: string; sub?: string }> = [
    { label: '总骑行数', value: totalRides.toString(), color: '#3b82f6' },
    { label: '阻塞次数', value: blockedCount.toString(), color: '#ef4444' },
    { label: '阻塞率', value: `${(blockRate * 100).toFixed(1)}%`, color: blockRate > 0.1 ? '#ef4444' : '#22c55e' },
    { label: '调度次数', value: dispatchCount.toString(), color: '#8b5cf6' },
    { label: '移动车辆数', value: totalBikesMoved.toString(), color: '#f97316' },
    { label: '在途车辆', value: `${TOTAL_BIKES - totalAvailable}`, color: '#06b6d4', sub: `共${TOTAL_BIKES}辆` },
  ];

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 12,
    }}>
      {cards.map(({ label, value, color, sub }) => (
        <div
          key={label}
          style={{
            background: '#f8fafc',
            borderRadius: 10,
            padding: '14px 16px',
            borderLeft: `4px solid ${color}`,
          }}
        >
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
          {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
        </div>
      ))}
    </div>
  );
}
