import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { FAILURE_REASON_LABELS } from '../../types/scenario';

export default function IncentivePanel() {
  const {
    activeWeatherLabel,
    activeEvents,
    failureReasonCounts,
    syntheticPreview,
    scenarioLabel,
  } = useSimulationStore(useShallow(s => ({
    activeWeatherLabel: s.activeWeatherLabel,
    activeEvents: s.activeEvents,
    failureReasonCounts: s.failureReasonCounts,
    syntheticPreview: s.syntheticPreview,
    scenarioLabel: s.scenarioLabel,
  })));

  const sortedReasons = Object.entries(failureReasonCounts)
    .sort((left, right) => right[1] - left[1])
    .filter((entry) => entry[1] > 0);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 14 }}>
      <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
          当前场景
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>
          {scenarioLabel}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          <span style={{ padding: '4px 9px', borderRadius: 999, background: '#dbeafe', color: '#1d4ed8', fontSize: 11, fontWeight: 600 }}>
            {activeWeatherLabel}
          </span>
          {activeEvents.length > 0 ? activeEvents.map((event) => (
            <span key={event} style={{ padding: '4px 9px', borderRadius: 999, background: '#fef3c7', color: '#92400e', fontSize: 11, fontWeight: 600 }}>
              {event}
            </span>
          )) : (
            <span style={{ color: '#94a3b8', fontSize: 12 }}>当前没有额外事件冲击</span>
          )}
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
          合成预览日历
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {syntheticPreview.map((preview) => (
            <div
              key={preview.dayIndex}
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: '#fff',
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                Day {preview.dayIndex + 1} · 预计 {preview.expectedTrips} 次骑行
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                主天气: {preview.dominantWeather} · 事件: {preview.highlightedEvents.join(' / ') || '无'}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff7ed', borderRadius: 10, padding: 14, border: '1px solid #fed7aa' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#9a3412', marginBottom: 10 }}>
          未满足原因分布
        </div>
        {sortedReasons.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13, paddingTop: 20 }}>
            当前还没有明显的失败记录，场景运行后这里会解释为什么出现拥堵或空站。
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sortedReasons.map(([reason, count]) => (
              <div
                key={reason}
                style={{
                  background: 'rgba(255,255,255,0.8)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  borderLeft: '3px solid #f97316',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 600, color: '#7c2d12' }}>
                    {FAILURE_REASON_LABELS[reason as keyof typeof FAILURE_REASON_LABELS]}
                  </span>
                  <span style={{ fontWeight: 700, color: '#ea580c' }}>{count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
