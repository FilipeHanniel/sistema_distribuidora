export interface Product {
  id: string;
  barcode: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  category: string;
  establishmentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface Sale {
  id: string;
  items: SaleItem[];
  totalAmount: number;
  paymentMethod: 'money' | 'card' | 'pix';
  fiscalStatus?: string;
  establishmentId?: string;
  createdAt: string;
}

export type UserRole = 'superadmin' | 'gestor' | 'operador';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  active: number;
  establishmentId?: string;
  createdAt: string;
}

export interface Establishment {
  id: string;
  name: string;
  ownerName: string;
  email?: string;
  phone?: string;
  plan: 'basic' | 'premium' | 'enterprise';
  subscriptionStatus: 'active' | 'overdue' | 'suspended';
  subscriptionDueDate?: string;
  notes?: string;
  userCount?: number;
  salesCount?: number;
  revenueMonth?: number;
  createdAt: string;
}
