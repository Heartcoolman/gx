import type { Station } from '../../types/station';
import { CATEGORY_LABELS } from '../../types/station';
import { bikeRatioColor } from '../../utils/colors';

interface Props {
  station: Station;
  bikes: number;
  brokenBikes: number;
  pressure: number;
  selected: boolean;
  onClick: () => void;
}

export default function StationCard({ station, bikes, brokenBikes, pressure, selected, onClick }: Props) {
  const ratio = station.capacity > 0 ? bikes / station.capacity : 0;
  const color = bikeRatioColor(ratio);
  const pressureColor = pressure > 0.75 ? '#ef4444' : pressure > 0.5 ? '#f59e0b' : '#10b981';

  return (
    <div
      onClick={onClick}
      style={{
        padding: '8px 16px',
        cursor: 'pointer',
        background: selected ? '#eff6ff' : 'transparent',
        borderLeft: selected ? `3px solid ${color}` : '3px solid transparent',
        transition: 'all 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>
            {station.name}
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
            {CATEGORY_LABELS[station.category]}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color }}>
            {bikes}
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8' }}>
            /{station.capacity} 可借
          </div>
        </div>
      </div>
      <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
        <span style={{ color: '#ef4444' }}>坏车 {brokenBikes}</span>
        <span style={{ color: pressureColor }}>压力 {(pressure * 100).toFixed(0)}%</span>
      </div>
      {/* Mini progress bar */}
      <div style={{
        marginTop: 4,
        height: 3,
        background: '#e2e8f0',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${ratio * 100}%`,
          background: color,
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}
