import { STATIONS } from '../data/stations';
import { haversine } from '../utils/haversine';

// Pre-computed distance matrix (meters) for all 15 stations
export const distanceMatrix: number[][] = STATIONS.map((a) =>
  STATIONS.map((b) =>
    haversine(a.latitude, a.longitude, b.latitude, b.longitude)
  )
);
