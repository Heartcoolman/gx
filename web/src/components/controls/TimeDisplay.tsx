import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { slotToTime, DAY_KIND_LABELS } from '../../types/time';

export default function TimeDisplay() {
  const { slotIndex, dayKind } = useSimulationStore(useShallow(s => ({
    slotIndex: s.slotIndex,
    dayKind: s.dayKind,
  })));

  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>
        {slotToTime(slotIndex)}
      </div>
      <div style={{ fontSize: 12, color: '#64748b' }}>
        {DAY_KIND_LABELS[dayKind]} · 时段 {slotIndex}
      </div>
    </div>
  );
}
