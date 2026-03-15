import { Polyline } from 'react-leaflet';
import type { DispatchPlan } from '../../types/dispatch';
import type { VehicleAnimation } from '../../simulation/engine';
import { STATIONS } from '../../data/stations';
import { VEHICLE_COLORS } from '../../utils/colors';
import { MAX_VISIBLE_VEHICLE_ROUTES } from '../../data/constants';
import VehicleMarker from './VehicleMarker';

interface Props {
  plan: DispatchPlan;
  vehicleAnimations: VehicleAnimation[];
}

export default function DispatchRouteLayer({ plan, vehicleAnimations }: Props) {
  const visibleRoutes = plan.vehicle_routes.slice(0, MAX_VISIBLE_VEHICLE_ROUTES);
  const visibleAnims = vehicleAnimations.slice(0, MAX_VISIBLE_VEHICLE_ROUTES);

  return (
    <>
      {visibleRoutes.map((route, i) => {
        if (route.stops.length === 0) return null;
        const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
        const positions = route.stops.map(stop => {
          const st = STATIONS[stop.station_id];
          return [st.latitude, st.longitude] as [number, number];
        });

        return (
          <Polyline
            key={route.vehicle_id}
            positions={positions}
            pathOptions={{
              color,
              weight: 3,
              opacity: 0.7,
              dashArray: '8 4',
            }}
          />
        );
      })}

      {visibleAnims.map((anim) => (
        <VehicleMarker key={anim.vehicleId} animation={anim} />
      ))}
    </>
  );
}
