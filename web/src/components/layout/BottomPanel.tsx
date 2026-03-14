import { useUIStore } from '../../store/uiStore';
import DashboardPanel from '../dashboard/DashboardPanel';

export default function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel } = useUIStore();

  return (
    <div style={{
      borderTop: '1px solid #e2e8f0',
      background: '#fff',
      transition: 'height 0.3s ease',
      height: bottomPanelOpen ? 280 : 36,
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div
        onClick={toggleBottomPanel}
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          cursor: 'pointer',
          background: '#f1f5f9',
          borderBottom: bottomPanelOpen ? '1px solid #e2e8f0' : 'none',
          userSelect: 'none',
          fontSize: 13,
          fontWeight: 500,
          color: '#475569',
        }}
      >
        <span style={{ marginRight: 8, transform: bottomPanelOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>
          ▲
        </span>
        统计面板
      </div>
      {bottomPanelOpen && (
        <div style={{ height: 'calc(100% - 36px)', overflow: 'hidden' }}>
          <DashboardPanel />
        </div>
      )}
    </div>
  );
}
