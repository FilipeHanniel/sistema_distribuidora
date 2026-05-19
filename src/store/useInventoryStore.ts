import { create } from 'zustand';
import type { Product } from '../types';
import { useAuthStore } from './useAuthStore';

interface InventoryState {
  products: Product[];
  fetchProducts: () => Promise<void>;
  addProduct: (productInfo: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  updateStock: (id: string, quantityStep: number) => Promise<void>;
}

const API_URL = '/api';

const getHeaders = () => {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
};

export const useInventoryStore = create<InventoryState>((set, get) => ({
  products: [],
  
  fetchProducts: async () => {
    try {
      const res = await fetch(`${API_URL}/products`, {
        headers: getHeaders()
      });
      if (res.status === 401) return useAuthStore.getState().logout();
      const data = await res.json();
      set({ products: data });
    } catch (err) {
      console.error('Falha ao buscar produtos:', err);
    }
  },

  addProduct: async (productInfo) => {
    try {
      const res = await fetch(`${API_URL}/products`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(productInfo)
      });
      if (res.ok) {
        get().fetchProducts();
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao adicionar produto');
      }
    } catch (err) {
      console.error('Falha ao salvar produto:', err);
    }
  },

  updateProduct: async (id, updates) => {
    try {
      const res = await fetch(`${API_URL}/products/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        get().fetchProducts();
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao atualizar produto');
      }
    } catch (err) {
      console.error('Falha ao atualizar produto:', err);
    }
  },

  deleteProduct: async (id) => {
    try {
      const res = await fetch(`${API_URL}/products/${id}`, { 
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        get().fetchProducts();
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao deletar produto');
      }
    } catch (err) {
      console.error('Falha ao deletar produto:', err);
    }
  },

  updateStock: async (id, quantityStep) => {
    try {
      const res = await fetch(`${API_URL}/products/${id}/stock`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ quantityStep })
      });
      if (res.ok) {
        get().fetchProducts();
      }
    } catch (err) {
      console.error('Falha ao modificar estoque:', err);
    }
  },
}));
