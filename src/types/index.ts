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

export type PixProvider = 'fake' | 'mercado_pago' | 'asaas' | 'sicoob' | 'itau' | 'santander' | 'bradesco';

export interface PixAccount {
  id: string;
  establishmentId: string;
  name: string;
  provider: PixProvider;
  pixKey?: string;
  active: number;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export interface PixTransaction {
  id: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  saleId?: string;
  paidAt?: string;
  amount: number;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  expiresAt?: string;
  pixAccount?: PixAccount;
}

export interface AppNotification {
  id: string;
  establishmentId?: string;
  userId?: string;
  audience: 'gestor' | 'operador' | 'all';
  type: string;
  title: string;
  message: string;
  referenceType?: string;
  referenceId?: string;
  readAt?: string;
  scheduledFor?: string;
  createdAt: string;
}
