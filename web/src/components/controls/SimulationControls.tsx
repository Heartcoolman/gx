import { useSimulationStore } from '../../store/simulationStore';
import { useUIStore } from '../../store/uiStore';
import { SPEED_OPTIONS } from '../../data/constants';
import { useEngineControls } from '../../App';

export default function SimulationControls() {
  const { engineState, speed, dispatchEnabled } = useSimulationStore();
  const { isWarming } = useUIStore();
  const { play, pause, step, reset, changeSpeed, toggleDispatch } = useEngineControls();

  const btnClass = (active = false, isPrimary = false) => {
    if (active) return isPrimary ? 'btn btn-primary' : 'btn btn-secondary btn-active';
    return isPrimary ? 'btn btn-primary' : 'btn btn-secondary';
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
        仿真控制
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {engineState !== 'running' ? (
          <button
            className={btnClass(true, true)}
            onClick={play}
            disabled={isWarming}
          >
            ▶ 播放
          </button>
        ) : (
          <button className={btnClass(false, false)} onClick={pause}>
            ⏸ 暂停
          </button>
        )}
        <button
          className={btnClass(false, false)}
          onClick={step}
          disabled={engineState === 'running' || isWarming}
        >
          ⏭ 步进
        </button>
        <button className={btnClass(false, false)} onClick={() => reset()}>
          ↻ 重置
        </button>
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
          倍速: <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{speed}x</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              className={s === speed ? 'btn btn-secondary btn-active' : 'btn btn-secondary'}
              style={{ padding: '4px 12px', fontSize: 12 }}
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
        marginTop: 18,
        padding: '12px 14px',
        background: dispatchEnabled ? 'rgba(59, 130, 246, 0.05)' : 'rgba(239, 68, 68, 0.03)',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${dispatchEnabled ? 'rgba(59, 130, 246, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
        transition: 'all var(--transition-normal)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>
              外部调度适配器
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {dispatchEnabled ? '已启用 - 作为可选插件接入' : '默认关闭 - 主仿真不依赖外部调度'}
            </div>
          </div>
          <div
            onClick={() => toggleDispatch(!dispatchEnabled)}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              background: dispatchEnabled ? 'var(--primary)' : 'var(--border-color)',
              cursor: 'pointer',
              position: 'relative',
              transition: 'background var(--transition-fast)',
              flexShrink: 0,
              boxShadow: dispatchEnabled ? '0 2px 6px rgba(59, 130, 246, 0.3)' : 'inset 0 2px 4px rgba(0,0,0,0.05)',
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
              transition: 'left var(--transition-fast)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
