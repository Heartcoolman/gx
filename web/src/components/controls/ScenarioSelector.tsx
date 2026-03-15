import { useSimulationStore } from '../../store/simulationStore';
import { useEngineControls } from '../../App';

export default function ScenarioSelector() {
  const { availableScenarios, scenarioId, scenarioDescription, activeWeatherLabel, activeEvents } = useSimulationStore();
  const { changeScenario } = useEngineControls();

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
        场景包
      </div>
      <select
        value={scenarioId}
        onChange={(event) => changeScenario(event.target.value)}
        className="form-select"
      >
        {availableScenarios.map((scenario) => (
          <option key={scenario.id} value={scenario.id}>
            {scenario.label}
          </option>
        ))}
      </select>
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        {scenarioDescription}
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#2563eb',
            background: '#dbeafe',
            padding: '3px 8px',
            borderRadius: 999,
          }}
        >
          {activeWeatherLabel}
        </span>
        {activeEvents.slice(0, 2).map((event) => (
          <span
            key={event}
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: '#92400e',
              background: '#fef3c7',
              padding: '3px 8px',
              borderRadius: 999,
            }}
          >
            {event}
          </span>
        ))}
      </div>
    </div>
  );
}
