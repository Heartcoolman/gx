import { useSimulationStore } from '../../store/simulationStore';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../../types/station';

export default function FlowMatrix() {
  const { odMatrix } = useSimulationStore();
  const matrix = odMatrix;

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
              {CATEGORY_ORDER.map(c => (
                <th key={c} style={{ padding: 6, background: '#f1f5f9', textAlign: 'center', minWidth: 60 }}>
                  {CATEGORY_LABELS[c].slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORY_ORDER.map((rowCat, i) => (
              <tr key={rowCat}>
                <td style={{ padding: 6, fontWeight: 500, background: '#f8fafc' }}>
                  {CATEGORY_LABELS[rowCat]}
                </td>
                {CATEGORY_ORDER.map((colCat, j) => {
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
