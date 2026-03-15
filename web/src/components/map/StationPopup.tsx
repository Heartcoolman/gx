import { Popup } from 'react-leaflet';
import type { Station } from '../../types/station';
import { CATEGORY_LABELS } from '../../types/station';
import { bikeRatioColor, bikeRatioLabel } from '../../utils/colors';
import { formatPercent } from '../../utils/formatting';
import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';

interface Props {
  station: Station;
  bikes: number;
  brokenBikes: number;
  pressure: number;
  globalMeanRatio: number;
}

export default function StationPopup({ station, bikes, brokenBikes, pressure, globalMeanRatio }: Props) {
  const { maintenanceBikes, snapshots } = useSimulationStore(useShallow(s => ({
    maintenanceBikes: s.maintenanceBikes,
    snapshots: s.snapshots,
  })));
  const ratio = station.capacity > 0 ? bikes / station.capacity : 0;
  const color = bikeRatioColor(ratio, globalMeanRatio);
  const latestSnapshot = snapshots[snapshots.length - 1];
  const runtime = latestSnapshot?.stationStates.find((state) => state.stationId === station.id);

  return (
    <Popup>
      <div style={{ minWidth: 180 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 15, color: '#1e293b' }}>
          {station.name}
        </h3>
        <table style={{ fontSize: 13, lineHeight: 1.8, width: '100%' }}>
          <tbody>
            <tr>
              <td style={{ color: '#64748b' }}>类别</td>
              <td style={{ textAlign: 'right' }}>{CATEGORY_LABELS[station.category]}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>可用车辆</td>
              <td style={{ textAlign: 'right', fontWeight: 600, color }}>{bikes}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>坏车 / 维修</td>
              <td style={{ textAlign: 'right', color: '#ef4444' }}>
                {brokenBikes} / {maintenanceBikes[station.id] ?? 0}
              </td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>总桩位</td>
              <td style={{ textAlign: 'right' }}>{station.capacity}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>占用率</td>
              <td style={{ textAlign: 'right' }}>{formatPercent(ratio)}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>状态</td>
              <td style={{ textAlign: 'right', color }}>{bikeRatioLabel(ratio, globalMeanRatio)}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>压力指数</td>
              <td style={{ textAlign: 'right', color: pressure > 0.7 ? '#ef4444' : '#0f766e' }}>
                {(pressure * 100).toFixed(0)}%
              </td>
            </tr>
            {runtime && (
              <>
                <tr>
                  <td style={{ color: '#64748b' }}>本时段未满足</td>
                  <td style={{ textAlign: 'right' }}>{runtime.recentUnmetDemand}</td>
                </tr>
                <tr>
                  <td style={{ color: '#64748b' }}>回停溢出</td>
                  <td style={{ textAlign: 'right' }}>{runtime.overflowReturns}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}
