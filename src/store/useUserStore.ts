import { create } from 'zustand';
import type { User } from '../types';
import { useAuthStore } from './useAuthStore';

interface UserState {
  users: User[];
  fetchUsers: () => Promise<void>;
  createUser: (userInfo: any) => Promise<boolean>;
  updateUser: (id: string, updates: any) => Promise<boolean>;
  toggleUserStatus: (id: string, active: boolean) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  changePassword: (data: { currentPassword: string; newPassword: any }) => Promise<{ success: boolean; message: string }>;
}

const API_URL = 'http://localhost:3000/api';

const getHeaders = () => {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
};

export const useUserStore = create<UserState>((set, get) => ({
  users: [],

  fetchUsers: async () => {
    try {
      const res = await fetch(`${API_URL}/users`, {
        headers: getHeaders()
      });
      if (res.status === 401) return useAuthStore.getState().logout();
      if (res.ok) {
        const data = await res.json();
        set({ users: data });
      }
    } catch (err) {
      console.error('Falha ao buscar usuários:', err);
    }
  },

  createUser: async (userInfo) => {
    try {
      const res = await fetch(`${API_URL}/register`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(userInfo)
      });
      if (res.ok) {
        get().fetchUsers();
        return true;
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao criar usuário');
        return false;
      }
    } catch (err) {
      console.error('Falha ao salvar usuário:', err);
      return false;
    }
  },

  updateUser: async (id, updates) => {
    try {
      const res = await fetch(`${API_URL}/users/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        get().fetchUsers();
        return true;
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao atualizar usuário');
        return false;
      }
    } catch (err) {
      console.error('Falha ao atualizar usuário:', err);
      return false;
    }
  },

  toggleUserStatus: async (id, active) => {
    try {
      const res = await fetch(`${API_URL}/users/${id}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ active })
      });
      if (res.ok) {
        get().fetchUsers();
      }
    } catch (err) {
      console.error('Falha ao alterar status:', err);
    }
  },

  deleteUser: async (id) => {
    if (!confirm('Tem certeza que deseja excluir permanentemente este usuário?')) return;
    try {
      const res = await fetch(`${API_URL}/users/${id}/delete`, {
        method: 'PATCH',
        headers: getHeaders()
      });
      if (res.ok) {
        get().fetchUsers();
      }
    } catch (err) {
      console.error('Falha ao excluir usuário:', err);
    }
  },

  changePassword: async (data) => {
    try {
      const res = await fetch(`${API_URL}/users/me/password`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      const result = await res.json();
      return { success: res.ok, message: result.message || result.error };
    } catch (err) {
      return { success: false, message: 'Erro de conexão com o servidor.' };
    }
  }
}));
