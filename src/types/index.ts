export interface Product {
  id: string;
  barcode: string;
  name: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  category: string;
  ncm?: string;
  cfop?: string;
  csosn?: string;
  cst?: string;
  fiscalUnit?: string;
  origin?: string;
  taxRate?: number;
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
  paymentTransaction?: PaymentConfirmation | null;
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

export type PixProvider = 'fake' | 'mercado_pago_fake' | 'mercado_pago' | 'asaas' | 'sicoob' | 'itau' | 'santander' | 'bradesco';

export interface PixAccount {
  id: string;
  establishmentId: string;
  name: string;
  provider: PixProvider;
  pixKey?: string;
  supportsPix?: boolean;
  supportsPoint?: boolean;
  terminalId?: string;
  storeId?: string;
  posId?: string;
  mpEnvironment?: string;
  payerEmail?: string;
  statementDescriptor?: string;
  payerFirstName?: string;
  payerLastName?: string;
  payerIdentificationType?: string;
  payerIdentificationNumber?: string;
  payerPhoneAreaCode?: string;
  payerPhoneNumber?: string;
  payerZipCode?: string;
  payerStreetName?: string;
  payerStreetNumber?: string;
  payerCity?: string;
  payerState?: string;
  payerNeighborhood?: string;
  payerComplement?: string;
  active: number;
  isDefault: number;
  createdAt: string;
  updatedAt: string;
}

export interface PixTransaction {
  id: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  saleId?: string;
  fiscalDocument?: FiscalDocument | null;
  paidAt?: string;
  amount: number;
  provider?: string;
  providerTransactionId?: string;
  providerPaymentId?: string | null;
  externalReference?: string | null;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
  expiresAt?: string;
  pixAccount?: PixAccount;
  paymentConfirmation?: PaymentConfirmation | null;
}

export interface CardTransaction {
  id: string;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  saleId?: string;
  fiscalDocument?: FiscalDocument | null;
  paidAt?: string;
  amount: number;
  provider?: string;
  providerTransactionId?: string;
  terminalId?: string;
  expiresAt?: string;
  paymentConfirmation?: PaymentConfirmation | null;
}

export interface PaymentConfirmation {
  id: string;
  provider: string;
  providerTransactionId?: string;
  providerPaymentId?: string | null;
  status: 'pending' | 'paid' | 'cancelled' | 'expired';
  paymentMethod: 'pix' | 'card';
  amount: number;
  paidAt?: string;
  createdAt: string;
  providerStatus?: string | null;
  providerStatusDetail?: string | null;
  confirmationSource: 'polling' | 'provider' | 'simulated';
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

export interface FiscalSettings {
  establishmentId: string;
  enabled: number;
  providerMode: 'simulated' | 'sefaz_go';
  environment: 'homologation' | 'production';
  documentModel: '65';
  serie: string;
  nextNumber: number;
  cnpj: string;
  stateRegistration: string;
  legalName: string;
  tradeName: string;
  taxRegime: 'mei' | 'simples' | 'normal';
  cscId: string;
  hasCsc: boolean;
  certificatePath: string;
  hasCertificatePassword: boolean;
  autoIssueOnPayment: number;
  autoPrintOnAuthorization: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface FiscalDocument {
  id: string;
  establishmentId: string;
  saleId: string;
  model: '65';
  serie?: string;
  number?: number;
  environment: 'homologation' | 'production';
  status: 'pending_configuration' | 'pending_authorization' | 'authorized' | 'rejected' | 'cancelled';
  cStat?: string;
  accessKey?: string;
  protocol?: string;
  qrCodeUrl?: string;
  validationMessages?: string;
  error?: string;
  authorizedAt?: string;
  printedAt?: string;
  createdAt: string;
  updatedAt: string;
  totalAmount?: number;
  paymentMethod?: string;
  saleCreatedAt?: string;
}
