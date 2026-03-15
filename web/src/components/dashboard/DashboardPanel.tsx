import { useUIStore } from '../../store/uiStore';
import DemandChart from './DemandChart';
import BikeDistribution from './BikeDistribution';
import RebalanceMetrics from './RebalanceMetrics';
import FlowMatrix from './FlowMatrix';
import IncentivePanel from './IncentivePanel';

const TABS = [
  { key: 'demand' as const, label: '需求趋势' },
  { key: 'distribution' as const, label: '车辆分布' },
  { key: 'metrics' as const, label: '真实性指标' },
  { key: 'flow' as const, label: 'OD矩阵' },
  { key: 'incentive' as const, label: '场景洞察' },
];

export default function DashboardPanel() {
  const { activeTab, setActiveTab } = useUIStore();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-panel)' }}>
      <div className="dashboard-tabs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`dashboard-tab ${activeTab === key ? 'dashboard-tab--active' : ''}`}
          >
            {label}
            {activeTab === key && (
              <div className="dashboard-tab-indicator" />
            )}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
        {activeTab === 'demand' && <DemandChart />}
        {activeTab === 'distribution' && <BikeDistribution />}
        {activeTab === 'metrics' && <RebalanceMetrics />}
        {activeTab === 'flow' && <FlowMatrix />}
        {activeTab === 'incentive' && <IncentivePanel />}
      </div>
    </div>
  );
}
