import { useUIStore } from '../../store/uiStore';
import DemandChart from './DemandChart';
import BikeDistribution from './BikeDistribution';
import RebalanceMetrics from './RebalanceMetrics';
import FlowMatrix from './FlowMatrix';
import IncentivePanel from './IncentivePanel';

const TABS = [
  { key: 'demand' as const, label: '需求趋势' },
  { key: 'distribution' as const, label: '车辆分布' },
  { key: 'metrics' as const, label: '调度指标' },
  { key: 'flow' as const, label: 'OD矩阵' },
  { key: 'incentive' as const, label: '激励措施' },
];

export default function DashboardPanel() {
  const { activeTab, setActiveTab } = useUIStore();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '0 16px',
        borderBottom: '1px solid #e2e8f0',
        background: '#f8fafc',
      }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '8px 16px',
              border: 'none',
              background: 'transparent',
              borderBottom: activeTab === key ? '2px solid #2563eb' : '2px solid transparent',
              color: activeTab === key ? '#2563eb' : '#64748b',
              fontWeight: activeTab === key ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {label}
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
