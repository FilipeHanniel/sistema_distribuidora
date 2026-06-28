import { create } from 'zustand';
import { apiRequest } from '../lib/api';
import type { TenantSettings } from '../types';

export const DEFAULT_UI_SETTINGS = {
  lowStockThreshold: 5,
  receiptAutoCloseSeconds: 5,
  receiptFooter: '',
};

interface SettingsState {
  settings: TenantSettings | null;
  loading: boolean;
  clearSettings: () => void;
  fetchSettings: () => Promise<void>;
  saveSettings: (value: TenantSettings) => Promise<TenantSettings>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,
  clearSettings: () => set({ settings: null, loading: false }),
  fetchSettings: async () => {
    set({ loading: true });
    try {
      const settings = await apiRequest<TenantSettings>('/settings');
      set({ settings });
    } finally {
      set({ loading: false });
    }
  },
  saveSettings: async (value) => {
    const settings = await apiRequest<TenantSettings>('/settings', {
      method: 'PUT',
      body: value,
    });
    set({ settings });
    return settings;
  },
}));
