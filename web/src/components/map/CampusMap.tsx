import { useMemo } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { MAP_CENTER, MAP_ZOOM } from '../../data/constants';
import StationMarker from './StationMarker';
import BikeFlowLayer from './BikeFlowLayer';
import DispatchRouteLayer from './DispatchRouteLayer';
import MapLegend from './MapLegend';
import { STATIONS } from '../../data/stations';
import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../store/uiStore';

export default function CampusMap() {
  const { bikes, brokenBikes, stationPressure, activeRides, vehicleAnimations, latestPlan } = useSimulationStore(useShallow(s => ({
    bikes: s.bikes,
    brokenBikes: s.brokenBikes,
    stationPressure: s.stationPressure,
    activeRides: s.activeRides,
    vehicleAnimations: s.vehicleAnimations,
    latestPlan: s.latestPlan,
  })));
  const { showBikeFlows, showDispatchRoutes } = useUIStore();

  // Compute global mean bike-to-capacity ratio for adaptive coloring
  const globalMeanRatio = useMemo(() => {
    if (bikes.length === 0) return 0.5;
    const totalBikes = bikes.reduce((a, b) => a + b, 0);
    const totalCapacity = STATIONS.reduce((a, s) => a + s.capacity, 0);
    return totalCapacity > 0 ? totalBikes / totalCapacity : 0.5;
  }, [bikes]);

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
          brokenBikes={brokenBikes[station.id] ?? 0}
          pressure={stationPressure[station.id] ?? 0}
          globalMeanRatio={globalMeanRatio}
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

