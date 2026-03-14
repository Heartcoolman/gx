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
      width: 320,
      background: 'var(--bg-sidebar)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxShadow: '1px 0 10px rgba(0,0,0,0.02)',
      zIndex: 5,
    }}>
      {/* Tab switcher */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid var(--border-color)',
        background: 'rgba(255, 255, 255, 0.5)',
      }}>
        <button
          onClick={() => setTab('sim')}
          style={{
            flex: 1, padding: '14px 0', border: 'none', background: 'transparent',
            position: 'relative',
            color: tab === 'sim' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: tab === 'sim' ? 600 : 500,
            fontSize: 14, cursor: 'pointer',
            transition: 'color var(--transition-normal)',
          }}
        >
          仿真控制
          {tab === 'sim' && (
            <div style={{
              position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 3,
              background: 'var(--primary)', borderRadius: '3px 3px 0 0',
              boxShadow: '0 -2px 6px rgba(59, 130, 246, 0.4)'
            }} />
          )}
        </button>
        <button
          onClick={() => setTab('benchmark')}
          style={{
            flex: 1, padding: '14px 0', border: 'none', background: 'transparent',
            position: 'relative',
            color: tab === 'benchmark' ? 'var(--purple)' : 'var(--text-muted)',
            fontWeight: tab === 'benchmark' ? 600 : 500,
            fontSize: 14, cursor: 'pointer',
            transition: 'color var(--transition-normal)',
          }}
        >
          对比实验
          {tab === 'benchmark' && (
            <div style={{
              position: 'absolute', bottom: 0, left: '20%', right: '20%', height: 3,
              background: 'var(--purple)', borderRadius: '3px 3px 0 0',
              boxShadow: '0 -2px 6px rgba(139, 92, 246, 0.4)'
            }} />
          )}
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
