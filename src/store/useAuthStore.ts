import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { UserRole } from '../types';

interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  name: string;
  establishmentId: string | null;
  establishmentName?: string | null;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  login: (user: AuthUser, token: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
  isSuperAdmin: () => boolean;
  isGestor: () => boolean;
  isOperador: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,

      login: (user, token) => set({ user, token }),
      logout: () => set({ user: null, token: null }),
      isAuthenticated: () => !!get().token,
      isSuperAdmin: () => get().user?.role === 'superadmin',
      isGestor: () => get().user?.role === 'gestor',
      isOperador: () => get().user?.role === 'operador',
    }),
    {
      name: 'distribuidora-auth-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
