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
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '0 16px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-panel)',
        zIndex: 1,
      }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              padding: '12px 16px',
              border: 'none',
              background: 'transparent',
              position: 'relative',
              color: activeTab === key ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: activeTab === key ? 600 : 500,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'color var(--transition-fast)',
            }}
          >
            {label}
            {activeTab === key && (
              <div style={{
                position: 'absolute', bottom: 0, left: '10%', right: '10%', height: 3,
                background: 'var(--primary)', borderRadius: '3px 3px 0 0',
                boxShadow: '0 -2px 6px rgba(59, 130, 246, 0.3)'
              }} />
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
