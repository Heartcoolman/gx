import { useSimulationStore } from '../../store/simulationStore';
import { CATEGORY_LABELS, type StationCategory } from '../../types/station';
import { STATIONS } from '../../data/stations';

const CATEGORIES: StationCategory[] = [
  'dormitory', 'academic_building', 'cafeteria', 'library', 'sports_field', 'main_gate',
];

export default function FlowMatrix() {
  const { snapshots } = useSimulationStore();

  // Build OD flow matrix from snapshots
  // Using bikes changes as proxy for flows (simplified)
  const matrix: number[][] = CATEGORIES.map(() => CATEGORIES.map(() => 0));

  // Estimate flows from bike changes between snapshots
  if (snapshots.length >= 2) {
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      for (const st of STATIONS) {
        const diff = prev.bikes[st.id] - curr.bikes[st.id];
        if (diff > 0) {
          // Bikes left this station - pickup
          const catIdx = CATEGORIES.indexOf(st.category);
          // Distribute proportionally to other categories
          for (let j = 0; j < CATEGORIES.length; j++) {
            if (j !== catIdx) {
              matrix[catIdx][j] += diff / (CATEGORIES.length - 1);
            }
          }
        }
      }
    }
  }

  const maxVal = Math.max(1, ...matrix.flat());

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#334155' }}>
        类别间OD流量矩阵
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ padding: 6, background: '#f1f5f9', textAlign: 'left' }}>出发 ↓ / 到达 →</th>
              {CATEGORIES.map(c => (
                <th key={c} style={{ padding: 6, background: '#f1f5f9', textAlign: 'center', minWidth: 60 }}>
                  {CATEGORY_LABELS[c].slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((rowCat, i) => (
              <tr key={rowCat}>
                <td style={{ padding: 6, fontWeight: 500, background: '#f8fafc' }}>
                  {CATEGORY_LABELS[rowCat]}
                </td>
                {CATEGORIES.map((colCat, j) => {
                  const val = matrix[i][j];
                  const intensity = val / maxVal;
                  return (
                    <td
                      key={colCat}
                      style={{
                        padding: 6,
                        textAlign: 'center',
                        background: i === j
                          ? '#f1f5f9'
                          : `rgba(59, 130, 246, ${intensity * 0.6})`,
                        color: intensity > 0.5 ? '#fff' : '#334155',
                        fontWeight: intensity > 0.3 ? 600 : 400,
                      }}
                    >
                      {Math.round(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
