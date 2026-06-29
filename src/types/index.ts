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
  loginCode: string;
  ownerName: string;
  email?: string;
  phone?: string;
  plan: 'basic' | 'premium' | 'enterprise';
  subscriptionStatus: 'active' | 'overdue' | 'suspended';
  subscriptionDueDate?: string;
  subscriptionGraceDays?: number;
  subscriptionStatusReason?: 'past_due' | 'manual' | null;
  subscriptionStatusUpdatedAt?: string;
  billing?: SubscriptionBilling;
  notes?: string;
  userCount?: number;
  salesCount?: number;
  revenueMonth?: number;
  planDefinition?: PlanDefinition;
  usage?: TenantUsage;
  createdAt: string;
}

export interface SubscriptionBilling {
  dueDate?: string | null;
  status: Establishment['subscriptionStatus'];
  reason?: 'past_due' | 'manual' | string | null;
  manualSuspension: boolean;
  graceDays: number;
  daysUntilDue: number | null;
  daysPastDue: number | null;
  suspensionDate?: string | null;
}

export interface TenantStatus {
  establishment: Pick<Establishment, 'id' | 'name' | 'plan' | 'subscriptionStatus' | 'subscriptionDueDate' | 'subscriptionGraceDays' | 'subscriptionStatusReason'>;
  plan: PlanDefinition;
  usage: TenantUsage;
  subscription: {
    status: Establishment['subscriptionStatus'];
    canOperate: boolean;
    message?: string | null;
  };
  billing: SubscriptionBilling;
}

export interface PlanLimits {
  maxUsers: number | null;
  maxOperators: number | null;
  maxProducts: number | null;
  maxPaymentAccounts: number | null;
}

export interface PlanDefinition {
  key: Establishment['plan'];
  label: string;
  description: string;
  limits: PlanLimits;
  features: {
    fiscal: boolean;
    aiReports: boolean;
    mercadoPagoPix: boolean;
    mercadoPagoPoint: boolean;
  };
}

export interface TenantUsage {
  users: number;
  operators: number;
  products: number;
  paymentAccounts: number;
}

export interface TenantSettings {
  establishmentId: string;
  name: string;
  loginCode: string;
  ownerName: string;
  email: string;
  phone: string;
  lowStockThreshold: number;
  receiptAutoCloseSeconds: number;
  receiptFooter: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  establishmentId?: string | null;
  establishmentName?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
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
  mpUserId?: string;
  storeExternalId?: string;
  posExternalId?: string;
  defaultType?: 'credit_card' | 'debit_card';
  defaultInstallments?: number;
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
  providerPaymentId?: string | null;
  externalReference?: string | null;
  providerStatus?: string | null;
  providerStatusDetail?: string | null;
  terminalId?: string;
  paymentType?: 'credit_card' | 'debit_card';
  installments?: number;
  isTest?: boolean;
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

export type PaymentTransactionStatus = 'pending' | 'paid' | 'cancelled' | 'expired' | 'processing' | 'error';
export type PaymentTransactionIssue = 'provider_error' | 'paid_without_sale' | 'finalization_in_progress' | 'expired_pending';

export interface PaymentTransactionRecord {
  id: string;
  provider: string;
  providerTransactionId?: string | null;
  providerPaymentId?: string | null;
  externalReference?: string | null;
  accountName?: string | null;
  status: PaymentTransactionStatus;
  paymentMethod: 'pix' | 'card';
  amount: number;
  saleId?: string | null;
  fiscalStatus?: string | null;
  error?: string | null;
  issue?: PaymentTransactionIssue | null;
  confirmationSource?: 'polling' | 'provider' | 'simulated' | null;
  providerStatus?: string | null;
  providerStatusDetail?: string | null;
  itemCount: number;
  paidAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PointTerminal {
  id: string;
  posId?: string;
  storeId?: string;
  externalPosId?: string;
  operatingMode?: 'PDV' | 'STANDALONE' | 'UNDEFINED' | string;
}

export interface PointSetupResponse {
  account: PixAccount;
  terminals: PointTerminal[];
}

export interface PaymentTransactionSummary {
  totalCount: number;
  totalAmount: number;
  paidCount: number;
  paidAmount: number;
  pendingCount: number;
  errorCount: number;
  attentionCount: number;
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
  crt: '1' | '2' | '3' | '4';
  streetName: string;
  streetNumber: string;
  district: string;
  cityName: string;
  cityCode: string;
  state: string;
  zipCode: string;
  complement: string;
  cscId: string;
  hasCsc: boolean;
  hasCertificatePassword: boolean;
  certificate: {
    configured: boolean;
    managed: boolean;
    fileName: string;
    fingerprint: string;
    subject: string;
    issuer: string;
    serialNumber: string;
    validFrom?: string | null;
    validTo?: string | null;
    uploadedAt?: string | null;
    expired: boolean;
  };
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
