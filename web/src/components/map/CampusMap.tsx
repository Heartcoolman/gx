import { MapContainer, TileLayer } from 'react-leaflet';
import { MAP_CENTER, MAP_ZOOM } from '../../data/constants';
import StationMarker from './StationMarker';
import BikeFlowLayer from './BikeFlowLayer';
import DispatchRouteLayer from './DispatchRouteLayer';
import MapLegend from './MapLegend';
import { STATIONS } from '../../data/stations';
import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';

export default function CampusMap() {
  const { bikes, activeRides, vehicleAnimations, latestPlan } = useSimulationStore();
  const { showBikeFlows, showDispatchRoutes } = useUIStore();

  return (
    <MapContainer
      center={MAP_CENTER}
      zoom={MAP_ZOOM}
      style={{ width: '100%', height: '100%' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {STATIONS.map((station) => (
        <StationMarker
          key={station.id}
          station={station}
          bikes={bikes[station.id] ?? 0}
        />
      ))}

      {showBikeFlows && <BikeFlowLayer rides={activeRides} />}

      {showDispatchRoutes && latestPlan && (
        <DispatchRouteLayer plan={latestPlan} vehicleAnimations={vehicleAnimations} />
      )}

      <MapLegend />
    </MapContainer>
  );
}
