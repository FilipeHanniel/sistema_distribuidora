import { create } from 'zustand';
import type { Product } from '../types';
import { apiRequest, getApiErrorMessage } from '../lib/api';

interface InventoryState {
  products: Product[];
  fetchProducts: () => Promise<void>;
  addProduct: (productInfo: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateProduct: (id: string, updates: Partial<Omit<Product, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  updateStock: (id: string, quantityStep: number) => Promise<void>;
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  products: [],
  
  fetchProducts: async () => {
    try {
      const products = await apiRequest<Product[]>('/products');
      set({ products });
    } catch (err) {
      console.error('Falha ao buscar produtos:', err);
    }
  },

  addProduct: async (productInfo) => {
    try {
      await apiRequest('/products', {
        method: 'POST',
        body: productInfo
      });
      get().fetchProducts();
    } catch (err) {
      console.error('Falha ao salvar produto:', err);
      alert(getApiErrorMessage(err, 'Erro ao adicionar produto'));
    }
  },

  updateProduct: async (id, updates) => {
    try {
      await apiRequest(`/products/${id}`, {
        method: 'PUT',
        body: updates
      });
      get().fetchProducts();
    } catch (err) {
      console.error('Falha ao atualizar produto:', err);
      alert(getApiErrorMessage(err, 'Erro ao atualizar produto'));
    }
  },

  deleteProduct: async (id) => {
    try {
      await apiRequest(`/products/${id}`, { 
        method: 'DELETE'
      });
      get().fetchProducts();
    } catch (err) {
      console.error('Falha ao deletar produto:', err);
      alert(getApiErrorMessage(err, 'Erro ao deletar produto'));
    }
  },

  updateStock: async (id, quantityStep) => {
    try {
      await apiRequest(`/products/${id}/stock`, {
        method: 'PATCH',
        body: { quantityStep }
      });
      get().fetchProducts();
    } catch (err) {
      console.error('Falha ao modificar estoque:', err);
    }
  },
}));
