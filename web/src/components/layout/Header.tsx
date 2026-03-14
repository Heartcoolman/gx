import { useSimulationStore } from '../../store/simulationStore';
import { slotToTime, DAY_KIND_LABELS, SLOTS_PER_DAY } from '../../types/time';

export default function Header() {
  const { slotIndex, dayKind, engineState } = useSimulationStore();
  const time = slotToTime(slotIndex);

  return (
    <header style={{
      background: 'linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%)',
      color: '#fff',
      padding: '12px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
    }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
        南昌理工学院 - 校园共享单车调度仿真平台
      </h1>
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
        <span style={{
          background: 'rgba(255,255,255,0.15)',
          padding: '4px 12px',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 16,
        }}>
          {time}
        </span>
        <span style={{
          background: 'rgba(255,255,255,0.1)',
          padding: '4px 10px',
          borderRadius: 6,
        }}>
          {DAY_KIND_LABELS[dayKind]}
        </span>
        <span style={{ opacity: 0.8 }}>
          时段: {slotIndex}/{SLOTS_PER_DAY}
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: engineState === 'running' ? '#22c55e' : engineState === 'paused' ? '#eab308' : '#6b7280',
          display: 'inline-block',
        }} />
      </div>
    </header>
  );
}
