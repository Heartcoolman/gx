import { CircleMarker, Tooltip } from 'react-leaflet';
import type { VehicleAnimation } from '../../simulation/engine';
import { STATIONS } from '../../data/stations';
import { VEHICLE_COLORS } from '../../utils/colors';

interface Props {
  animation: VehicleAnimation;
}

export default function VehicleMarker({ animation }: Props) {
  const { vehicleId, path, currentSegmentIndex, progress } = animation;
  const color = VEHICLE_COLORS[vehicleId % VEHICLE_COLORS.length];

  if (path.length < 2) return null;

  const currentStation = STATIONS[path[currentSegmentIndex]];
  const nextIdx = Math.min(currentSegmentIndex + 1, path.length - 1);
  const nextStation = STATIONS[path[nextIdx]];

  if (!currentStation || !nextStation) return null;

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
