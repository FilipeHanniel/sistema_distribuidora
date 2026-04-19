import { create } from 'zustand';
import type { Sale, SaleItem } from '../types';
import { useInventoryStore } from './useInventoryStore';
import { useAuthStore } from './useAuthStore';

interface LastSale {
  id: string;
  amount: number;
  method: 'money' | 'card' | 'pix';
}

interface SalesState {
  sales: Sale[];
  lastSale: LastSale | null;
  showSuccessPopup: boolean;
  fetchSales: () => Promise<void>;
  addSale: (items: SaleItem[], totalAmount: number, paymentMethod: string) => Promise<void>;
  getSalesByDateRange: (startDate: Date, endDate: Date) => Sale[];
  triggerSuccessPopup: (id: string, amount: number, method: 'money' | 'card' | 'pix') => void;
  closeSuccessPopup: () => void;
}

const API_URL = 'http://localhost:3000/api';

const getHeaders = () => {
  const token = useAuthStore.getState().token;
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
};

export const useSalesStore = create<SalesState>((set, get) => ({
  sales: [],
  lastSale: null,
  showSuccessPopup: false,

  triggerSuccessPopup: (id, amount, method) => {
    set({ lastSale: { id, amount, method }, showSuccessPopup: true });
  },

  closeSuccessPopup: () => {
    set({ showSuccessPopup: false });
  },

  fetchSales: async () => {
    try {
      const res = await fetch(`${API_URL}/sales`, {
        headers: getHeaders()
      });
      if (res.status === 401) return useAuthStore.getState().logout();
      const data = await res.json();
      set({ sales: data });
    } catch (err) {
      console.error('Falha ao buscar histórico de vendas:', err);
    }
  },

  addSale: async (items, totalAmount, paymentMethod) => {
    try {
      const res = await fetch(`${API_URL}/sales`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ items, totalAmount, paymentMethod })
      });
      if (res.ok) {
        const data = await res.json();
        get().fetchSales();
        useInventoryStore.getState().fetchProducts();
        // Trigger the success popup with sale details
        get().triggerSuccessPopup(data.id, totalAmount, paymentMethod as 'money' | 'card' | 'pix');
        return data.id;
      } else {
        const err = await res.json();
        alert(err.error || 'Erro ao efetivar venda');
      }
    } catch (err) {
      console.error('Falha ao efetivar venda no backend:', err);
    }
  },

  getSalesByDateRange: (startDate, endDate) => {
    const { sales } = get();
    return sales.filter(sale => {
      const saleDate = new Date(sale.createdAt);
      return saleDate >= startDate && saleDate <= endDate;
    });
  }
}));
