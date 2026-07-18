import { create } from 'zustand';
import type { User } from '../types';
import { apiRequest, getApiErrorMessage } from '../lib/api';

type UserPayload = {
  username: string;
  password?: string;
  name: string;
  role?: User['role'];
};

interface UserState {
  users: User[];
  clearUsers: () => void;
  fetchUsers: () => Promise<void>;
  createUser: (userInfo: UserPayload) => Promise<boolean>;
  updateUser: (id: string, updates: UserPayload) => Promise<boolean>;
  resetUserPassword: (id: string, newPassword: string) => Promise<boolean>;
  toggleUserStatus: (id: string, active: boolean) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  changePassword: (data: { currentPassword: string; newPassword: string }) => Promise<{ success: boolean; message: string }>;
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  clearUsers: () => set({ users: [] }),

  fetchUsers: async () => {
    try {
      const users = await apiRequest<User[]>('/users');
      set({ users });
    } catch (err) {
      console.error('Falha ao buscar usuários:', err);
    }
  },

  createUser: async (userInfo) => {
    try {
      await apiRequest('/register', {
        method: 'POST',
        body: userInfo,
      });
      get().fetchUsers();
      return true;
    } catch (err) {
      console.error('Falha ao salvar usuário:', err);
      alert(getApiErrorMessage(err, 'Erro ao criar usuário'));
      return false;
    }
  },

  updateUser: async (id, updates) => {
    try {
      await apiRequest(`/users/${id}`, {
        method: 'PUT',
        body: updates,
      });
      get().fetchUsers();
      return true;
    } catch (err) {
      console.error('Falha ao atualizar usuário:', err);
      alert(getApiErrorMessage(err, 'Erro ao atualizar usuário'));
      return false;
    }
  },

  resetUserPassword: async (id, newPassword) => {
    try {
      await apiRequest(`/users/${id}/password`, {
        method: 'PATCH',
        body: { newPassword },
      });
      get().fetchUsers();
      return true;
    } catch (err) {
      console.error('Falha ao redefinir senha:', err);
      alert(getApiErrorMessage(err, 'Erro ao redefinir senha'));
      return false;
    }
  },

  toggleUserStatus: async (id, active) => {
    try {
      await apiRequest(`/users/${id}/status`, {
        method: 'PATCH',
        body: { active },
      });
      get().fetchUsers();
    } catch (err) {
      console.error('Falha ao alterar status:', err);
    }
  },

  deleteUser: async (id) => {
    if (!confirm('Tem certeza que deseja excluir permanentemente este usuário?')) return;
    try {
      await apiRequest(`/users/${id}/delete`, { method: 'PATCH' });
      get().fetchUsers();
    } catch (err) {
      console.error('Falha ao excluir usuário:', err);
    }
  },

  changePassword: async (data) => {
    try {
      const result = await apiRequest<{ message?: string; error?: string }>('/users/me/password', {
        method: 'PATCH',
        body: data,
      });
      return { success: true, message: result.message || 'Senha alterada com sucesso!' };
    } catch (err) {
      return { success: false, message: getApiErrorMessage(err, 'Erro de conexão com o servidor.') };
    }
  },
}));
