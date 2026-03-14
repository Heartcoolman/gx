import { create } from 'zustand';

export interface UIState {
  selectedStationId: number | null;
  bottomPanelOpen: boolean;
  activeTab: 'demand' | 'distribution' | 'metrics' | 'flow' | 'incentive';
  showBikeFlows: boolean;
  showDispatchRoutes: boolean;
  isWarming: boolean;

  selectStation: (id: number | null) => void;
  toggleBottomPanel: () => void;
  setActiveTab: (tab: UIState['activeTab']) => void;
  setShowBikeFlows: (v: boolean) => void;
  setShowDispatchRoutes: (v: boolean) => void;
  setIsWarming: (v: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedStationId: null,
  bottomPanelOpen: true,
  activeTab: 'demand',
  showBikeFlows: true,
  showDispatchRoutes: true,
  isWarming: false,

  selectStation: (selectedStationId) => set({ selectedStationId }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setActiveTab: (activeTab) => set({ activeTab }),
  setShowBikeFlows: (showBikeFlows) => set({ showBikeFlows }),
  setShowDispatchRoutes: (showDispatchRoutes) => set({ showDispatchRoutes }),
  setIsWarming: (isWarming) => set({ isWarming }),
}));
