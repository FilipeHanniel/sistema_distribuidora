import { create } from 'zustand';
import type { CardTransaction, FiscalDocument, PixTransaction, Sale, SaleItem } from '../types';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import { useInventoryStore } from './useInventoryStore';

type PaymentMethod = 'money' | 'card' | 'pix';

interface LastSale {
  id: string;
  amount: number;
  method: PaymentMethod;
  items: SaleItem[];
  createdAt: string;
  fiscalDocument?: FiscalDocument | null;
}

interface SalesState {
  sales: Sale[];
  lastSale: LastSale | null;
  showSuccessPopup: boolean;
  pendingPixItems: Record<string, SaleItem[]>;
  clearSalesSession: () => void;
  fetchSales: () => Promise<void>;
  addSale: (items: SaleItem[], totalAmount: number, paymentMethod: string) => Promise<string | undefined>;
  createPixPayment: (items: SaleItem[], totalAmount: number, pixAccountId?: string, deviceId?: string) => Promise<PixTransaction | undefined>;
  checkPixPayment: (transactionId: string) => Promise<PixTransaction | undefined>;
  cancelPixPayment: (transactionId: string) => Promise<PixTransaction | undefined>;
  createCardPayment: (items: SaleItem[], totalAmount: number, accountId?: string) => Promise<CardTransaction | undefined>;
  checkCardPayment: (transactionId: string) => Promise<CardTransaction | undefined>;
  getSalesByDateRange: (startDate: Date, endDate: Date) => Sale[];
  triggerSuccessPopup: (id: string, amount: number, method: PaymentMethod, items: SaleItem[], fiscalDocument?: FiscalDocument | null) => void;
  closeSuccessPopup: () => void;
}

export const useSalesStore = create<SalesState>((set, get) => ({
  sales: [],
  lastSale: null,
  showSuccessPopup: false,
  pendingPixItems: {},
  clearSalesSession: () => set({
    sales: [],
    lastSale: null,
    showSuccessPopup: false,
    pendingPixItems: {},
  }),

  triggerSuccessPopup: (id, amount, method, items, fiscalDocument = null) => {
    set({ lastSale: { id, amount, method, items, fiscalDocument, createdAt: new Date().toISOString() }, showSuccessPopup: true });
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
      const data = await apiRequest<{ id: string; fiscalDocument?: FiscalDocument | null }>('/sales', {
        method: 'POST',
        body: { items, totalAmount, paymentMethod },
      });
      get().fetchSales();
      useInventoryStore.getState().fetchProducts();
      get().triggerSuccessPopup(data.id, totalAmount, paymentMethod as PaymentMethod, items, data.fiscalDocument || null);
      return data.id;
    } catch (err) {
      console.error('Falha ao efetivar venda no backend:', err);
      alert(getApiErrorMessage(err, 'Erro ao efetivar venda'));
      return undefined;
    }
  },

  createPixPayment: async (items, totalAmount, pixAccountId, deviceId) => {
    try {
      const transaction = await apiRequest<PixTransaction>('/payments/pix', {
        method: 'POST',
        body: { items, totalAmount, pixAccountId, deviceId },
      });
      set(state => ({ pendingPixItems: { ...state.pendingPixItems, [transaction.id]: items } }));
      return transaction;
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
        const items = get().pendingPixItems[transactionId];
        if (items) get().triggerSuccessPopup(transaction.saleId, transaction.amount, 'pix', items, transaction.fiscalDocument || null);
        set(state => {
          const next = { ...state.pendingPixItems };
          delete next[transactionId];
          return { pendingPixItems: next };
        });
      }
      return transaction;
    } catch (err) {
      console.error('Falha ao consultar Pix:', err);
      return undefined;
    }
  },

  cancelPixPayment: async (transactionId) => {
    try {
      const transaction = await apiRequest<PixTransaction>(`/payments/pix/${transactionId}/cancel`, {
        method: 'POST',
      });
      if (transaction.status === 'paid' && transaction.saleId) {
        get().fetchSales();
        useInventoryStore.getState().fetchProducts();
        const items = get().pendingPixItems[transactionId];
        if (items) get().triggerSuccessPopup(transaction.saleId, transaction.amount, 'pix', items, transaction.fiscalDocument || null);
      }
      if (transaction.status !== 'pending') {
        set(state => {
          const next = { ...state.pendingPixItems };
          delete next[transactionId];
          return { pendingPixItems: next };
        });
      }
      return transaction;
    } catch (err) {
      console.error('Falha ao cancelar Pix:', err);
      alert(getApiErrorMessage(err, 'Erro ao cancelar Pix'));
      return undefined;
    }
  },

  createCardPayment: async (items, totalAmount, accountId) => {
    try {
      const transaction = await apiRequest<CardTransaction>('/payments/card', {
        method: 'POST',
        body: { items, totalAmount, accountId },
      });
      set(state => ({ pendingPixItems: { ...state.pendingPixItems, [transaction.id]: items } }));
      return transaction;
    } catch (err) {
      console.error('Falha ao criar pagamento no terminal:', err);
      alert(getApiErrorMessage(err, 'Erro ao enviar venda para o terminal'));
      return undefined;
    }
  },

  checkCardPayment: async (transactionId) => {
    try {
      const transaction = await apiRequest<CardTransaction>(`/payments/card/${transactionId}/status`);
      if (transaction.status === 'paid' && transaction.saleId) {
        get().fetchSales();
        useInventoryStore.getState().fetchProducts();
        const items = get().pendingPixItems[transactionId];
        if (items) get().triggerSuccessPopup(transaction.saleId, transaction.amount, 'card', items, transaction.fiscalDocument || null);
        set(state => {
          const next = { ...state.pendingPixItems };
          delete next[transactionId];
          return { pendingPixItems: next };
        });
      }
      return transaction;
    } catch (err) {
      console.error('Falha ao consultar terminal:', err);
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
