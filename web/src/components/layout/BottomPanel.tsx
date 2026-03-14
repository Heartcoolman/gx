import { useUIStore } from '../../store/uiStore';
import DashboardPanel from '../dashboard/DashboardPanel';

export default function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel } = useUIStore();

  return (
    <div style={{
      borderTop: '1px solid rgba(226, 232, 240, 0.8)',
      background: 'var(--bg-panel)',
      transition: 'height var(--transition-normal)',
      height: bottomPanelOpen ? 300 : 38,
      overflow: 'hidden',
      flexShrink: 0,
      boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.04)',
      position: 'relative',
      zIndex: 20,
    }}>
      <div
        onClick={toggleBottomPanel}
        style={{
          height: 38,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: 'var(--bg-panel)',
          borderBottom: 'none',
          userSelect: 'none',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--text-muted)',
          transition: 'all var(--transition-fast)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--primary)';
          e.currentTarget.style.background = 'var(--bg-main)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.background = 'var(--bg-panel)';
        }}
      >
        <span style={{ 
          marginRight: 6, 
          transform: bottomPanelOpen ? 'rotate(180deg)' : 'rotate(0)', 
          transition: 'transform var(--transition-normal)',
          fontSize: 10
        }}>
          ▲
        </span>
        <span style={{ letterSpacing: '1px' }}>统计面板</span>
      </div>
      {bottomPanelOpen && (
        <div style={{ height: 'calc(100% - 36px)', overflow: 'hidden' }}>
          <DashboardPanel />
        </div>
      )}
    </div>
  );
}
