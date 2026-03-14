import type { StationStatus } from '../types/station';
import type { DemandRecord } from '../types/demand';
import type { DispatchPlan } from '../types/dispatch';
import { STATIONS } from '../data/stations';
import { TOTAL_BIKES, INITIAL_DORMITORY_RATIO } from '../data/constants';
import { CATEGORY_STATIONS } from '../data/stations';

export interface ActiveRide {
  origin: number;
  destination: number;
  departureTime: number; // epoch ms
  arrivalTime: number;
  progress: number; // 0..1
}

export interface Snapshot {
  slotIndex: number;
  bikes: number[];
  totalRides: number;
  blockedCount: number;
}

export class StationStateManager {
  /** Available bikes at each station, indexed by station id */
  bikes: number[];
  activeRides: ActiveRide[] = [];
  totalRides = 0;
  blockedCount = 0;
  snapshots: Snapshot[] = [];

  constructor() {
    this.bikes = new Array(STATIONS.length).fill(0);
    this.initializeDistribution();
  }

  private initializeDistribution(): void {
    const dormIds = CATEGORY_STATIONS.dormitory;
    const dormBikes = Math.round(TOTAL_BIKES * INITIAL_DORMITORY_RATIO);
    const perDorm = Math.floor(dormBikes / dormIds.length);
    for (const id of dormIds) {
      this.bikes[id] = Math.min(perDorm, STATIONS[id].capacity);
    }

    let remaining = TOTAL_BIKES - dormIds.reduce((s, id) => s + this.bikes[id], 0);
    const otherStations = STATIONS.filter(s => !dormIds.includes(s.id));
    const totalOtherCap = otherStations.reduce((s, st) => s + st.capacity, 0);

    for (const st of otherStations) {
      const share = Math.round((st.capacity / totalOtherCap) * remaining);
      this.bikes[st.id] = Math.min(share, st.capacity);
    }

    // Fix rounding
    let total = this.bikes.reduce((a, b) => a + b, 0);
    while (total < TOTAL_BIKES) {
      for (let i = 0; i < this.bikes.length && total < TOTAL_BIKES; i++) {
        if (this.bikes[i] < STATIONS[i].capacity) {
          this.bikes[i]++;
          total++;
        }
      }
    }
  }

  /** Process departures: deduct bikes from origin stations */
  processDepartures(records: DemandRecord[]): DemandRecord[] {
    const accepted: DemandRecord[] = [];
    for (const r of records) {
      const oid = r.origin;
      if (this.bikes[oid] > 0) {
        this.bikes[oid]--;
        accepted.push(r);
        this.totalRides++;
        this.activeRides.push({
          origin: oid,
          destination: r.destination,
          departureTime: new Date(r.departure_time).getTime(),
          arrivalTime: new Date(r.arrival_time).getTime(),
          progress: 0,
        });
      } else {
        this.blockedCount++;
      }
    }
    return accepted;
  }

  /** Process arrivals: complete rides and return bikes */
  processArrivals(nowMs: number): void {
    const completed: ActiveRide[] = [];
    const remaining: ActiveRide[] = [];

    for (const ride of this.activeRides) {
      if (nowMs >= ride.arrivalTime) {
        completed.push(ride);
      } else {
        ride.progress = (nowMs - ride.departureTime) / (ride.arrivalTime - ride.departureTime);
        remaining.push(ride);
      }
    }

    for (const ride of completed) {
      const did = ride.destination;
      if (this.bikes[did] < STATIONS[did].capacity) {
        this.bikes[did]++;
      } else {
        // Overflow: find nearest station with space
        for (const st of STATIONS) {
          if (this.bikes[st.id] < st.capacity) {
            this.bikes[st.id]++;
            break;
          }
        }
      }
    }

    this.activeRides = remaining;
  }

  /** Apply dispatch plan: adjust bike counts */
  applyDispatchPlan(plan: DispatchPlan): void {
    for (const route of plan.vehicle_routes) {
      for (const stop of route.stops) {
        const sid = stop.station_id;
        if (stop.action === 'pickup') {
          const actual = Math.min(stop.bike_count, this.bikes[sid]);
          this.bikes[sid] -= actual;
        } else {
          const space = STATIONS[sid].capacity - this.bikes[sid];
          const actual = Math.min(stop.bike_count, space);
          this.bikes[sid] += actual;
        }
      }
    }
  }

  /** Take a snapshot for chart data */
  takeSnapshot(slotIndex: number): Snapshot {
    const snap: Snapshot = {
      slotIndex,
      bikes: [...this.bikes],
      totalRides: this.totalRides,
      blockedCount: this.blockedCount,
    };
    this.snapshots.push(snap);
    return snap;
  }

  /** Build StationStatus array for API call */
  buildStatus(): StationStatus[] {
    return STATIONS.map((st) => ({
      station_id: st.id,
      available_bikes: this.bikes[st.id],
      available_docks: st.capacity - this.bikes[st.id],
      timestamp: Math.floor(Date.now() / 1000),
    }));
  }

  reset(): void {
    this.bikes = new Array(STATIONS.length).fill(0);
    this.activeRides = [];
    this.totalRides = 0;
    this.blockedCount = 0;
    this.snapshots = [];
    this.initializeDistribution();
  }
}
