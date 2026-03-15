import { useSimEnvStore, SIM_ENV_PRESETS, DEFAULT_SIM_ENV } from '../../store/simEnvStore';
import type { SimEnvConfig } from '../../store/simEnvStore';

interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** 'down' = 提高此值 ↓ 拥堵, 'up' = 提高此值 ↑ 拥堵 */
  effect: 'down' | 'up';
  format?: (v: number) => string;
}

const ENV_PARAMS: ParamDef[] = [
  { key: 'totalBikes', label: '总车辆数', min: 50, max: 2500, step: 50, unit: '辆', effect: 'down' },
  { key: 'demandMultiplier', label: '需求倍率', min: 0.3, max: 6.0, step: 0.1, unit: 'x', effect: 'up', format: v => v.toFixed(1) },
  { key: 'peakIntensity', label: '高峰强度', min: 0.5, max: 3.0, step: 0.1, unit: 'x', effect: 'up', format: v => v.toFixed(1) },
  { key: 'noiseFactor', label: '随机波动', min: 0, max: 0.6, step: 0.05, unit: '', effect: 'up', format: v => `${(v * 100).toFixed(0)}%` },
];

export default function ParameterTuning() {
  const simEnv = useSimEnvStore();

  return (
    <div style={{ padding: 16 }}>
      {/* ═══ Section 1: 仿真环境 ═══ */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>
              🌍 仿真环境
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              调整场景难度，控制自然拥堵率
            </div>
          </div>
        </div>

        {/* Env presets */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: 0.5 }}>
            场景预设
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {SIM_ENV_PRESETS.map(p => {
              const isActive = simEnv.totalBikes === p.config.totalBikes
                && simEnv.demandMultiplier === p.config.demandMultiplier
                && simEnv.peakIntensity === p.config.peakIntensity
                && simEnv.noiseFactor === p.config.noiseFactor;
              return (
                <button
                  key={p.key}
                  onClick={() => simEnv.applyPreset(p.config)}
                  style={{
                    padding: '8px 6px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${isActive ? p.color : 'var(--border-color)'}`,
                    background: isActive ? `${p.color}10` : 'var(--bg-panel)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{p.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Env sliders */}
        {ENV_PARAMS.map(p => (
          <ParamSlider
            key={p.key}
            def={p}
            value={simEnv[p.key as keyof SimEnvConfig]}
            onChange={v => simEnv.setParam(p.key as keyof SimEnvConfig, v)}
          />
        ))}

        <div style={{
          fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic',
          padding: '6px 8px', background: 'rgba(245, 158, 11, 0.06)',
          borderRadius: 'var(--radius-sm)', marginTop: 4,
        }}>
          💡 需求倍率 / 高峰强度 / 随机波动实时生效；总车辆数需重置仿真后生效
        </div>
      </div>

      {/* Reset */}
      <button
        onClick={() => simEnv.applyPreset(DEFAULT_SIM_ENV)}
        style={{
          width: '100%',
          marginTop: 12,
          padding: '10px 0',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-color)',
          background: 'var(--bg-panel)',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--text-muted)',
          transition: 'all var(--transition-fast)',
        }}
      >
        ↻ 重置为默认
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}


/* ─── Sub-component: Single Param Slider ─── */

function ParamSlider({
  def,
  value,
  onChange,
}: {
  def: ParamDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const displayValue = def.format ? def.format(value) : `${value}`;
  const pct = ((value - def.min) / (def.max - def.min)) * 100;
  const effectColor = def.effect === 'down' ? '#10b981' : '#ef4444';
  const effectLabel = def.effect === 'down' ? '↑ 降低拥堵' : '↑ 增加拥堵';

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 500 }}>{def.label}</span>
          <span style={{
            fontSize: 9, fontWeight: 600, color: effectColor,
            background: `${effectColor}12`,
            padding: '1px 5px',
            borderRadius: 3,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
          }}>
            {effectLabel}
          </span>
        </div>
        <span style={{
          fontSize: 12, fontWeight: 700, color: 'var(--primary)',
          background: 'rgba(59, 130, 246, 0.08)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
        }}>
          {displayValue}{def.unit && ` ${def.unit}`}
        </span>
      </div>
      <div style={{ position: 'relative', height: 20, display: 'flex', alignItems: 'center' }}>
        <div style={{
          position: 'absolute', top: '50%', left: 0, right: 0, height: 4, transform: 'translateY(-50%)',
          borderRadius: 2,
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${pct}%, var(--border-color) ${pct}%, var(--border-color) 100%)`,
        }} />
        <input
          type="range"
          min={def.min}
          max={def.max}
          step={def.step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          style={{
            width: '100%',
            height: 20,
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            cursor: 'pointer',
            position: 'relative',
            zIndex: 1,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
        <span>{def.format ? def.format(def.min) : def.min}{def.unit && ` ${def.unit}`}</span>
        <span>{def.format ? def.format(def.max) : def.max}{def.unit && ` ${def.unit}`}</span>
      </div>
    </div>
  );
}
