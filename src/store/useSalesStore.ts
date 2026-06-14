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
  createCardPayment: (
    items: SaleItem[],
    totalAmount: number,
    accountId: string | undefined,
    paymentType: 'credit_card' | 'debit_card',
    installments: number
  ) => Promise<CardTransaction | undefined>;
  checkCardPayment: (transactionId: string) => Promise<CardTransaction | undefined>;
  cancelCardPayment: (transactionId: string) => Promise<CardTransaction | undefined>;
  simulateCardPayment: (transactionId: string, scenario: 'approved' | 'failed' | 'expired' | 'action_required') => Promise<CardTransaction | undefined>;
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

  createCardPayment: async (items, totalAmount, accountId, paymentType, installments) => {
    try {
      const transaction = await apiRequest<CardTransaction>('/payments/card', {
        method: 'POST',
        body: { items, totalAmount, accountId, paymentType, installments },
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

  cancelCardPayment: async (transactionId) => {
    try {
      const transaction = await apiRequest<CardTransaction>(`/payments/card/${transactionId}/cancel`, {
        method: 'POST',
      });
      if (transaction.status !== 'pending') {
        set(state => {
          const next = { ...state.pendingPixItems };
          delete next[transactionId];
          return { pendingPixItems: next };
        });
      }
      return transaction;
    } catch (err) {
      console.error('Falha ao cancelar pagamento no terminal:', err);
      alert(getApiErrorMessage(err, 'Erro ao cancelar pagamento no terminal'));
      return undefined;
    }
  },

  simulateCardPayment: async (transactionId, scenario) => {
    try {
      return await apiRequest<CardTransaction>(`/payments/card/${transactionId}/simulate`, {
        method: 'POST',
        body: { scenario },
      });
    } catch (err) {
      console.error('Falha ao simular pagamento Point:', err);
      alert(getApiErrorMessage(err, 'Erro ao simular pagamento Point'));
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
