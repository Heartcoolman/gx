import { useSimulationStore } from '../../store/simulationStore';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '../../store/uiStore';
import { SPEED_OPTIONS } from '../../data/constants';
import { useEngineControls } from '../../App';

export default function SimulationControls() {
  const { engineState, speed, dispatchEnabled } = useSimulationStore(useShallow(s => ({
    engineState: s.engineState,
    speed: s.speed,
    dispatchEnabled: s.dispatchEnabled,
  })));
  const { isWarming } = useUIStore();
  const { play, pause, step, reset, changeSpeed, toggleDispatch } = useEngineControls();

  const btnClass = (active = false, isPrimary = false) => {
    if (active) return isPrimary ? 'btn btn-primary' : 'btn btn-secondary btn-active';
    return isPrimary ? 'btn btn-primary' : 'btn btn-secondary';
  };

  return (
    <div>
      <div className="controls-section-title">
        仿真控制
      </div>
      <div className="controls-row">
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
        <div className="speed-row">
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
        <div className="warming-indicator">
          <div className="warming-spinner" />
          正在预热模型...
        </div>
      )}
      <div className={`dispatch-toggle-box ${dispatchEnabled ? 'dispatch-toggle-box--on' : 'dispatch-toggle-box--off'}`}>
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
            className={`toggle-switch ${dispatchEnabled ? 'toggle-switch--on' : 'toggle-switch--off'}`}
          >
            <div
              className="toggle-knob"
              style={{ left: dispatchEnabled ? 22 : 2 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
