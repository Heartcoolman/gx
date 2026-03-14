import { useState } from 'react';
import SimulationControls from '../controls/SimulationControls';
import DayKindSelector from '../controls/DayKindSelector';
import StationList from '../station/StationList';
import BenchmarkPanel from '../benchmark/BenchmarkPanel';

type SidebarTab = 'sim' | 'benchmark';

export default function Sidebar() {
  const [tab, setTab] = useState<SidebarTab>('sim');

  return (
    <aside style={{
      width: 300,
      background: '#f8fafc',
      borderRight: '1px solid #e2e8f0',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Tab switcher */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #e2e8f0',
        background: '#f1f5f9',
      }}>
        <button
          onClick={() => setTab('sim')}
          style={{
            flex: 1, padding: '10px 0', border: 'none', background: 'transparent',
            borderBottom: tab === 'sim' ? '2px solid #2563eb' : '2px solid transparent',
            color: tab === 'sim' ? '#2563eb' : '#64748b',
            fontWeight: tab === 'sim' ? 600 : 400,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          仿真控制
        </button>
        <button
          onClick={() => setTab('benchmark')}
          style={{
            flex: 1, padding: '10px 0', border: 'none', background: 'transparent',
            borderBottom: tab === 'benchmark' ? '2px solid #7c3aed' : '2px solid transparent',
            color: tab === 'benchmark' ? '#7c3aed' : '#64748b',
            fontWeight: tab === 'benchmark' ? 600 : 400,
            fontSize: 13, cursor: 'pointer',
          }}
        >
          对比实验
        </button>
      </div>

      {tab === 'sim' ? (
        <>
          <div style={{ padding: 16, borderBottom: '1px solid #e2e8f0' }}>
            <SimulationControls />
            <div style={{ marginTop: 12 }}>
              <DayKindSelector />
            </div>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <StationList />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          <BenchmarkPanel />
        </div>
      )}
    </aside>
  );
}
