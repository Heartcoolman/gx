import { CircleMarker, Tooltip } from 'react-leaflet';
import type { VehicleAnimation } from '../../simulation/engine';
import { STATIONS } from '../../data/stations';
import { VEHICLE_COLORS } from '../../utils/colors';

interface Props {
  animation: VehicleAnimation;
}

export default function VehicleMarker({ animation }: Props) {
  const { vehicleId, stops, currentStopIndex, progress } = animation;
  const color = VEHICLE_COLORS[vehicleId % VEHICLE_COLORS.length];

  if (stops.length === 0) return null;

  // Interpolate between current stop and next stop
  const currentStation = STATIONS[stops[currentStopIndex]];
  const nextIdx = Math.min(currentStopIndex + 1, stops.length - 1);
  const nextStation = STATIONS[stops[nextIdx]];

  const lat = currentStation.latitude + (nextStation.latitude - currentStation.latitude) * progress;
  const lng = currentStation.longitude + (nextStation.longitude - currentStation.longitude) * progress;

  return (
    <CircleMarker
      center={[lat, lng]}
      radius={7}
      pathOptions={{
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 1,
      }}
    >
      <Tooltip direction="top" offset={[0, -10]}>
        调度车 #{vehicleId + 1}
      </Tooltip>
    </CircleMarker>
  );
}
