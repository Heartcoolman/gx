import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';
import { SPEED_OPTIONS } from '../../data/constants';
import { useEngineControls } from '../../App';

export default function SimulationControls() {
  const { engineState, speed, dispatchEnabled } = useSimulationStore();
  const { isWarming } = useUIStore();
  const { play, pause, step, reset, changeSpeed, toggleDispatch } = useEngineControls();

  const btnStyle = (active = false): React.CSSProperties => ({
    padding: '6px 14px',
    border: 'none',
    borderRadius: 6,
    cursor: isWarming ? 'wait' : 'pointer',
    background: active ? '#2563eb' : '#e2e8f0',
    color: active ? '#fff' : '#334155',
    fontWeight: 500,
    fontSize: 13,
    opacity: isWarming ? 0.6 : 1,
  });

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
        仿真控制
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {engineState !== 'running' ? (
          <button
            style={btnStyle(true)}
            onClick={play}
            disabled={isWarming}
          >
            ▶ 播放
          </button>
        ) : (
          <button style={btnStyle()} onClick={pause}>
            ⏸ 暂停
          </button>
        )}
        <button
          style={btnStyle()}
          onClick={step}
          disabled={engineState === 'running' || isWarming}
        >
          ⏭ 步进
        </button>
        <button style={btnStyle()} onClick={() => reset()}>
          ↻ 重置
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>
          速度: {speed}x
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              style={{
                ...btnStyle(speed === s),
                padding: '4px 10px',
                fontSize: 12,
              }}
              onClick={() => changeSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
      {isWarming && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#f59e0b' }}>
          正在预热模型...
        </div>
      )}
      <div style={{
        marginTop: 14,
        padding: '10px 12px',
        background: dispatchEnabled ? '#eff6ff' : '#fef2f2',
        borderRadius: 8,
        border: `1px solid ${dispatchEnabled ? '#bfdbfe' : '#fecaca'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
              调度算法
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {dispatchEnabled ? '已启用 - 每30分钟自动调度' : '已关闭 - 自然流动模式'}
            </div>
          </div>
          <div
            onClick={() => toggleDispatch(!dispatchEnabled)}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              background: dispatchEnabled ? '#2563eb' : '#cbd5e1',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            <div style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              background: '#fff',
              position: 'absolute',
              top: 2,
              left: dispatchEnabled ? 22 : 2,
              transition: 'left 0.2s',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
