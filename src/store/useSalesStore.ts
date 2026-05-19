import { create } from 'zustand';
import type { Sale, SaleItem } from '../types';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import { useInventoryStore } from './useInventoryStore';

type PaymentMethod = 'money' | 'card' | 'pix';

interface LastSale {
  id: string;
  amount: number;
  method: PaymentMethod;
}

interface SalesState {
  sales: Sale[];
  lastSale: LastSale | null;
  showSuccessPopup: boolean;
  fetchSales: () => Promise<void>;
  addSale: (items: SaleItem[], totalAmount: number, paymentMethod: string) => Promise<string | undefined>;
  getSalesByDateRange: (startDate: Date, endDate: Date) => Sale[];
  triggerSuccessPopup: (id: string, amount: number, method: PaymentMethod) => void;
  closeSuccessPopup: () => void;
}

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
      const sales = await apiRequest<Sale[]>('/sales');
      set({ sales });
    } catch (err) {
      console.error('Falha ao buscar histórico de vendas:', err);
    }
  },

  addSale: async (items, totalAmount, paymentMethod) => {
    try {
      const data = await apiRequest<{ id: string }>('/sales', {
        method: 'POST',
        body: { items, totalAmount, paymentMethod },
      });
      get().fetchSales();
      useInventoryStore.getState().fetchProducts();
      get().triggerSuccessPopup(data.id, totalAmount, paymentMethod as PaymentMethod);
      return data.id;
    } catch (err) {
      console.error('Falha ao efetivar venda no backend:', err);
      alert(getApiErrorMessage(err, 'Erro ao efetivar venda'));
      return undefined;
    }
  },

  getSalesByDateRange: (startDate, endDate) => {
    const { sales } = get();
    return sales.filter(sale => {
      const saleDate = new Date(sale.createdAt);
      return saleDate >= startDate && saleDate <= endDate;
    });
  },
}));
