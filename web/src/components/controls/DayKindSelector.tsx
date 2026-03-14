import { useSimulationStore } from '../../store/simulationStore';
import type { DayKind } from '../../types/time';
import { DAY_KIND_LABELS } from '../../types/time';
import { useEngineControls } from '../../App';

const DAY_KINDS: DayKind[] = ['weekday', 'saturday', 'sunday', 'holiday', 'exam_period'];

export default function DayKindSelector() {
  const { dayKind } = useSimulationStore();
  const { changeDayKind } = useEngineControls();

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
        日期类型
      </div>
      <select
        value={dayKind}
        onChange={(e) => changeDayKind(e.target.value as DayKind)}
        className="form-select"
      >
        {DAY_KINDS.map((dk) => (
          <option key={dk} value={dk}>{DAY_KIND_LABELS[dk]}</option>
        ))}
      </select>
    </div>
  );
}
