import { useSimulationStore } from '../../store/simulationStore';
import { STATION_MAP } from '../../data/stations';

const TYPE_LABELS = {
  departure_discount: '出发折扣',
  arrival_reward: '到达奖励',
};

const REASON_LABELS = {
  surplus: '车辆过剩',
  predicted_shortage: '预测紧缺',
  rebalancing: '调度平衡',
};

export default function IncentivePanel() {
  const { latestIncentives } = useSimulationStore();

  if (latestIncentives.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', paddingTop: 20 }}>
        暂无激励措施（等待调度触发）
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#334155' }}>
        当前激励措施 ({latestIncentives.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {latestIncentives.map((inc, i) => {
          const station = STATION_MAP.get(inc.station_id);
          return (
            <div
              key={i}
              style={{
                padding: '10px 14px',
                background: '#f8fafc',
                borderRadius: 8,
                borderLeft: `3px solid ${inc.incentive_type === 'departure_discount' ? '#22c55e' : '#3b82f6'}`,
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>
                  {station?.name ?? `站点#${inc.station_id}`}
                </span>
                <span style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  background: inc.incentive_type === 'departure_discount' ? '#dcfce7' : '#dbeafe',
                  color: inc.incentive_type === 'departure_discount' ? '#16a34a' : '#2563eb',
                }}>
                  {TYPE_LABELS[inc.incentive_type]}
                </span>
              </div>
              <div style={{ marginTop: 4, color: '#64748b', display: 'flex', gap: 16 }}>
                <span>折扣: {inc.discount_percent.toFixed(0)}%</span>
                <span>积分: {inc.reward_credits.toFixed(1)}</span>
                <span>原因: {REASON_LABELS[inc.reason]}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
