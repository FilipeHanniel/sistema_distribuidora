import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { UserRole } from '../types';

const AUTH_STORAGE_KEY = 'distribuidora-auth-storage';

// Remove a sessao criada por versoes antigas, que permanecia ativa apos fechar a aba.
localStorage.removeItem(AUTH_STORAGE_KEY);

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
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
