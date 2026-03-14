import { useSimulationStore } from '../../store/simulationStore';
import { slotToTime, DAY_KIND_LABELS, SLOTS_PER_DAY } from '../../types/time';

export default function Header() {
  const { slotIndex, dayKind, engineState } = useSimulationStore();
  const time = slotToTime(slotIndex);

  return (
    <header style={{
      background: 'rgba(255, 255, 255, 0.85)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      color: 'var(--text-main)',
      padding: '14px 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      zIndex: 10,
    }}>
      <h1 style={{ 
        margin: 0, 
        fontSize: 18, 
        fontWeight: 600, 
        display: 'flex', 
        alignItems: 'center',
        gap: '8px'
      }}>
        <div style={{
          width: 8,
          height: 24,
          borderRadius: 4,
          background: 'var(--primary)',
        }} />
        南昌理工学院<span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> | 校园共享单车调度仿真平台</span>
      </h1>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 13, fontWeight: 500 }}>
        <span style={{
          background: 'var(--bg-main)',
          border: '1px solid var(--border-color)',
          padding: '6px 14px',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'monospace',
          fontSize: 15,
          color: 'var(--primary)',
          boxShadow: 'var(--shadow-sm)'
        }}>
          {time}
        </span>
        <span style={{
          background: dayKind === 'weekday' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(245, 158, 11, 0.1)',
          color: dayKind === 'weekday' ? 'var(--primary)' : 'var(--warning)',
          border: `1px solid ${dayKind === 'weekday' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`,
          padding: '6px 12px',
          borderRadius: 'var(--radius-md)',
        }}>
          {DAY_KIND_LABELS[dayKind]}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginLeft: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>当前时段</span>
          <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{slotIndex} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {SLOTS_PER_DAY}</span></span>
        </div>
        <div style={{ width: 1, height: 24, background: 'var(--border-color)', margin: '0 4px' }} />
        <span style={{
          width: 10, height: 10, borderRadius: '50%',
          background: engineState === 'running' ? 'var(--success)' : engineState === 'paused' ? 'var(--warning)' : 'var(--text-muted)',
          display: 'inline-block',
          boxShadow: `0 0 0 3px ${engineState === 'running' ? 'rgba(16, 185, 129, 0.2)' : engineState === 'paused' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(100, 116, 139, 0.1)'}`
        }} title={`状态: ${engineState}`} />
      </div>
    </header>
  );
}
