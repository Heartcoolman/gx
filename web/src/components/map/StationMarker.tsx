import { CircleMarker, Tooltip } from 'react-leaflet';
import type { Station } from '../../types/station';
import { bikeRatioColor } from '../../utils/colors';
import { useUIStore } from '../../store/uiStore';
import StationPopup from './StationPopup';

interface Props {
  station: Station;
  bikes: number;
  brokenBikes: number;
  pressure: number;
}

export default function StationMarker({ station, bikes, brokenBikes, pressure }: Props) {
  const { selectStation, selectedStationId } = useUIStore();
  const ratio = station.capacity > 0 ? bikes / station.capacity : 0;
  const color = bikeRatioColor(ratio);
  const isSelected = selectedStationId === station.id;
  const radius = 8 + Math.log2(station.capacity / 15) * 4;

  return (
    <CircleMarker
      center={[station.latitude, station.longitude]}
      radius={radius}
      pathOptions={{
        fillColor: color,
        color: isSelected ? '#000' : color,
        weight: isSelected ? 3 : 2,
        opacity: 1,
        fillOpacity: 0.7,
      }}
      eventHandlers={{
        click: () => selectStation(station.id),
      }}
    >
      <Tooltip direction="top" offset={[0, -radius]} permanent>
        <div style={{ textAlign: 'center', fontSize: 11, lineHeight: 1.3 }}>
          <div style={{ fontWeight: 600 }}>{station.name}</div>
          <div>{bikes}/{station.capacity}</div>
          <div style={{ color: '#64748b' }}>坏车 {brokenBikes} / 压力 {(pressure * 100).toFixed(0)}%</div>
        </div>
      </Tooltip>
      <StationPopup station={station} bikes={bikes} brokenBikes={brokenBikes} pressure={pressure} />
    </CircleMarker>
  );
}
