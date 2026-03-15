import { useState } from 'react';
import SimulationControls from '../controls/SimulationControls';
import DayKindSelector from '../controls/DayKindSelector';
import ScenarioSelector from '../controls/ScenarioSelector';
import ParameterTuning from '../controls/ParameterTuning';
import StationList from '../station/StationList';
import BenchmarkPanel from '../benchmark/BenchmarkPanel';

type SidebarTab = 'sim' | 'benchmark' | 'tuning';

const TABS: Array<{ key: SidebarTab; label: string; color: string }> = [
  { key: 'sim', label: '仿真控制', color: 'var(--primary)' },
  { key: 'benchmark', label: '对比实验', color: 'var(--purple)' },
  { key: 'tuning', label: '调参', color: '#f59e0b' },
];

export default function Sidebar() {
  const [tab, setTab] = useState<SidebarTab>('sim');

  return (
    <aside className="sidebar">
      {/* Tab switcher */}
      <div className="sidebar-tabs">
        {TABS.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`sidebar-tab ${tab === key ? 'sidebar-tab--active' : ''}`}
            style={{ color: tab === key ? color : undefined }}
          >
            {label}
            {tab === key && (
              <div
                className="sidebar-tab-indicator"
                style={{ background: color, boxShadow: `0 -2px 6px ${color}66` }}
              />
            )}
          </button>
        ))}
      </div>

      {tab === 'sim' ? (
        <>
          <div className="sidebar-content">
            <SimulationControls />
            <div style={{ marginTop: 12 }}>
              <DayKindSelector />
            </div>
            <div style={{ marginTop: 12 }}>
              <ScenarioSelector />
            </div>
          </div>
          <div className="sidebar-scroll">
            <StationList />
          </div>
        </>
      ) : tab === 'benchmark' ? (
        <div className="sidebar-scroll">
          <BenchmarkPanel />
        </div>
      ) : (
        <div className="sidebar-scroll">
          <ParameterTuning />
        </div>
      )}
    </aside>
  );
}
