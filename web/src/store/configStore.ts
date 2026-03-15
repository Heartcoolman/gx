import { create } from 'zustand';
import type { SystemConfig } from '../types/api';
import { DEFAULT_CONFIG } from '../data/presets';
import { getConfig, updateConfig } from '../api/client';

interface ConfigState {
  config: SystemConfig;
  loaded: boolean;
  syncing: boolean;
  activePreset: string | null;
  /** Load config from backend (only fetches once) */
  loadConfig: () => Promise<void>;
  /** Update a single parameter */
  setParam: (key: keyof SystemConfig, value: number) => void;
  /** Apply a full preset */
  applyPreset: (presetKey: string, presetConfig: SystemConfig) => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function syncToBackend(config: SystemConfig, set: (s: Partial<ConfigState>) => void) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    set({ syncing: true });
    try {
      await updateConfig(config);
    } catch { /* backend may be offline */ }
    set({ syncing: false });
  }, 500);
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,
  syncing: false,
  activePreset: 'default',

  loadConfig: async () => {
    if (get().loaded) return;
    try {
      const cfg = await getConfig();
      set({ config: cfg, loaded: true });
    } catch {
      set({ loaded: true }); // use defaults if backend is offline
    }
  },

  setParam: (key, value) => {
    const next = { ...get().config, [key]: value };
    set({ config: next, activePreset: null });
    syncToBackend(next, set);
  },

  applyPreset: (presetKey, presetConfig) => {
    set({ config: presetConfig, activePreset: presetKey });
    syncToBackend(presetConfig, set);
  },
}));
