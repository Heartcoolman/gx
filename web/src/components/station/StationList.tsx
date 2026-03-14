import { STATIONS } from '../../data/stations';
import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';
import StationCard from './StationCard';

export default function StationList() {
  const { bikes } = useSimulationStore();
  const { selectedStationId, selectStation } = useUIStore();

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{ padding: '0 16px 8px', fontSize: 12, fontWeight: 600, color: '#64748b' }}>
        站点列表 ({STATIONS.length})
      </div>
      {STATIONS.map((station) => (
        <StationCard
          key={station.id}
          station={station}
          bikes={bikes[station.id] ?? 0}
          selected={selectedStationId === station.id}
          onClick={() => selectStation(
            selectedStationId === station.id ? null : station.id
          )}
        />
      ))}
    </div>
  );
}
