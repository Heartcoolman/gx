import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { slotToTime, DAY_KIND_LABELS, SLOTS_PER_DAY } from '../../types/time';

export default function Header() {
  const {
    slotIndex,
    dayKind,
    engineState,
    scenarioLabel,
    activeWeatherLabel,
    activeEvents,
  } = useSimulationStore(useShallow(s => ({
    slotIndex: s.slotIndex,
    dayKind: s.dayKind,
    engineState: s.engineState,
    scenarioLabel: s.scenarioLabel,
    activeWeatherLabel: s.activeWeatherLabel,
    activeEvents: s.activeEvents,
  })));
  const time = slotToTime(slotIndex);

  const statusClass = `status-dot status-dot--${engineState}`;

  return (
    <header className="header">
      <h1 className="header-title">
        <div className="header-title-accent" />
        南昌理工学院<span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> | 校园共享单车调度仿真平台</span>
      </h1>
      <div className="header-badges">
        <span className="badge badge-time">
          {time}
        </span>
        <span className={`badge ${dayKind === 'weekday' ? 'badge-weekday' : 'badge-weekend'}`}>
          {DAY_KIND_LABELS[dayKind]}
        </span>
        <span className="badge badge-scenario">
          {scenarioLabel}
        </span>
        <span className="badge badge-weather">
          {activeWeatherLabel}
        </span>
        {activeEvents[0] && (
          <span className="badge badge-event">
            {activeEvents[0]}
          </span>
        )}
        <div className="header-slot-info">
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>当前时段</span>
          <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{slotIndex} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>/ {SLOTS_PER_DAY}</span></span>
        </div>
        <div className="header-divider" />
        <span className={statusClass} title={`状态: ${engineState}`} />
      </div>
    </header>
  );
}
