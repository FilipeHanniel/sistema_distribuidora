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
  mustChangePassword?: boolean | number;
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
  onboarding?: OnboardingStatus;
  notes?: string;
  userCount?: number;
  salesCount?: number;
  revenueMonth?: number;
  planDefinition?: PlanDefinition;
  usage?: TenantUsage;
  createdAt: string;
}

export interface OnboardingStep {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  action: 'edit_establishment' | 'manage_users' | 'edit_subscription' | 'manager_setup' | string;
}

export interface OnboardingStatus {
  status: 'needs_attention' | 'ready' | 'operational';
  ready: boolean;
  operational: boolean;
  requiredComplete: number;
  requiredTotal: number;
  completedSteps: number;
  totalSteps: number;
  progress: number;
  managerUsername?: string | null;
  nextStep?: OnboardingStep | null;
  steps: OnboardingStep[];
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

export interface Supplier {
  id: string;
  establishmentId: string;
  name: string;
  legalName?: string | null;
  document?: string | null;
  email?: string | null;
  phone?: string | null;
  contactName?: string | null;
  notes?: string | null;
  active: number;
  purchaseCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseStatus = 'draft' | 'received' | 'cancelled';

export interface PurchaseItem {
  id: string;
  purchaseId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  previousCostPrice?: number | null;
  appliedCostPrice?: number | null;
}

export interface Purchase {
  id: string;
  establishmentId: string;
  supplierId?: string | null;
  supplierName?: string | null;
  invoiceNumber?: string | null;
  status: PurchaseStatus;
  totalAmount: number;
  notes?: string | null;
  itemCount?: number;
  items?: PurchaseItem[];
  createdByUserId?: string | null;
  createdByName?: string | null;
  receivedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StockMovementType =
  | 'initial_balance'
  | 'purchase_receipt'
  | 'purchase_reversal'
  | 'sale'
  | 'manual_adjustment';

export interface StockMovement {
  id: string;
  establishmentId: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  unitCost?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  userId?: string | null;
  createdAt: string;
}

export interface InventoryReportSummary {
  productCount: number;
  inventoryUnits: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  potentialGrossMargin: number;
  outOfStockCount: number;
  lowStockCount: number;
  ruptureRiskCount: number;
  stagnantCount: number;
  salesCount: number;
  revenue: number;
  unitsSold: number;
  averageTicket: number;
  estimatedCost: number;
  grossProfit: number;
  grossMarginPct: number;
}

export interface InventoryReportPeriod {
  days: number;
  start: string;
  end: string;
}

export interface InventoryReportSettings {
  lowStockThreshold: number;
  ruptureRiskDays: number;
  salesWindowDays: number;
}

export interface InventoryReportTrendPoint {
  date: string;
  revenue: number;
  salesCount: number;
  unitsSold: number;
}

export interface InventoryReportCategory {
  category: string;
  productCount: number;
  stockUnits: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  quantitySold: number;
  revenue: number;
  grossProfit: number;
}

export interface InventoryReportProductMargin {
  productId: string;
  name: string;
  category: string;
  quantitySold: number;
  revenue: number;
  estimatedCost: number;
  grossProfit: number;
  grossMarginPct: number;
  currentStock: number;
  currentCostPrice: number;
  currentSellPrice: number;
}

export type RuptureRiskLevel = 'out' | 'critical' | 'attention' | 'monitor';

export interface InventoryReportProductAlert {
  productId: string;
  name: string;
  category: string;
  currentStock: number;
  costPrice: number;
  sellPrice: number;
  inventoryCostValue: number;
  inventoryRetailValue: number;
  soldLastWindow: number;
  revenueLastWindow: number;
  lastSaleAt?: string | null;
}

export interface InventoryReportRuptureRisk extends InventoryReportProductAlert {
  dailyAverage: number;
  daysCover: number;
  riskLevel: RuptureRiskLevel;
  suggestedRestock: number;
}

export interface InventoryReportMovementSummary {
  type: StockMovementType;
  movementCount: number;
  quantityIn: number;
  quantityOut: number;
  netQuantity: number;
  estimatedValue: number;
}

export interface InventoryReport {
  generatedAt: string;
  period: InventoryReportPeriod;
  settings: InventoryReportSettings;
  summary: InventoryReportSummary;
  salesTrend: InventoryReportTrendPoint[];
  categoryBreakdown: InventoryReportCategory[];
  marginByProduct: InventoryReportProductMargin[];
  lowStockProducts: InventoryReportProductAlert[];
  ruptureRisks: InventoryReportRuptureRisk[];
  stagnantProducts: InventoryReportProductAlert[];
  movementSummary: InventoryReportMovementSummary[];
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
