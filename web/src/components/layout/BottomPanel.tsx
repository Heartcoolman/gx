import { useUIStore } from '../../store/uiStore';
import DashboardPanel from '../dashboard/DashboardPanel';

export default function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel } = useUIStore();

  return (
    <div
      className="bottom-panel"
      style={{ height: bottomPanelOpen ? 300 : 38 }}
    >
      <div
        className="bottom-panel-toggle"
        onClick={toggleBottomPanel}
      >
        <span className={`bottom-panel-arrow ${bottomPanelOpen ? 'bottom-panel-arrow--open' : ''}`}>
          ▲
        </span>
        <span style={{ letterSpacing: '1px' }}>统计面板</span>
      </div>
      {bottomPanelOpen && (
        <div className="bottom-panel-content">
          <DashboardPanel />
        </div>
      )}
    </div>
  );
}
