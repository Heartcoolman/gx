import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';

export default function RebalanceMetrics() {
  const {
    totalRides,
    blockedCount,
    dispatchCount,
    totalBikesMoved,
    totalWalkTransfers,
    totalOverflowEvents,
    totalRepairsCompleted,
    totalInTransit,
    bikes,
  } = useSimulationStore(useShallow(s => ({
    totalRides: s.totalRides,
    blockedCount: s.blockedCount,
    dispatchCount: s.dispatchCount,
    totalBikesMoved: s.totalBikesMoved,
    totalWalkTransfers: s.totalWalkTransfers,
    totalOverflowEvents: s.totalOverflowEvents,
    totalRepairsCompleted: s.totalRepairsCompleted,
    totalInTransit: s.totalInTransit,
    bikes: s.bikes,
  })));

  const totalAttempts = totalRides + blockedCount;
  const blockRate = totalAttempts > 0 ? blockedCount / totalAttempts : 0;
  const totalAvailable = bikes.reduce((a, b) => a + b, 0);

  const cards: Array<{ label: string; value: string; color: string; sub?: string; showBar?: boolean }> = [
    { label: '已服务需求', value: totalRides.toString(), color: '#3b82f6' },
    { label: '未满足需求', value: blockedCount.toString(), color: '#ef4444' },
    {
      label: '未满足率',
      value: `${(blockRate * 100).toFixed(1)}%`,
      color: blockRate > 0.12 ? '#ef4444' : '#22c55e',
      showBar: true,
    },
    { label: '步行换站', value: totalWalkTransfers.toString(), color: '#8b5cf6' },
    { label: '回停溢出', value: totalOverflowEvents.toString(), color: '#f97316' },
    { label: '维修恢复', value: totalRepairsCompleted.toString(), color: '#14b8a6' },
    { label: '在途车辆', value: totalInTransit.toString(), color: '#06b6d4', sub: `可借 ${totalAvailable}` },
    { label: '插件调度', value: dispatchCount.toString(), color: '#64748b', sub: `累计移动 ${totalBikesMoved}` },
  ];

  return (
    <div className="metric-grid">
      {cards.map(({ label, value, color, sub, showBar }) => (
        <div
          key={label}
          className="metric-card"
          style={{ borderLeft: `4px solid ${color}` }}
        >
          <div className="metric-label">{label}</div>
          <div className="metric-value" style={{ color }}>{value}</div>
          {sub && <div className="metric-sub">{sub}</div>}
          {showBar && (
            <div className="block-rate-bar">
              <div
                className="block-rate-fill"
                style={{
                  width: `${Math.min(blockRate * 100 * 3, 100)}%`,
                  background: blockRate > 0.12 ? '#ef4444' : blockRate > 0.06 ? '#f59e0b' : '#22c55e',
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
