import { Popup } from 'react-leaflet';
import type { Station } from '../../types/station';
import { CATEGORY_LABELS } from '../../types/station';
import { bikeRatioColor, bikeRatioLabel } from '../../utils/colors';
import { formatPercent } from '../../utils/formatting';
import { useSimulationStore } from '../../store/simulationStore';

interface Props {
  station: Station;
  bikes: number;
}

export default function StationPopup({ station, bikes }: Props) {
  const { latestTargets } = useSimulationStore();
  const ratio = station.capacity > 0 ? bikes / station.capacity : 0;
  const color = bikeRatioColor(ratio);
  const target = latestTargets.find(t => t.station_id === station.id);

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
              <td style={{ color: '#64748b' }}>总桩位</td>
              <td style={{ textAlign: 'right' }}>{station.capacity}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>占用率</td>
              <td style={{ textAlign: 'right' }}>{formatPercent(ratio)}</td>
            </tr>
            <tr>
              <td style={{ color: '#64748b' }}>状态</td>
              <td style={{ textAlign: 'right', color }}>{bikeRatioLabel(ratio)}</td>
            </tr>
            {target && (
              <>
                <tr>
                  <td style={{ color: '#64748b' }}>目标车辆</td>
                  <td style={{ textAlign: 'right' }}>{target.target_bikes}</td>
                </tr>
                <tr>
                  <td style={{ color: '#64748b' }}>高峰期</td>
                  <td style={{ textAlign: 'right' }}>{target.is_peak ? '是' : '否'}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}
