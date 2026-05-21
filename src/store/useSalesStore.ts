import { create } from 'zustand';
import type { PixTransaction, Sale, SaleItem } from '../types';
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
  createPixPayment: (items: SaleItem[], totalAmount: number, pixAccountId?: string) => Promise<PixTransaction | undefined>;
  checkPixPayment: (transactionId: string) => Promise<PixTransaction | undefined>;
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

  createPixPayment: async (items, totalAmount, pixAccountId) => {
    try {
      return await apiRequest<PixTransaction>('/payments/pix', {
        method: 'POST',
        body: { items, totalAmount, pixAccountId },
      });
    } catch (err) {
      console.error('Falha ao criar cobranca Pix:', err);
      alert(getApiErrorMessage(err, 'Erro ao criar cobranca Pix'));
      return undefined;
    }
  },

  checkPixPayment: async (transactionId) => {
    try {
      const transaction = await apiRequest<PixTransaction>(`/payments/pix/${transactionId}/status`);
      if (transaction.status === 'paid' && transaction.saleId) {
        get().fetchSales();
        useInventoryStore.getState().fetchProducts();
        get().triggerSuccessPopup(transaction.saleId, transaction.amount, 'pix');
      }
      return transaction;
    } catch (err) {
      console.error('Falha ao consultar Pix:', err);
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
