const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const {
  PROVIDERS,
  getPixProvider,
  getPointProvider,
  makeProviderReference,
  normalizePointPaymentSelection,
} = require('./pixProviders');
const { getFiscalProvider } = require('./fiscalProviders');
const { getPaymentTransactionIssue } = require('./paymentReconciliation');
const {
  isManagedCertificatePath,
  removeManagedCertificate,
  storeFiscalCertificate,
} = require('./fiscalCertificateService');
const {
  getFiscalReadiness,
  normalizeCrt,
  onlyDigits: onlyFiscalDigits,
} = require('./fiscalReadiness');
const {
  activatePointTerminal,
  createPointPos,
  createPointStore,
  getMercadoPagoUser,
  listPointTerminals,
} = require('./mercadoPagoPointService');

const app = express();

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
};

loadEnvFile(path.join(__dirname, '..', '.env'));
loadEnvFile(path.join(__dirname, '.env'));

const db = require('./database');
const { addOneMonth } = require('./database');
const {
  checkPlanLimit,
  getPlanCatalogList,
  getPlanDefinition,
  getSubscriptionAccess,
  normalizePlan,
  normalizeSubscriptionStatus,
} = require('./saasPolicy');
const {
  normalizeEstablishmentCode,
  normalizeUsername,
  validatePassword,
  validateUsername,
} = require('./tenantIdentity');
const {
  DEFAULT_TENANT_SETTINGS,
  validateTenantSettings,
} = require('./tenantSettingsPolicy');
const {
  DEFAULT_GRACE_DAYS,
  evaluateSubscription,
  normalizeGraceDays,
} = require('./subscriptionPolicy');
const { buildOnboardingStatus } = require('./onboardingPolicy');

// ==============================
// CONFIGURAÇÃO
// ==============================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET_PLACEHOLDERS = new Set(['', 'pepsi-distribuidora-secret-key-2024', 'troque_por_um_segredo_longo_em_producao']);
const MASTER_PASSWORD_PLACEHOLDERS = new Set(['', 'dev_master', 'troque_ou_remova_em_producao']);
const configuredJwtSecret = String(process.env.JWT_SECRET || '').trim();
if (NODE_ENV === 'production' && JWT_SECRET_PLACEHOLDERS.has(configuredJwtSecret)) {
  throw new Error('JWT_SECRET seguro e obrigatorio em producao.');
}
const JWT_SECRET = configuredJwtSecret || 'pepsi-distribuidora-secret-key-2024';
const configuredMasterPassword = String(process.env.MASTER_PASSWORD || '').trim();
const MASTER_PASSWORD = MASTER_PASSWORD_PLACEHOLDERS.has(configuredMasterPassword)
  ? (NODE_ENV === 'production' ? '' : 'dev_master')
  : configuredMasterPassword;
const configuredPollingInterval = Number(process.env.PAYMENT_POLLING_INTERVAL_MS || 10000);
const PAYMENT_POLLING_INTERVAL_MS = Number.isFinite(configuredPollingInterval)
  ? Math.max(3000, configuredPollingInterval)
  : 10000;
const configuredProcessingTimeout = Number(process.env.PAYMENT_PROCESSING_TIMEOUT_MS || 120000);
const PAYMENT_PROCESSING_TIMEOUT_MS = Number.isFinite(configuredProcessingTimeout)
  ? Math.max(30000, configuredProcessingTimeout)
  : 120000;
const DEFAULT_SUBSCRIPTION_GRACE_DAYS = normalizeGraceDays(
  process.env.SUBSCRIPTION_GRACE_DAYS,
  DEFAULT_GRACE_DAYS
);
const configuredSubscriptionInterval = Number(process.env.SUBSCRIPTION_RECONCILIATION_INTERVAL_MS || 60 * 60 * 1000);
const SUBSCRIPTION_RECONCILIATION_INTERVAL_MS = Number.isFinite(configuredSubscriptionInterval)
  ? Math.max(60 * 1000, configuredSubscriptionInterval)
  : 60 * 60 * 1000;
const SUBSCRIPTION_REMINDER_DAYS = [...new Set(
  String(process.env.SUBSCRIPTION_REMINDER_DAYS || '3,1,0')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(value => Number.isInteger(value) && value >= 0 && value <= 30)
)];
const SESSION_GENERATION_ID = crypto.randomUUID();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : true;

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb' }));

if (NODE_ENV === 'production') {
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
}

// ==============================
// GEMINI AI
// ==============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
let genAI = null;
let geminiModel = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: GEMINI_MODEL });
  console.log(`✅ Gemini AI configurado com sucesso! Modelo: ${GEMINI_MODEL}`);
} else {
  console.warn('⚠️ Gemini AI não configurado. Defina GEMINI_API_KEY no ambiente.');
}

// ==============================
// RATE LIMITING NO LOGIN (anti-brute-force)
// ==============================
const loginAttempts = new Map(); // ip → { count, windowStart }
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT_MAX) return true;
  entry.count++;
  return false;
}
function clearRateLimit(ip) { loginAttempts.delete(ip); }

// Limpar entradas expiradas a cada 10 minutos
const loginRateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);
loginRateLimitCleanupTimer.unref();

// ==============================
// MIDDLEWARES DE AUTENTICAÇÃO
// ==============================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(401).json({ error: 'Token inválido ou expirado.' });
    if (user.sessionGenerationId !== SESSION_GENERATION_ID) {
      return res.status(401).json({ error: 'O sistema foi atualizado. Entre novamente para continuar.' });
    }
    const currentUser = db.prepare('SELECT active, isDeleted, authVersion FROM users WHERE id = ?').get(user.id);
    if (!currentUser || currentUser.active === 0 || currentUser.isDeleted === 1) {
      return res.status(401).json({ error: 'Sessao encerrada. Entre novamente para continuar.' });
    }
    if (Number(user.authVersion || 0) !== Number(currentUser.authVersion || 0)) {
      return res.status(401).json({ error: 'A senha foi redefinida. Entre novamente para continuar.' });
    }
    req.user = user;
    next();
  });
};

const isSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Acesso restrito ao Super Administrador.' });
  }
  next();
};

const isGestorOrAbove = (req, res, next) => {
  if (!['gestor', 'superadmin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Acesso restrito ao Gestor ou superior.' });
  }
  next();
};

const isGestor = (req, res, next) => {
  if (req.user.role !== 'gestor') {
    return res.status(403).json({ error: 'Acesso restrito ao Gestor do estabelecimento.' });
  }
  next();
};

const isTenantUser = (req, res, next) => {
  if (req.user.role === 'superadmin') {
    return res.status(403).json({ error: 'Super Admin não opera dados de venda ou estoque diretamente.' });
  }
  if (!req.user.establishmentId) {
    return res.status(403).json({ error: 'Usuário sem estabelecimento vinculado.' });
  }
  next();
};

// Helper: filtro WHERE por estabelecimento
const estFilterWhere = (req) => {
  if (req.user.role === 'superadmin') return { clause: 'WHERE 1=1', params: [] };
  return { clause: 'WHERE establishmentId = ?', params: [req.user.establishmentId] };
};

const getTenantId = (req) => {
  if (req.user.role === 'superadmin') return req.body.establishmentId || req.query.establishmentId || null;
  return req.user.establishmentId;
};

const ensureEstablishmentExists = (establishmentId) => {
  if (!establishmentId) return null;
  return db.prepare('SELECT * FROM establishments WHERE id = ?').get(establishmentId);
};

const getSubscriptionBilling = (establishment, now = new Date()) => ({
  dueDate: establishment.subscriptionDueDate || null,
  ...evaluateSubscription({
    dueDate: establishment.subscriptionDueDate,
    currentStatus: establishment.subscriptionStatus,
    statusReason: establishment.subscriptionStatusReason,
    graceDays: establishment.subscriptionGraceDays ?? DEFAULT_SUBSCRIPTION_GRACE_DAYS,
    now,
  }),
});

const canAccessTenantRecord = (req, table, id) => {
  if (req.user.role === 'superadmin') return db.prepare(`SELECT id, establishmentId FROM ${table} WHERE id = ?`).get(id);
  return db.prepare(`SELECT id, establishmentId FROM ${table} WHERE id = ? AND establishmentId = ?`).get(id, req.user.establishmentId);
};

const getTenantUsage = (establishmentId) => ({
  users: db.prepare("SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role != 'superadmin' AND isDeleted = 0")
    .get(establishmentId).c,
  operators: db.prepare("SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role = 'operador' AND isDeleted = 0")
    .get(establishmentId).c,
  products: db.prepare('SELECT COUNT(*) as c FROM products WHERE establishmentId = ?')
    .get(establishmentId).c,
  paymentAccounts: db.prepare('SELECT COUNT(*) as c FROM pix_accounts WHERE establishmentId = ? AND active = 1')
    .get(establishmentId).c,
});

const getEstablishmentOnboarding = (establishment) => {
  const manager = db.prepare(`
    SELECT username
    FROM users
    WHERE establishmentId = ? AND role = 'gestor' AND active = 1 AND isDeleted = 0
    ORDER BY createdAt ASC
    LIMIT 1
  `).get(establishment.id);
  const activeManagers = manager ? 1 : 0;
  const settingsConfigured = Boolean(
    db.prepare('SELECT 1 FROM tenant_settings WHERE establishmentId = ?').get(establishment.id)
  );
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE establishmentId = ?')
    .get(establishment.id).count;
  const paymentAccountCount = db.prepare('SELECT COUNT(*) as count FROM pix_accounts WHERE establishmentId = ? AND active = 1')
    .get(establishment.id).count;
  const fiscalModeDefined = Boolean(
    db.prepare('SELECT 1 FROM fiscal_settings WHERE establishmentId = ?').get(establishment.id)
  );

  return buildOnboardingStatus({
    establishment,
    activeManagers,
    managerUsername: manager?.username || null,
    settingsConfigured,
    productCount,
    paymentAccountCount,
    fiscalModeDefined,
  });
};

const getTenantSettings = (establishmentId) => {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO tenant_settings (
      establishmentId, lowStockThreshold, receiptAutoCloseSeconds, receiptFooter, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    establishmentId,
    DEFAULT_TENANT_SETTINGS.lowStockThreshold,
    DEFAULT_TENANT_SETTINGS.receiptAutoCloseSeconds,
    DEFAULT_TENANT_SETTINGS.receiptFooter,
    now,
    now
  );
  return db.prepare(`
    SELECT e.id as establishmentId, e.name, e.loginCode, e.ownerName, e.email, e.phone,
      ts.lowStockThreshold, ts.receiptAutoCloseSeconds, ts.receiptFooter, ts.updatedAt
    FROM establishments e
    INNER JOIN tenant_settings ts ON ts.establishmentId = e.id
    WHERE e.id = ?
  `).get(establishmentId);
};

const buildTenantStatus = (establishmentId) => {
  const establishment = ensureEstablishmentExists(establishmentId);
  if (!establishment) return null;
  const plan = getPlanDefinition(establishment.plan);
  const billing = getSubscriptionBilling(establishment);
  const subscription = getSubscriptionAccess(billing.status);
  return {
    establishment: {
      id: establishment.id,
      name: establishment.name,
      plan: plan.key,
      subscriptionStatus: billing.status,
      subscriptionDueDate: establishment.subscriptionDueDate,
      subscriptionGraceDays: billing.graceDays,
      subscriptionStatusReason: billing.reason || null,
    },
    plan,
    usage: getTenantUsage(establishmentId),
    subscription,
    billing,
  };
};

const requireOperationalSubscription = (req, res, next) => {
  if (req.user.role === 'superadmin') return next();
  const tenantStatus = buildTenantStatus(req.user.establishmentId);
  if (!tenantStatus) return res.status(403).json({ error: 'Estabelecimento nao encontrado.' });
  if (!tenantStatus.subscription.canOperate) {
    return res.status(402).json({
      error: tenantStatus.subscription.message,
      code: 'subscription_suspended',
      subscriptionStatus: tenantStatus.establishment.subscriptionStatus,
    });
  }
  return next();
};

const enforcePlanLimit = (establishmentId, resource, currentCount, increment = 1) => {
  const establishment = ensureEstablishmentExists(establishmentId);
  if (!establishment) {
    const err = new Error('Estabelecimento obrigatorio ou invalido.');
    err.statusCode = 400;
    throw err;
  }
  const check = checkPlanLimit(establishment.plan, resource, currentCount, increment);
  if (!check.allowed) {
    const err = new Error(`Limite do plano ${getPlanDefinition(establishment.plan).label} atingido.`);
    err.statusCode = 403;
    err.planLimit = {
      plan: normalizePlan(establishment.plan),
      resource,
      limit: check.limit,
      currentCount: check.currentCount,
      nextCount: check.nextCount,
    };
    throw err;
  }
  return check;
};

const sendPlanLimitError = (res, err) => res.status(err.statusCode || 403).json({
  error: err.message,
  code: 'plan_limit_reached',
  planLimit: err.planLimit,
});

const logAudit = ({ req, establishmentId, action, entityType, entityId, metadata = {} }) => {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, establishmentId, actorUserId, actorRole, action, entityType, entityId, metadata, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      establishmentId || null,
      req.user?.id || null,
      req.user?.role || null,
      action,
      entityType || null,
      entityId || null,
      JSON.stringify(metadata),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('[Audit Log Error]', err.message);
  }
};

const credentialKey = crypto.createHash('sha256').update(JWT_SECRET).digest();
const encodeCredentials = (credentials = {}) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
};
const decodeCredentials = (encoded) => {
  if (!encoded) return {};
  try {
    if (encoded.startsWith('v1:')) {
      const [, iv, tag, encrypted] = encoded.split(':');
      const decipher = crypto.createDecipheriv('aes-256-gcm', credentialKey, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    }
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
};

const decodeSecretValue = (encoded) => {
  const decoded = decodeCredentials(encoded);
  return decoded?.value || '';
};

const sanitizePixAccount = (account) => {
  if (!account) return account;
  const credentials = decodeCredentials(account.credentials);
  return {
    id: account.id,
    establishmentId: account.establishmentId,
    name: account.name,
    provider: account.provider,
    pixKey: account.pixKey,
    supportsPix: credentials.supportsPix !== false,
    supportsPoint: Boolean(credentials.supportsPoint),
    mpEnvironment: credentials.mpEnvironment || 'test',
    payerEmail: credentials.payerEmail || '',
    statementDescriptor: credentials.statementDescriptor || '',
    payerFirstName: credentials.payerFirstName || '',
    payerLastName: credentials.payerLastName || '',
    payerIdentificationType: credentials.payerIdentificationType || '',
    payerIdentificationNumber: credentials.payerIdentificationNumber || '',
    payerPhoneAreaCode: credentials.payerPhoneAreaCode || '',
    payerPhoneNumber: credentials.payerPhoneNumber || '',
    payerZipCode: credentials.payerZipCode || '',
    payerStreetName: credentials.payerStreetName || '',
    payerStreetNumber: credentials.payerStreetNumber || '',
    payerCity: credentials.payerCity || '',
    payerState: credentials.payerState || '',
    payerNeighborhood: credentials.payerNeighborhood || '',
    payerComplement: credentials.payerComplement || '',
    terminalId: credentials.terminalId || '',
    storeId: credentials.storeId || '',
    posId: credentials.posId || '',
    mpUserId: credentials.mpUserId || '',
    storeExternalId: credentials.storeExternalId || '',
    posExternalId: credentials.posExternalId || '',
    defaultType: credentials.defaultType || 'credit_card',
    defaultInstallments: Number(credentials.defaultInstallments || 1),
    active: account.active,
    isDefault: account.isDefault,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
};

const sanitizePaymentTransaction = (transaction) => {
  if (!transaction) return null;
  let payload = {};
  try { payload = JSON.parse(transaction.payload || '{}'); } catch {}
  const providerPayload = payload.latestProviderPayload || payload.providerPayload || {};
  const payment = providerPayload.transactions?.payments?.[0] || {};
  const source = payload.confirmationSource || (['fake', 'mercado_pago_fake'].includes(transaction.provider) ? 'simulated' : 'polling');
  return {
    id: transaction.id,
    provider: transaction.provider,
    providerTransactionId: transaction.providerTransactionId,
    providerPaymentId: payload.providerPaymentId || payment.id || null,
    status: transaction.status,
    paymentMethod: transaction.paymentMethod,
    amount: transaction.amount,
    paidAt: transaction.paidAt,
    createdAt: transaction.createdAt,
    environment: providerPayload.api_response?.status ? 'mercado_pago' : undefined,
    providerStatus: providerPayload.status || payment.status || null,
    providerStatusDetail: providerPayload.status_detail || payment.status_detail || null,
    confirmationSource: source,
  };
};

const savePixAccountCredentials = (account, updates) => {
  const credentials = {
    ...decodeCredentials(account.credentials),
    ...updates,
  };
  const now = new Date().toISOString();
  db.prepare('UPDATE pix_accounts SET credentials = ?, updatedAt = ? WHERE id = ? AND establishmentId = ?')
    .run(encodeCredentials(credentials), now, account.id, account.establishmentId);
  return db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?')
    .get(account.id, account.establishmentId);
};

const getMercadoPagoPointAccount = (accountId, establishmentId) => {
  const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?')
    .get(accountId, establishmentId);
  if (!account) {
    const error = new Error('Conta de recebimento nao encontrada.');
    error.statusCode = 404;
    throw error;
  }
  if (account.provider !== 'mercado_pago') {
    const error = new Error('A configuracao Point esta disponivel apenas para contas Mercado Pago.');
    error.statusCode = 400;
    throw error;
  }
  const credentials = decodeCredentials(account.credentials);
  if (!credentials.supportsPoint) {
    const error = new Error('Habilite terminal/cartao nesta conta antes de configurar o Point.');
    error.statusCode = 400;
    throw error;
  }
  if (!String(credentials.accessToken || '').trim()) {
    const error = new Error('Access Token do Mercado Pago nao configurado.');
    error.statusCode = 400;
    throw error;
  }
  return { account, credentials };
};

const getPointSetupErrorStatus = (error) => {
  if (error.statusCode) return error.statusCode;
  if (error.providerStatus >= 400 && error.providerStatus < 500) return 400;
  if (error.providerStatus) return 502;
  return 500;
};

const sanitizePaymentTransactionForPanel = (transaction) => {
  if (!transaction) return null;
  const payload = parseTransactionPayload(transaction);
  const providerPayload = payload.latestProviderPayload || payload.providerPayload || {};
  const payment = providerPayload.transactions?.payments?.[0] || {};
  const source = payload.confirmationSource || (['fake', 'mercado_pago_fake'].includes(transaction.provider) ? 'simulated' : null);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return {
    id: transaction.id,
    provider: transaction.provider,
    providerTransactionId: transaction.providerTransactionId,
    providerPaymentId: payload.providerPaymentId || payment.id || null,
    externalReference: payload.externalReference || providerPayload.external_reference || null,
    accountName: transaction.accountName || null,
    status: transaction.status,
    paymentMethod: transaction.paymentMethod,
    amount: transaction.amount,
    saleId: transaction.saleId,
    fiscalStatus: transaction.fiscalStatus || null,
    error: transaction.error || null,
    issue: getPaymentTransactionIssue(transaction),
    confirmationSource: source,
    providerStatus: providerPayload.status || payment.status || null,
    providerStatusDetail: providerPayload.status_detail || payment.status_detail || null,
    itemCount: items.reduce((total, item) => total + Number(item.quantity || 0), 0),
    paidAt: transaction.paidAt,
    expiresAt: transaction.expiresAt,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
};

const getPaymentTransactionForSale = (saleId, estId) => {
  const transaction = db.prepare(`
    SELECT *
    FROM payment_transactions
    WHERE saleId = ? AND establishmentId = ?
    ORDER BY updatedAt DESC, createdAt DESC
    LIMIT 1
  `).get(saleId, estId);
  return sanitizePaymentTransaction(transaction);
};

const parseTransactionPayload = (transaction) => {
  try { return JSON.parse(transaction?.payload || '{}'); } catch { return {}; }
};

const finalizePaidTransaction = async ({ transactionId, userId = null }) => {
  const linkExistingSale = () => {
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transactionId);
    if (!transaction || transaction.saleId) return transaction;

    const existingSale = db.prepare('SELECT id FROM sales WHERE id = ? AND establishmentId = ?')
      .get(transactionId, transaction.establishmentId);
    if (!existingSale) return transaction;

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE payment_transactions
      SET saleId = ?, status = 'paid', paidAt = COALESCE(paidAt, ?), updatedAt = ?
      WHERE id = ? AND saleId IS NULL
    `).run(existingSale.id, now, now, transactionId);
    return db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transactionId);
  };

  let current = linkExistingSale();
  if (!current || current.saleId) return current;

  if (current.status === 'processing') {
    const processingStartedAt = new Date(current.updatedAt || current.createdAt || 0).getTime();
    const processingExpired = !Number.isFinite(processingStartedAt)
      || Date.now() - processingStartedAt >= PAYMENT_PROCESSING_TIMEOUT_MS;
    if (!processingExpired) return current;

    db.prepare(`
      UPDATE payment_transactions
      SET status = 'paid', updatedAt = ?
      WHERE id = ? AND saleId IS NULL AND status = 'processing'
    `).run(new Date().toISOString(), transactionId);
  }

  const claim = db.prepare(`
    UPDATE payment_transactions
    SET status = 'processing', updatedAt = ?
    WHERE id = ? AND saleId IS NULL AND status = 'paid'
  `).run(new Date().toISOString(), transactionId);

  if (claim.changes === 0) {
    return db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transactionId);
  }

  try {
    current = linkExistingSale();
    if (current?.saleId) return current;

    const fresh = current;
    const stored = parseTransactionPayload(fresh);
    const preparedSale = validateSaleItemsForTenant(stored.items || [], fresh.establishmentId, {
      expectedTotal: fresh.amount,
      useCurrentPrices: false,
    });
    const storedItems = preparedSale.items;
    const operator = userId || db.prepare(`
      SELECT id FROM users
      WHERE establishmentId = ? AND role IN ('gestor', 'operador') AND active = 1 AND isDeleted = 0
      ORDER BY role = 'gestor' DESC, createdAt ASC
      LIMIT 1
    `).get(fresh.establishmentId)?.id || null;
    const paymentMethod = ['pix', 'card'].includes(fresh.paymentMethod) ? fresh.paymentMethod : 'pix';
    const saleResult = await createPaidSale(storedItems, fresh.amount, paymentMethod, operator, fresh.establishmentId, fresh.id);
    db.prepare(`
      UPDATE payment_transactions
      SET saleId = ?, status = 'paid', paidAt = COALESCE(paidAt, ?), updatedAt = ?
      WHERE id = ?
    `).run(saleResult.saleId, new Date().toISOString(), new Date().toISOString(), transactionId);
    return db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transactionId);
  } catch (err) {
    const recovered = linkExistingSale();
    if (recovered?.saleId) return recovered;

    db.prepare(`UPDATE payment_transactions SET status = 'paid', updatedAt = ? WHERE id = ? AND status = 'processing'`)
      .run(new Date().toISOString(), transactionId);
    throw err;
  }
};

const refreshPixTransactionFromProvider = async ({ transaction, userId = null }) => {
  const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(transaction.pixAccountId, transaction.establishmentId);
  if (!account) throw new Error('Conta Pix da transacao nao encontrada.');

  const statusResult = await getPixProvider(account.provider).getStatus({
    transaction,
    credentials: decodeCredentials(account.credentials),
  });
  const currentPayload = parseTransactionPayload(transaction);
  const nextPayload = {
    ...currentPayload,
    providerPaymentId: statusResult.providerPaymentId || currentPayload.providerPaymentId || null,
    externalReference: statusResult.externalReference || currentPayload.externalReference || null,
    latestProviderPayload: statusResult.payload || null,
    confirmationSource: statusResult.status === 'paid' ? 'polling' : currentPayload.confirmationSource,
  };
  const status = statusResult.status;
  const paidAt = statusResult.paidAt || transaction.paidAt || null;
  db.prepare(`
    UPDATE payment_transactions
    SET status = ?, paidAt = ?, updatedAt = ?, payload = ?, error = NULL
    WHERE id = ? AND saleId IS NULL AND status = 'pending'
  `).run(status, paidAt, new Date().toISOString(), JSON.stringify(nextPayload), transaction.id);

  let latest = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id);
  let saleId = latest.saleId;
  let fiscalDocument = null;
  if (latest.status === 'paid' && !saleId) {
    const finalized = await finalizePaidTransaction({ transactionId: transaction.id, userId });
    latest = finalized;
    saleId = finalized.saleId || null;
    if (saleId) {
      fiscalDocument = db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
        .get(saleId, transaction.establishmentId) || null;
    }
  } else if (saleId) {
    fiscalDocument = db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(saleId, transaction.establishmentId) || null;
  }

  return {
    transaction: latest,
    status: latest.status,
    paidAt: latest.paidAt,
    saleId,
    fiscalDocument,
    payload: parseTransactionPayload(latest),
  };
};

const refreshCardTransactionFromProvider = async ({ transaction, userId = null }) => {
  const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?')
    .get(transaction.pixAccountId, transaction.establishmentId);
  if (!account) throw new Error('Conta da transacao nao encontrada.');

  const statusResult = await getPointProvider(account.provider).getStatus({
    transaction,
    credentials: decodeCredentials(account.credentials),
  });
  const currentPayload = parseTransactionPayload(transaction);
  const nextPayload = {
    ...currentPayload,
    providerPaymentId: statusResult.providerPaymentId || currentPayload.providerPaymentId || null,
    externalReference: statusResult.externalReference || currentPayload.externalReference || null,
    latestProviderPayload: statusResult.payload || null,
    confirmationSource: statusResult.status === 'paid' ? 'polling' : currentPayload.confirmationSource,
  };
  db.prepare(`
    UPDATE payment_transactions
    SET status = ?, paidAt = ?, updatedAt = ?, payload = ?, error = NULL
    WHERE id = ? AND saleId IS NULL AND status = 'pending'
  `).run(
    statusResult.status,
    statusResult.paidAt || transaction.paidAt || null,
    new Date().toISOString(),
    JSON.stringify(nextPayload),
    transaction.id
  );

  let latest = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id);
  if (['paid', 'processing'].includes(latest.status) && !latest.saleId) {
    latest = await finalizePaidTransaction({ transactionId: latest.id, userId });
  }
  return latest;
};

const buildCardTransactionResponse = (transaction, estId) => {
  const payload = parseTransactionPayload(transaction);
  const providerPayload = payload.latestProviderPayload || payload.providerPayload || {};
  const payment = providerPayload.transactions?.payments?.[0] || {};
  const paymentMethod = payment.payment_method || {};
  const account = db.prepare('SELECT provider, credentials FROM pix_accounts WHERE id = ? AND establishmentId = ?')
    .get(transaction.pixAccountId, estId);
  const credentials = decodeCredentials(account?.credentials);
  const fiscalDocument = transaction.saleId
    ? db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(transaction.saleId, estId) || null
    : null;

  return {
    id: transaction.id,
    status: transaction.status === 'processing' ? 'pending' : transaction.status,
    saleId: transaction.saleId,
    fiscalDocument,
    paidAt: transaction.paidAt,
    amount: transaction.amount,
    provider: transaction.provider,
    providerTransactionId: transaction.providerTransactionId,
    providerPaymentId: payload.providerPaymentId || payment.id || null,
    externalReference: payload.externalReference || providerPayload.external_reference || null,
    providerStatus: providerPayload.status || payment.status || null,
    providerStatusDetail: providerPayload.status_detail || payment.status_detail || null,
    terminalId: credentials.terminalId || '',
    paymentType: payload.paymentType || paymentMethod.type || credentials.defaultType || 'credit_card',
    installments: Number(payload.installments || paymentMethod.installments || credentials.defaultInstallments || 1),
    isTest: transaction.provider === 'mercado_pago' && credentials.mpEnvironment !== 'production',
    expiresAt: transaction.expiresAt,
    paymentConfirmation: transaction.saleId ? getPaymentTransactionForSale(transaction.saleId, estId) : null,
  };
};

const sanitizeFiscalSettings = (settings) => {
  if (!settings) return null;
  const certificateConfigured = Boolean(settings.certificatePath && settings.certificatePassword);
  const certificateValidTo = settings.certificateValidTo || null;
  return {
    establishmentId: settings.establishmentId,
    enabled: Number(settings.enabled || 0),
    providerMode: settings.providerMode || 'simulated',
    environment: settings.environment,
    documentModel: settings.documentModel,
    serie: settings.serie,
    nextNumber: Number(settings.nextNumber || 1),
    cnpj: settings.cnpj || '',
    stateRegistration: settings.stateRegistration || '',
    legalName: settings.legalName || '',
    tradeName: settings.tradeName || '',
    taxRegime: settings.taxRegime || 'simples',
    crt: normalizeCrt(settings.taxRegime || 'simples', settings.crt),
    streetName: settings.streetName || '',
    streetNumber: settings.streetNumber || '',
    district: settings.district || '',
    cityName: settings.cityName || '',
    cityCode: settings.cityCode || '',
    state: settings.state || 'GO',
    zipCode: settings.zipCode || '',
    complement: settings.complement || '',
    cscId: settings.cscId || '',
    hasCsc: Boolean(settings.csc),
    hasCertificatePassword: Boolean(settings.certificatePassword),
    certificate: {
      configured: certificateConfigured,
      managed: isManagedCertificatePath(settings.certificatePath),
      fileName: settings.certificateFileName || (certificateConfigured ? 'Certificado legado configurado' : ''),
      fingerprint: settings.certificateFingerprint || '',
      subject: settings.certificateSubject || '',
      issuer: settings.certificateIssuer || '',
      serialNumber: settings.certificateSerialNumber || '',
      validFrom: settings.certificateValidFrom || null,
      validTo: certificateValidTo,
      uploadedAt: settings.certificateUploadedAt || null,
      expired: Boolean(certificateValidTo && new Date(certificateValidTo) <= new Date()),
    },
    autoIssueOnPayment: Number(settings.autoIssueOnPayment || 0),
    autoPrintOnAuthorization: Number(settings.autoPrintOnAuthorization || 0),
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
};

const ensureFiscalSettings = (estId) => {
  let settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
  if (settings) return settings;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO fiscal_settings (
      establishmentId, enabled, providerMode, environment, documentModel, serie, nextNumber,
      taxRegime, crt, cityName, cityCode, state, autoIssueOnPayment, autoPrintOnAuthorization, createdAt, updatedAt
    ) VALUES (?, 0, 'simulated', 'homologation', '65', '1', 1, 'simples', '1', 'Goiania', '5208707', 'GO', 0, 0, ?, ?)
  `).run(estId, now, now);
  return db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
};

const upsertFiscalDocumentForSale = (saleId, estId, options = {}) => {
  const existing = db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
    .get(saleId, estId);
  if (existing) return existing;

  const settings = ensureFiscalSettings(estId);
  const readiness = getFiscalReadiness(settings);
  const now = new Date().toISOString();
  const id = uuidv4();
  const shouldQueue = options.force || (settings.enabled && settings.autoIssueOnPayment);
  const status = readiness.ready && shouldQueue ? 'pending_authorization' : 'pending_configuration';
  const error = readiness.ready
    ? 'Motor fiscal aguardando implementacao de assinatura XML e webservice SEFAZ.'
    : `Configuracao fiscal incompleta: ${readiness.missing.join(', ')}.`;
  const number = readiness.ready && shouldQueue ? settings.nextNumber : null;

  db.prepare(`
    INSERT INTO fiscal_documents (
      id, establishmentId, saleId, model, serie, number, environment, status,
      error, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    estId,
    saleId,
    settings.documentModel || '65',
    settings.serie || '1',
    number,
    settings.environment || 'homologation',
    status,
    error,
    now,
    now
  );

  if (number) {
    db.prepare('UPDATE fiscal_settings SET nextNumber = nextNumber + 1, updatedAt = ? WHERE establishmentId = ?')
      .run(now, estId);
  }

  db.prepare('UPDATE sales SET fiscalStatus = ? WHERE id = ? AND establishmentId = ?')
    .run(status, saleId, estId);

  return db.prepare('SELECT * FROM fiscal_documents WHERE id = ?').get(id);
};

const issueFiscalDocument = async (documentId, estId) => {
  let document = db.prepare('SELECT * FROM fiscal_documents WHERE id = ? AND establishmentId = ?').get(documentId, estId);
  if (!document) throw new Error('Documento fiscal nao encontrado.');
  if (document.status === 'authorized') return document;

  const settings = ensureFiscalSettings(estId);
  if (!document.number) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fiscal_documents
      SET number = ?, serie = ?, environment = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ?
    `).run(settings.nextNumber || 1, settings.serie || '1', settings.environment || 'homologation', now, documentId, estId);
    db.prepare('UPDATE fiscal_settings SET nextNumber = nextNumber + 1, updatedAt = ? WHERE establishmentId = ?')
      .run(now, estId);
    document = db.prepare('SELECT * FROM fiscal_documents WHERE id = ? AND establishmentId = ?').get(documentId, estId);
  }
  const provider = getFiscalProvider(settings.providerMode || 'simulated');
  if (!provider) {
    db.prepare(`
      UPDATE fiscal_documents
      SET status = 'pending_authorization', error = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ?
    `).run('Provider SEFAZ GO real ainda nao implementado. Use o modo simulado para testes internos.', new Date().toISOString(), documentId, estId);
    return db.prepare('SELECT * FROM fiscal_documents WHERE id = ?').get(documentId);
  }

  const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND establishmentId = ?').get(document.saleId, estId);
  if (!sale) throw new Error('Venda do documento fiscal nao encontrada.');
  const items = db.prepare(`
    SELECT si.*, p.barcode, p.ncm, p.cfop, p.csosn, p.cst, p.fiscalUnit, p.origin, p.taxRate
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.productId AND p.establishmentId = ?
    WHERE si.saleId = ?
  `).all(estId, sale.id);

  const result = await provider.authorize({
    settings: {
      ...settings,
      csc: decodeSecretValue(settings.csc),
      certificatePassword: decodeSecretValue(settings.certificatePassword),
    },
    document,
    sale,
    items,
  });
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE fiscal_documents
    SET status = ?, cStat = ?, accessKey = ?, protocol = ?, qrCodeUrl = ?, xml = ?,
        validationMessages = ?, error = ?, authorizedAt = ?, updatedAt = ?
    WHERE id = ? AND establishmentId = ?
  `).run(
    result.status,
    result.cStat || null,
    result.accessKey || null,
    result.protocol || null,
    result.qrCodeUrl || null,
    result.xml || null,
    JSON.stringify(result.validationMessages || []),
    result.reason || null,
    result.status === 'authorized' ? now : null,
    now,
    documentId,
    estId
  );
  db.prepare('UPDATE sales SET fiscalStatus = ? WHERE id = ? AND establishmentId = ?')
    .run(result.status, sale.id, estId);
  return db.prepare('SELECT * FROM fiscal_documents WHERE id = ?').get(documentId);
};

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const saleValidationError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const validateSaleItemsForTenant = (items, estId, { expectedTotal = null, useCurrentPrices = false } = {}) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw saleValidationError('Itens da venda sao obrigatorios.');
  }
  if (expectedTotal !== null && (!Number.isFinite(Number(expectedTotal)) || Number(expectedTotal) < 0)) {
    throw saleValidationError('Valor total da venda invalido.');
  }

  const normalizedItems = items.map((item) => {
    const product = db.prepare('SELECT id, name, sellPrice, stock, category FROM products WHERE id = ? AND establishmentId = ?')
      .get(item.productId, estId);
    if (!product) throw saleValidationError(`Produto '${item.name}' nao pertence a este estabelecimento.`);

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw saleValidationError(`Quantidade invalida para '${product.name}'.`);
    }
    if (product.stock < quantity) {
      throw saleValidationError(`Estoque insuficiente para '${product.name}'.`, 409);
    }

    const unitPrice = Number(useCurrentPrices ? product.sellPrice : item.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw saleValidationError(`Preco invalido para '${product.name}'.`);
    }

    return {
      ...item,
      productId: product.id,
      name: product.name,
      category: product.category || item.category || 'Geral',
      quantity,
      unitPrice: roundMoney(unitPrice),
      totalPrice: roundMoney(unitPrice * quantity),
    };
  });

  const totalAmount = roundMoney(normalizedItems.reduce((sum, item) => sum + item.totalPrice, 0));
  if (expectedTotal !== null && Math.abs(totalAmount - roundMoney(expectedTotal)) > 0.009) {
    throw saleValidationError('O valor da venda mudou. Atualize o carrinho e tente novamente.', 409);
  }

  return { items: normalizedItems, totalAmount };
};

const createPaidSale = async (items, totalAmount, paymentMethod, userId, estId, saleId = uuidv4()) => {
  const now = new Date().toISOString();
  const insertSale = db.transaction(() => {
    db.prepare('INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, establishmentId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(saleId, totalAmount, paymentMethod, 'PENDENTE', userId, estId, now);
    const insertItemStmt = db.prepare(`INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice) VALUES (?, ?, ?, ?, ?, ?)`);
    const updateStockStmt = db.prepare(`
      UPDATE products
      SET stock = stock - ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ? AND stock >= ?
    `);
    for (const item of items) {
      const stockUpdate = updateStockStmt.run(item.quantity, now, item.productId, estId, item.quantity);
      if (stockUpdate.changes !== 1) {
        throw saleValidationError(`Estoque insuficiente para '${item.name}'.`, 409);
      }
      insertItemStmt.run(saleId, item.productId, item.name, item.quantity, item.unitPrice, item.totalPrice);
    }
  });
  insertSale();
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, establishmentId, actorUserId, actorRole, action, entityType, entityId, metadata, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      estId,
      userId,
      null,
      'sale.created',
      'sale',
      saleId,
      JSON.stringify({ paymentMethod, totalAmount, itemCount: items.length }),
      now
    );
  } catch (err) {
    console.error('[Audit Log Error]', err.message);
  }
  let fiscalDocument = null;
  const settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
  if (settings?.enabled && settings?.autoIssueOnPayment) {
    const document = upsertFiscalDocumentForSale(saleId, estId);
    if (['simulated', 'sefaz_go'].includes(settings.providerMode || 'simulated')) {
      try {
        fiscalDocument = await issueFiscalDocument(document.id, estId);
      } catch (err) {
        const failedAt = new Date().toISOString();
        db.prepare(`
          UPDATE fiscal_documents
          SET status = 'rejected', error = ?, updatedAt = ?
          WHERE id = ? AND establishmentId = ?
        `).run(err.message, failedAt, document.id, estId);
        db.prepare('UPDATE sales SET fiscalStatus = ? WHERE id = ? AND establishmentId = ?')
          .run('rejected', saleId, estId);
        fiscalDocument = db.prepare('SELECT * FROM fiscal_documents WHERE id = ?').get(document.id);
        console.error('[Fiscal Issue Error]', err.message);
      }
    } else {
      fiscalDocument = document;
    }
  }
  return { saleId, fiscalDocument };
};

const startOfLocalDay = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date, days) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const getReportWindow = (periodType) => {
  const today = startOfLocalDay();
  if (periodType === 'weekly') {
    const currentMonday = addDays(today, -((today.getDay() + 6) % 7));
    const previousMonday = addDays(currentMonday, -7);
    return { start: previousMonday, end: currentMonday };
  }
  const yesterday = addDays(today, -1);
  return { start: yesterday, end: today };
};

const collectAiReportMetrics = (estId, startIso, endIso) => {
  const sales = db.prepare(`
    SELECT id, totalAmount, paymentMethod, createdAt
    FROM sales
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ?
    ORDER BY createdAt ASC
  `).all(estId, startIso, endIso);

  const topProducts = db.prepare(`
    SELECT si.name, SUM(si.quantity) as quantity, COALESCE(SUM(si.totalPrice), 0) as revenue
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.establishmentId = ? AND s.createdAt >= ? AND s.createdAt < ?
    GROUP BY si.productId, si.name
    ORDER BY quantity DESC, revenue DESC
    LIMIT 8
  `).all(estId, startIso, endIso);

  const lowStockStart = new Date(new Date(endIso).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const lowStock = db.prepare(`
    SELECT p.name, p.stock, p.category, COALESCE(SUM(si.quantity), 0) as soldLast90d
    FROM products p
    INNER JOIN sale_items si ON si.productId = p.id
    INNER JOIN sales s ON s.id = si.saleId AND s.establishmentId = p.establishmentId
    WHERE p.establishmentId = ?
      AND p.stock <= 5
      AND s.createdAt >= ?
      AND s.createdAt < ?
    GROUP BY p.id, p.name, p.stock, p.category
    HAVING soldLast90d > 0
    ORDER BY p.stock ASC, soldLast90d DESC, p.name ASC
    LIMIT 10
  `).all(estId, lowStockStart, endIso);

  const paymentMethods = db.prepare(`
    SELECT paymentMethod, COUNT(*) as count, COALESCE(SUM(totalAmount), 0) as revenue
    FROM sales
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ?
    GROUP BY paymentMethod
    ORDER BY revenue DESC
  `).all(estId, startIso, endIso);

  const previousStart = new Date(new Date(startIso).getTime() - (new Date(endIso).getTime() - new Date(startIso).getTime())).toISOString();
  const previous = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(totalAmount), 0) as revenue
    FROM sales
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ?
  `).get(estId, previousStart, startIso);

  const totalRevenue = sales.reduce((sum, sale) => sum + Number(sale.totalAmount || 0), 0);
  const averageTicket = sales.length > 0 ? totalRevenue / sales.length : 0;

  return {
    salesCount: sales.length,
    totalRevenue,
    averageTicket,
    previousRevenue: previous.revenue || 0,
    previousSalesCount: previous.count || 0,
    paymentMethods,
    topProducts,
    lowStock,
  };
};

const buildAiReportPrompt = ({ periodType, metrics, startIso, endIso, establishmentName }) => `
Voce e um consultor de gestao para um pequeno comercio/distribuidora.
Crie um relatorio ${periodType === 'weekly' ? 'semanal' : 'diario'} em portugues do Brasil, objetivo, pratico e orientado a decisao.

Estabelecimento: ${establishmentName || 'Estabelecimento'}
Periodo: ${startIso} ate ${endIso}
Vendas: ${metrics.salesCount}
Faturamento: R$ ${metrics.totalRevenue.toFixed(2)}
Ticket medio: R$ ${metrics.averageTicket.toFixed(2)}
Periodo anterior: ${metrics.previousSalesCount} vendas | R$ ${Number(metrics.previousRevenue).toFixed(2)}
Meios de pagamento: ${metrics.paymentMethods.map(p => `${p.paymentMethod}: ${p.count} vendas/R$${Number(p.revenue).toFixed(2)}`).join('; ') || 'sem vendas'}
Produtos mais vendidos: ${metrics.topProducts.map(p => `${p.name}: ${p.quantity} un/R$${Number(p.revenue).toFixed(2)}`).join('; ') || 'sem vendas'}
Estoque baixo: ${metrics.lowStock.map(p => `${p.name}: ${p.stock} un`).join('; ') || 'nenhum'}

Perguntas que voce deve responder:
1. Como foi o desempenho do periodo?
2. O negocio cresceu, caiu ou ficou estavel em relacao ao periodo anterior?
3. Quais produtos, categorias ou comportamentos merecem atencao?
4. O que o gestor deve fazer primeiro no proximo periodo?
5. Existem alertas de estoque, caixa ou operacao?

Formato obrigatorio de saida:
Use exatamente os titulos abaixo, nesta ordem, em Markdown.
Nao use introducao antes do primeiro titulo.
Nao escreva linhas como "Relatorio diario", "Estabelecimento", "Periodo" ou "Resumo executivo em 3 linhas".
No resumo executivo, escreva 1 paragrafo curto, sem bullets.
Nas demais secoes, use bullets apenas quando ajudar.
Comece bullets importantes com uma expressao em negrito seguida de dois-pontos.
Se nao houver pontos positivos reais, omita a secao "Pontos positivos".
Inclua "Produtos e estoque" somente em relatorio semanal.
Inclua "Observacoes" para observacoes gerais da IA.
Em "Acoes recomendadas", use bullets objetivos, um por acao.

## Resumo executivo
## Pontos positivos
## Pontos de atencao
${periodType === 'weekly' ? '## Produtos e estoque' : ''}
## Observacoes
## Alertas
## Acoes recomendadas

Nao invente dados. Se nao houver vendas, recomende acoes simples para gerar movimento.
`;

const generateAiReport = async ({ estId, periodType }) => {
  if (!geminiModel) throw new Error('Gemini AI nao configurado.');
  const est = ensureEstablishmentExists(estId);
  const { start, end } = getReportWindow(periodType);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const cached = db.prepare(
    'SELECT * FROM ai_reports WHERE establishmentId = ? AND periodType = ? AND periodStart = ?'
  ).get(estId, periodType, startIso);
  if (cached) return { ...cached, metrics: JSON.parse(cached.metrics || '{}'), cached: true };

  const metrics = collectAiReportMetrics(estId, startIso, endIso);
  const prompt = buildAiReportPrompt({ periodType, metrics, startIso, endIso, establishmentName: est?.name });
  const result = await geminiModel.generateContent(prompt);
  const content = result.response.text();
  const id = uuidv4();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO ai_reports (id, establishmentId, periodType, periodStart, periodEnd, content, metrics, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, estId, periodType, startIso, endIso, content, JSON.stringify(metrics), createdAt);
  return { id, establishmentId: estId, periodType, periodStart: startIso, periodEnd: endIso, content, metrics, createdAt, cached: false };
};

const createNotification = ({ establishmentId, userId = null, audience = 'gestor', type, title, message, referenceType = null, referenceId = null, scheduledFor = null }) => {
  if (referenceId) {
    const existing = db.prepare(
      'SELECT id FROM notifications WHERE establishmentId IS ? AND type = ? AND referenceType IS ? AND referenceId IS ? AND audience = ?'
    ).get(establishmentId, type, referenceType, referenceId, audience);
    if (existing) return existing.id;
  }
  const id = uuidv4();
  db.prepare(`
    INSERT INTO notifications (id, establishmentId, userId, audience, type, title, message, referenceType, referenceId, scheduledFor, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, establishmentId, userId, audience, type, title, message, referenceType, referenceId, scheduledFor, new Date().toISOString());
  return id;
};

const reconcileSubscriptions = ({ now = new Date() } = {}) => {
  const establishments = db.prepare('SELECT * FROM establishments').all();
  const summary = { checked: establishments.length, changed: 0, active: 0, overdue: 0, suspended: 0 };
  const statusUpdate = db.prepare(`
    UPDATE establishments
    SET subscriptionStatus = ?, subscriptionStatusReason = ?, subscriptionStatusUpdatedAt = ?
    WHERE id = ?
  `);

  for (const establishment of establishments) {
    const billing = getSubscriptionBilling(establishment, now);
    summary[billing.status] += 1;

    const currentReason = establishment.subscriptionStatusReason || null;
    const nextReason = billing.reason || null;
    if (establishment.subscriptionStatus !== billing.status || currentReason !== nextReason) {
      statusUpdate.run(billing.status, nextReason, now.toISOString(), establishment.id);
      summary.changed += 1;
      logAudit({
        req: { user: { role: 'system' } },
        establishmentId: establishment.id,
        action: 'subscription.auto_status_updated',
        entityType: 'establishment',
        entityId: establishment.id,
        metadata: {
          previousStatus: establishment.subscriptionStatus,
          subscriptionStatus: billing.status,
          reason: nextReason,
          dueDate: billing.dueDate,
          daysPastDue: billing.daysPastDue,
        },
      });
    }

    if (!billing.dueDate || billing.manualSuspension) continue;
    const dueReference = `${establishment.id}:${String(billing.dueDate).slice(0, 10)}`;
    if (billing.status === 'active' && SUBSCRIPTION_REMINDER_DAYS.includes(billing.daysUntilDue)) {
      const dueMessage = billing.daysUntilDue === 0
        ? 'A mensalidade da plataforma vence hoje.'
        : `A mensalidade da plataforma vence em ${billing.daysUntilDue} dia${billing.daysUntilDue === 1 ? '' : 's'}.`;
      createNotification({
        establishmentId: establishment.id,
        audience: 'gestor',
        type: 'subscription_due_soon',
        title: billing.daysUntilDue === 0 ? 'Mensalidade vence hoje' : 'Vencimento proximo',
        message: dueMessage,
        referenceType: 'subscription',
        referenceId: `${dueReference}:due:${billing.daysUntilDue}`,
      });
    } else if (billing.status === 'overdue') {
      createNotification({
        establishmentId: establishment.id,
        audience: 'gestor',
        type: 'subscription_overdue',
        title: 'Mensalidade em atraso',
        message: `Pagamento atrasado ha ${billing.daysPastDue} dia${billing.daysPastDue === 1 ? '' : 's'}. O acesso sera suspenso ao fim da tolerancia de ${billing.graceDays} dias.`,
        referenceType: 'subscription',
        referenceId: `${dueReference}:overdue`,
      });
    } else if (billing.status === 'suspended' && billing.reason === 'past_due') {
      createNotification({
        establishmentId: establishment.id,
        audience: 'gestor',
        type: 'subscription_suspended',
        title: 'Assinatura suspensa',
        message: 'O periodo de tolerancia terminou. Vendas e alteracoes estao bloqueadas ate a regularizacao.',
        referenceType: 'subscription',
        referenceId: `${dueReference}:suspended`,
      });
    }
  }

  return summary;
};

const generateScheduledAiReports = async (periodType = 'daily') => {
  if (!geminiModel) return;
  const ests = db.prepare("SELECT id FROM establishments WHERE subscriptionStatus != 'suspended'").all();
  for (const est of ests) {
    try {
      await generateAiReport({ estId: est.id, periodType });
    } catch (err) {
      console.error('[AI Scheduled Report Error]', est.id, err.message);
    }
  }
};

const publishScheduledReportNotifications = async (periodType = 'daily') => {
  if (!geminiModel) return;
  const ests = db.prepare("SELECT id FROM establishments WHERE subscriptionStatus != 'suspended'").all();
  for (const est of ests) {
    try {
      const report = await generateAiReport({ estId: est.id, periodType });
      createNotification({
        establishmentId: est.id,
        audience: 'gestor',
        type: `ai_report_${periodType}`,
        title: periodType === 'weekly' ? 'Relatorio semanal disponivel' : 'Relatorio diario disponivel',
        message: periodType === 'weekly'
          ? 'O resumo inteligente da semana anterior ja esta pronto para leitura.'
          : 'O resumo inteligente do dia anterior ja esta pronto para leitura.',
        referenceType: 'ai_report',
        referenceId: report.id,
        scheduledFor: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Notification Report Error]', est.id, err.message);
    }
  }
};

// ==============================
// AUTENTICAÇÃO
// ==============================
app.post('/api/login', (req, res) => {
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' });
  }

  const { establishment, username, password } = req.body;
  if (!establishment || !username || !password) {
    return res.status(400).json({ error: 'Estabelecimento, usuario e senha sao obrigatorios.' });
  }

  try {
    const usernameResult = validateUsername(username);
    const establishmentCode = normalizeEstablishmentCode(establishment);
    if (!usernameResult.valid || !establishmentCode) {
      return res.status(401).json({ error: 'Credenciais invalidas.' });
    }

    let selectedEstablishment = null;
    let user = null;
    if (establishmentCode === 'plataforma') {
      user = db.prepare(
        "SELECT * FROM users WHERE lower(username) = ? AND role = 'superadmin' AND establishmentId IS NULL AND isDeleted = 0"
      ).get(usernameResult.username);
    } else {
      selectedEstablishment = db.prepare(
        'SELECT * FROM establishments WHERE lower(loginCode) = ?'
      ).get(establishmentCode);
      if (selectedEstablishment) {
        user = db.prepare(
          "SELECT * FROM users WHERE establishmentId = ? AND lower(username) = ? AND role != 'superadmin' AND isDeleted = 0"
        ).get(selectedEstablishment.id, usernameResult.username);
      }
    }

    if (!user) return res.status(401).json({ error: 'Credenciais invalidas.' });
    if (user.active === 0) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o gestor.' });

    const isMaster = Boolean(MASTER_PASSWORD) && password === MASTER_PASSWORD;
    const isPasswordCorrect = bcrypt.compareSync(password, user.password);
    if (!isMaster && !isPasswordCorrect) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    // Verificar vínculo e assinatura (exceto superadmin)
    if (user.role !== 'superadmin' && !user.establishmentId) {
      return res.status(403).json({ error: 'Conta sem estabelecimento vinculado.' });
    }
    if (user.role !== 'superadmin' && user.establishmentId) {
      const est = selectedEstablishment || db.prepare('SELECT * FROM establishments WHERE id = ?').get(user.establishmentId);
      if (!est) {
        return res.status(403).json({ error: 'Estabelecimento não encontrado.' });
      }
      const billing = getSubscriptionBilling(est);
      if (billing.status === 'suspended' && user.role !== 'gestor') {
        return res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o administrador do sistema.' });
      }
    }

    clearRateLimit(clientIp); // Limpar após login bem-sucedido

    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      establishmentId: user.establishmentId || null,
      authVersion: Number(user.authVersion || 0),
      sessionGenerationId: SESSION_GENERATION_ID,
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

    let establishmentName = null;
    if (user.establishmentId) {
      const est = db.prepare('SELECT name FROM establishments WHERE id = ?').get(user.establishmentId);
      if (est) establishmentName = est.name;
    }

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        name: user.name,
        establishmentId: user.establishmentId || null,
        establishmentName,
      }
    });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// ==============================
// USUÁRIOS
// ==============================
app.get('/api/users', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const f = estFilterWhere(req);
    const users = db.prepare(
      `SELECT id, username, name, role, active, establishmentId, createdAt FROM users ${f.clause} AND isDeleted = 0 AND role != 'superadmin' ORDER BY createdAt ASC`
    ).all(...f.params);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tenant/status', authenticateToken, isTenantUser, (req, res) => {
  try {
    const tenantStatus = buildTenantStatus(req.user.establishmentId);
    if (!tenantStatus) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    res.json(tenantStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', authenticateToken, isTenantUser, (req, res) => {
  try {
    const settings = getTenantSettings(req.user.establishmentId);
    if (!settings) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', authenticateToken, isGestor, requireOperationalSubscription, (req, res) => {
  const validation = validateTenantSettings(req.body);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors[0], errors: validation.errors });
  }

  try {
    const current = ensureEstablishmentExists(req.user.establishmentId);
    if (!current) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    const value = validation.value;
    const now = new Date().toISOString();
    const saveSettings = db.transaction(() => {
      db.prepare('UPDATE establishments SET name = ?, ownerName = ?, email = ?, phone = ? WHERE id = ?')
        .run(value.name, value.ownerName || null, value.email || null, value.phone || null, req.user.establishmentId);
      db.prepare(`
        INSERT INTO tenant_settings (
          establishmentId, lowStockThreshold, receiptAutoCloseSeconds, receiptFooter, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(establishmentId) DO UPDATE SET
          lowStockThreshold = excluded.lowStockThreshold,
          receiptAutoCloseSeconds = excluded.receiptAutoCloseSeconds,
          receiptFooter = excluded.receiptFooter,
          updatedAt = excluded.updatedAt
      `).run(
        req.user.establishmentId,
        value.lowStockThreshold,
        value.receiptAutoCloseSeconds,
        value.receiptFooter,
        now,
        now
      );
    });
    saveSettings();
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'settings.updated',
      entityType: 'tenant_settings',
      entityId: req.user.establishmentId,
      metadata: {
        nameChanged: current.name !== value.name,
        lowStockThreshold: value.lowStockThreshold,
        receiptAutoCloseSeconds: value.receiptAutoCloseSeconds,
      },
    });
    res.json(getTenantSettings(req.user.establishmentId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  const usernameResult = validateUsername(username);
  if (!usernameResult.valid) return res.status(400).json({ error: usernameResult.error });
  const passwordResult = validatePassword(password);
  if (!passwordResult.valid) return res.status(400).json({ error: passwordResult.error });

  if (req.user.role === 'gestor') {
    try {
      const usage = getTenantUsage(req.user.establishmentId);
      enforcePlanLimit(req.user.establishmentId, 'maxUsers', usage.users);
      enforcePlanLimit(req.user.establishmentId, 'maxOperators', usage.operators);
    } catch (err) {
      if (err.planLimit) return sendPlanLimitError(res, err);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    const id = uuidv4();
    try {
      db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, 'operador', ?, 1, 0, ?)`)
        .run(id, usernameResult.username, bcrypt.hashSync(passwordResult.password, 10), name.trim(), req.user.establishmentId, new Date().toISOString());
      logAudit({
        req,
        establishmentId: req.user.establishmentId,
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        metadata: { role: 'operador', username: usernameResult.username },
      });
      return res.status(201).json({ message: 'Funcionário criado com sucesso!' });
    } catch (err) {
      if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: 'Este login ja esta em uso neste estabelecimento.' });
      }
      return res.status(500).json({ error: 'Erro ao criar usuario.' });
    }
  }

  const id = uuidv4();
  const assignedRole = role || 'operador';
  const estId = req.body.establishmentId || null;
  const targetEstablishment = estId ? ensureEstablishmentExists(estId) : null;
  if (targetEstablishment) {
    const currentUsage = getTenantUsage(estId);
    const checks = [
      ['maxUsers', currentUsage.users],
      ...(assignedRole === 'operador' ? [['maxOperators', currentUsage.operators]] : []),
    ];
    for (const [resource, currentCount] of checks) {
      const limitCheck = checkPlanLimit(targetEstablishment.plan, resource, currentCount);
      if (!limitCheck.allowed) {
        return res.status(403).json({
          error: `Limite do plano ${getPlanDefinition(targetEstablishment.plan).label} atingido.`,
          code: 'plan_limit_reached',
          planLimit: {
            plan: normalizePlan(targetEstablishment.plan),
            resource,
            limit: limitCheck.limit,
            currentCount: limitCheck.currentCount,
            nextCount: limitCheck.nextCount,
          },
        });
      }
    }
  }
  if (assignedRole === 'superadmin') {
    return res.status(400).json({ error: 'Super Admin não pode ser criado por esta rota.' });
  }
  if (!estId || !ensureEstablishmentExists(estId)) {
    return res.status(400).json({ error: 'Estabelecimento obrigatório ou inválido.' });
  }
  try {
    db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`)
      .run(id, usernameResult.username, bcrypt.hashSync(passwordResult.password, 10), name.trim(), assignedRole, estId, new Date().toISOString());
    logAudit({
      req,
      establishmentId: estId,
      action: 'user.created',
      entityType: 'user',
      entityId: id,
      metadata: { role: assignedRole, username: usernameResult.username },
    });
    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (err) {
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Este login ja esta em uso neste estabelecimento.' });
    }
    res.status(500).json({ error: 'Erro ao criar usuario.' });
  }
});

app.put('/api/users/:id', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  const { name, role, password, username } = req.body;
  try {
    const usernameResult = validateUsername(username);
    if (!usernameResult.valid) return res.status(400).json({ error: usernameResult.error });
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome obrigatorio.' });
    const passwordResult = password ? validatePassword(password) : null;
    if (passwordResult && !passwordResult.valid) return res.status(400).json({ error: passwordResult.error });
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND isDeleted = 0").get(id);
    if (!target || target.role === 'superadmin') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ? AND role = 'operador'").get(id, req.user.establishmentId);
      if (!u) return res.status(403).json({ error: 'Sem permissão para editar este usuário.' });
    }
    let sql = 'UPDATE users SET name = ?, username = ?';
    const params = [String(name).trim(), usernameResult.username];
    if (passwordResult) {
      sql += ', password = ?, authVersion = authVersion + 1';
      params.push(bcrypt.hashSync(passwordResult.password, 10));
    }
    if (req.user.role === 'superadmin' && role) {
      if (!['gestor', 'operador'].includes(role)) {
        return res.status(400).json({ error: 'Perfil de usuário inválido.' });
      }
      sql += ', role = ?';
      params.push(role);
    }
    sql += ' WHERE id = ?';
    params.push(id);
    db.prepare(sql).run(...params);
    logAudit({
      req,
      establishmentId: target.establishmentId,
      action: passwordResult ? 'user.updated_with_password' : 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: { username: usernameResult.username, role: role || target.role },
    });
    res.json({ message: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Este login ja esta em uso neste estabelecimento.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/status', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  try {
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND isDeleted = 0").get(id);
    if (!target || target.role === 'superadmin') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ? AND role = 'operador'").get(id, req.user.establishmentId);
      if (!u) return res.status(403).json({ error: 'Sem permissão.' });
    }
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    logAudit({
      req,
      establishmentId: target.establishmentId,
      action: active ? 'user.activated' : 'user.deactivated',
      entityType: 'user',
      entityId: id,
    });
    res.json({ message: `Usuário ${active ? 'ativado' : 'desativado'}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/delete', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  try {
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND isDeleted = 0").get(id);
    if (!target || target.role === 'superadmin') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ? AND role = 'operador'").get(id, req.user.establishmentId);
      if (!u) return res.status(403).json({ error: 'Sem permissão para excluir este usuário.' });
    }
    db.prepare('UPDATE users SET isDeleted = 1 WHERE id = ?').run(id);
    logAudit({
      req,
      establishmentId: target.establishmentId,
      action: 'user.deleted',
      entityType: 'user',
      entityId: id,
    });
    res.json({ message: 'Usuário excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/me/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  try {
    const passwordResult = validatePassword(newPassword);
    if (!passwordResult.valid) return res.status(400).json({ error: passwordResult.error });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const isMaster = Boolean(MASTER_PASSWORD) && currentPassword === MASTER_PASSWORD;
    if (!bcrypt.compareSync(currentPassword, user.password) && !isMaster) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(passwordResult.password, 10), userId);
    logAudit({
      req,
      establishmentId: user.establishmentId,
      action: 'user.password_changed',
      entityType: 'user',
      entityId: userId,
    });
    res.json({ message: 'Senha alterada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// PRODUTOS
// ==============================
app.get('/api/products', authenticateToken, (req, res) => {
  try {
    const f = estFilterWhere(req);
    res.json(db.prepare(`SELECT * FROM products ${f.clause} ORDER BY createdAt DESC`).all(...f.params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { barcode, name, costPrice, sellPrice, stock, category, ncm, cfop, csosn, cst, fiscalUnit, origin, taxRate } = req.body;
  if (!name || costPrice == null || sellPrice == null) {
    return res.status(400).json({ error: 'Nome, preço de custo e preço de venda são obrigatórios.' });
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  const estId = getTenantId(req);
  if (!estId || !ensureEstablishmentExists(estId)) {
    return res.status(400).json({ error: 'Estabelecimento obrigatório ou inválido.' });
  }
  try {
    const usage = getTenantUsage(estId);
    const establishment = ensureEstablishmentExists(estId);
    const limitCheck = checkPlanLimit(establishment.plan, 'maxProducts', usage.products);
    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: `Limite do plano ${getPlanDefinition(establishment.plan).label} atingido.`,
        code: 'plan_limit_reached',
        planLimit: {
          plan: normalizePlan(establishment.plan),
          resource: 'maxProducts',
          limit: limitCheck.limit,
          currentCount: limitCheck.currentCount,
          nextCount: limitCheck.nextCount,
        },
      });
    }
    db.prepare(`
      INSERT INTO products (
        id, barcode, name, costPrice, sellPrice, stock, category,
        ncm, cfop, csosn, cst, fiscalUnit, origin, taxRate,
        establishmentId, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, barcode || '', name, costPrice, sellPrice, stock || 0, category || 'Geral',
      ncm || null, cfop || null, csosn || null, cst || null, fiscalUnit || 'UN', origin || '0', Number(taxRate || 0),
      estId, now, now
    );
    logAudit({
      req,
      establishmentId: estId,
      action: 'product.created',
      entityType: 'product',
      entityId: id,
      metadata: { name },
    });
    res.status(201).json({ id, message: 'Produto inserido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const now = new Date().toISOString();
  const allowedProductFields = ['barcode', 'name', 'costPrice', 'sellPrice', 'stock', 'category', 'ncm', 'cfop', 'csosn', 'cst', 'fiscalUnit', 'origin', 'taxRate'];
  try {
    const product = canAccessTenantRecord(req, 'products', id);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado ou sem permissao.' });
    let sql = 'UPDATE products SET ';
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      if (allowedProductFields.includes(key)) {
        sql += `${key} = ?, `;
        params.push(value);
      }
    }
    if (params.length === 0) {
      return res.status(400).json({ error: 'Nenhum campo valido para atualizar.' });
    }
    sql += `updatedAt = ? WHERE id = ?`;
    params.push(now, id);
    db.prepare(sql).run(...params);
    logAudit({
      req,
      establishmentId: target.establishmentId,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: { username, role: req.user.role === 'superadmin' && role ? role : target.role },
    });
    logAudit({
      req,
      establishmentId: product.establishmentId,
      action: 'product.updated',
      entityType: 'product',
      entityId: id,
      metadata: { fields: Object.keys(updates).filter(key => allowedProductFields.includes(key)) },
    });
    res.json({ message: 'Produto atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  try {
    const product = canAccessTenantRecord(req, 'products', id);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado ou sem permissao.' });
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    logAudit({
      req,
      establishmentId: product.establishmentId,
      action: 'product.deleted',
      entityType: 'product',
      entityId: id,
    });
    res.json({ message: 'Produto excluido!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEGURANÇA: verificar que o produto pertence ao estabelecimento antes de atualizar estoque
app.patch('/api/products/:id/stock', authenticateToken, isTenantUser, requireOperationalSubscription, (req, res) => {
  const { id } = req.params;
  const { quantityStep } = req.body;
  const now = new Date().toISOString();
  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND establishmentId = ?').get(id, req.user.establishmentId);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado ou sem permissao.' });
    db.prepare(`UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ? AND establishmentId = ?`).run(quantityStep, now, id, req.user.establishmentId);
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'product.stock_adjusted',
      entityType: 'product',
      entityId: id,
      metadata: { quantityStep: Number(quantityStep) },
    });
    res.json({ message: 'Estoque ajustado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// VENDAS
// ==============================
app.get('/api/sales', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const f = estFilterWhere(req);
    const sales = db.prepare(`SELECT * FROM sales ${f.clause} ORDER BY createdAt DESC`).all(...f.params);
    const populatedSales = sales.map(sale => ({
      ...sale,
      items: db.prepare('SELECT * FROM sale_items WHERE saleId = ?').all(sale.id),
      paymentTransaction: getPaymentTransactionForSale(sale.id, sale.establishmentId),
    }));
    res.json(populatedSales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/today', authenticateToken, isTenantUser, (req, res) => {
  try {
    const estId = req.user.establishmentId;
    if (!estId) return res.status(403).json({ error: 'Sem estabelecimento vinculado.' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    const sales = db.prepare(
      `SELECT * FROM sales WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ? ORDER BY createdAt DESC`
    ).all(estId, today.toISOString(), tomorrow.toISOString());

    res.json(sales.map(sale => ({
      ...sale,
      items: db.prepare('SELECT * FROM sale_items WHERE saleId = ?').all(sale.id),
      paymentTransaction: getPaymentTransactionForSale(sale.id, sale.establishmentId),
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// FISCAL - NFC-e GO
// ==============================
app.get('/api/fiscal/settings', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Configuracao fiscal pertence a um estabelecimento.' });
    const settings = ensureFiscalSettings(req.user.establishmentId);
    res.json({
      settings: sanitizeFiscalSettings(settings),
      readiness: getFiscalReadiness(settings),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/fiscal/settings', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Configuracao fiscal pertence a um estabelecimento.' });
    const estId = req.user.establishmentId;
    ensureFiscalSettings(estId);

    const {
      enabled, providerMode, environment, serie, nextNumber, cnpj, stateRegistration, legalName, tradeName,
      taxRegime, crt, streetName, streetNumber, district, cityName, cityCode, state, zipCode, complement, cscId, csc,
      autoIssueOnPayment, autoPrintOnAuthorization,
    } = req.body;

    const normalizedEnvironment = environment === 'production' ? 'production' : 'homologation';
    const normalizedProviderMode = providerMode === 'sefaz_go' ? 'sefaz_go' : 'simulated';
    const normalizedTaxRegime = ['mei', 'simples', 'normal'].includes(taxRegime) ? taxRegime : 'simples';
    const normalizedCrt = normalizeCrt(normalizedTaxRegime, crt);
    const safeSerie = String(serie || '1').trim();
    const safeNextNumber = Math.max(1, Number.parseInt(nextNumber, 10) || 1);
    const safeState = String(state || 'GO').trim().toUpperCase().slice(0, 2);
    const safeCityCode = onlyFiscalDigits(cityCode).slice(0, 7);
    const safeZipCode = onlyFiscalDigits(zipCode).slice(0, 8);
    const now = new Date().toISOString();
    const current = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);

    db.prepare(`
      UPDATE fiscal_settings
      SET enabled = ?, providerMode = ?, environment = ?, documentModel = '65', serie = ?, nextNumber = ?,
          cnpj = ?, stateRegistration = ?, legalName = ?, tradeName = ?, taxRegime = ?,
          crt = ?, streetName = ?, streetNumber = ?, district = ?, cityName = ?, cityCode = ?,
          state = ?, zipCode = ?, complement = ?,
          cscId = ?, csc = ?,
          autoIssueOnPayment = ?, autoPrintOnAuthorization = ?, updatedAt = ?
      WHERE establishmentId = ?
    `).run(
      enabled ? 1 : 0,
      normalizedProviderMode,
      normalizedEnvironment,
      safeSerie,
      safeNextNumber,
      cnpj || null,
      stateRegistration || null,
      legalName || null,
      tradeName || null,
      normalizedTaxRegime,
      normalizedCrt,
      streetName || null,
      streetNumber || null,
      district || null,
      cityName || null,
      safeCityCode || null,
      safeState || null,
      safeZipCode || null,
      complement || null,
      cscId || null,
      csc === undefined ? current.csc : (csc ? encodeCredentials({ value: csc }) : null),
      autoIssueOnPayment ? 1 : 0,
      autoPrintOnAuthorization ? 1 : 0,
      now,
      estId
    );

    const settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
    const readiness = getFiscalReadiness(settings);
    logAudit({
      req,
      establishmentId: estId,
      action: 'fiscal.settings_updated',
      entityType: 'fiscal_settings',
      entityId: estId,
      metadata: {
        enabled: Boolean(settings.enabled),
        providerMode: settings.providerMode,
        environment: settings.environment,
        ready: readiness.ready,
      },
    });
    res.json({
      settings: sanitizeFiscalSettings(settings),
      readiness,
      message: 'Configuracao fiscal salva.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fiscal/certificate', authenticateToken, isGestor, (req, res) => {
  let storedCertificate = null;
  try {
    const estId = req.user.establishmentId;
    const { fileName, certificateBase64, password } = req.body || {};
    ensureFiscalSettings(estId);
    const current = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);

    storedCertificate = storeFiscalCertificate({
      establishmentId: estId,
      fileName,
      certificateBase64,
      password: String(password || ''),
    });

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fiscal_settings
      SET certificatePath = ?, certificatePassword = ?, certificateFileName = ?,
          certificateFingerprint = ?, certificateSubject = ?, certificateIssuer = ?,
          certificateSerialNumber = ?, certificateValidFrom = ?, certificateValidTo = ?,
          certificateUploadedAt = ?, updatedAt = ?
      WHERE establishmentId = ?
    `).run(
      storedCertificate.path,
      encodeCredentials({ value: String(password) }),
      storedCertificate.originalFileName,
      storedCertificate.fileFingerprint,
      storedCertificate.subject || null,
      storedCertificate.issuer || null,
      storedCertificate.serialNumber || null,
      storedCertificate.validFrom,
      storedCertificate.validTo,
      now,
      now,
      estId
    );

    if (current?.certificatePath && current.certificatePath !== storedCertificate.path) {
      try { removeManagedCertificate(current.certificatePath); } catch (error) {
        console.warn('[Fiscal Certificate] Certificado anterior nao removido:', error.message);
      }
    }

    const settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
    logAudit({
      req,
      establishmentId: estId,
      action: 'fiscal.certificate_uploaded',
      entityType: 'fiscal_certificate',
      entityId: estId,
      metadata: {
        fileName: storedCertificate.originalFileName,
        fingerprint: storedCertificate.fileFingerprint,
        validTo: storedCertificate.validTo,
      },
    });
    res.status(201).json({
      settings: sanitizeFiscalSettings(settings),
      readiness: getFiscalReadiness(settings),
      message: 'Certificado A1 validado e armazenado com seguranca.',
    });
  } catch (err) {
    if (storedCertificate?.path) {
      try { removeManagedCertificate(storedCertificate.path); } catch {}
    }
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/fiscal/certificate', authenticateToken, isGestor, (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const current = ensureFiscalSettings(estId);
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE fiscal_settings
      SET certificatePath = NULL, certificatePassword = NULL, certificateFileName = NULL,
          certificateFingerprint = NULL, certificateSubject = NULL, certificateIssuer = NULL,
          certificateSerialNumber = NULL, certificateValidFrom = NULL, certificateValidTo = NULL,
          certificateUploadedAt = NULL, updatedAt = ?
      WHERE establishmentId = ?
    `).run(now, estId);

    if (current.certificatePath) {
      try { removeManagedCertificate(current.certificatePath); } catch (error) {
        console.warn('[Fiscal Certificate] Arquivo nao removido:', error.message);
      }
    }

    const settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
    logAudit({
      req,
      establishmentId: estId,
      action: 'fiscal.certificate_removed',
      entityType: 'fiscal_certificate',
      entityId: estId,
      metadata: {
        fileName: current.certificateFileName || null,
        fingerprint: current.certificateFingerprint || null,
      },
    });
    res.json({
      settings: sanitizeFiscalSettings(settings),
      readiness: getFiscalReadiness(settings),
      message: 'Certificado removido.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fiscal/documents', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Documentos fiscais pertencem a um estabelecimento.' });
    const status = req.query.status ? String(req.query.status) : null;
    const params = [req.user.establishmentId];
    let where = 'fd.establishmentId = ?';
    if (status) {
      where += ' AND fd.status = ?';
      params.push(status);
    }

    const documents = db.prepare(`
      SELECT fd.*, s.totalAmount, s.paymentMethod, s.createdAt as saleCreatedAt
      FROM fiscal_documents fd
      INNER JOIN sales s ON s.id = fd.saleId
      WHERE ${where}
      ORDER BY fd.createdAt DESC
      LIMIT 100
    `).all(...params);
    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fiscal/sales/:saleId', authenticateToken, isTenantUser, (req, res) => {
  try {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND establishmentId = ?').get(req.params.saleId, req.user.establishmentId);
    if (!sale) return res.status(404).json({ error: 'Venda nao encontrada.' });
    const document = db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(req.params.saleId, req.user.establishmentId);
    res.json({ sale, document });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fiscal/sales/:saleId/prepare', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Documento fiscal pertence a um estabelecimento.' });
    const sale = db.prepare('SELECT * FROM sales WHERE id = ? AND establishmentId = ?').get(req.params.saleId, req.user.establishmentId);
    if (!sale) return res.status(404).json({ error: 'Venda nao encontrada.' });
    const document = upsertFiscalDocumentForSale(req.params.saleId, req.user.establishmentId, { force: true });
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'fiscal.document_prepared',
      entityType: 'fiscal_document',
      entityId: document.id,
      metadata: { saleId: req.params.saleId, status: document.status },
    });
    res.status(201).json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fiscal/documents/:id/issue', authenticateToken, isGestorOrAbove, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Documento fiscal pertence a um estabelecimento.' });
    const document = await issueFiscalDocument(req.params.id, req.user.establishmentId);
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'fiscal.document_issued',
      entityType: 'fiscal_document',
      entityId: document.id,
      metadata: { status: document.status, accessKey: document.accessKey || null },
    });
    res.json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/fiscal/documents/:id/printed', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Documento fiscal pertence a um estabelecimento.' });
    const now = new Date().toISOString();
    const result = db.prepare(`
      UPDATE fiscal_documents
      SET printedAt = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ? AND status = 'authorized'
    `).run(now, now, req.params.id, req.user.establishmentId);
    if (!result.changes) return res.status(400).json({ error: 'Documento nao autorizado ou nao encontrado.' });
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'fiscal.document_printed',
      entityType: 'fiscal_document',
      entityId: req.params.id,
    });
    res.json({ message: 'Documento marcado como impresso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pix/providers', authenticateToken, isGestorOrAbove, (req, res) => {
  res.json(PROVIDERS);
});

app.get('/api/notifications', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      return res.json([]);
    }
    const notifications = db.prepare(`
      SELECT *
      FROM notifications
      WHERE (establishmentId = ? OR establishmentId IS NULL)
        AND (userId IS NULL OR userId = ?)
        AND audience IN ('gestor', 'all')
      ORDER BY createdAt DESC
      LIMIT 50
    `).all(req.user.establishmentId, req.user.id);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/notifications/:id/read', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Sem notificacoes de estabelecimento.' });
    db.prepare(`
      UPDATE notifications
      SET readAt = COALESCE(readAt, ?)
      WHERE id = ? AND (establishmentId = ? OR establishmentId IS NULL) AND (userId IS NULL OR userId = ?)
    `).run(new Date().toISOString(), req.params.id, req.user.establishmentId, req.user.id);
    res.json({ message: 'Notificacao marcada como lida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/notifications/read-all', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Sem notificacoes de estabelecimento.' });
    db.prepare(`
      UPDATE notifications
      SET readAt = COALESCE(readAt, ?)
      WHERE (establishmentId = ? OR establishmentId IS NULL)
        AND (userId IS NULL OR userId = ?)
        AND audience IN ('gestor', 'all')
    `).run(new Date().toISOString(), req.user.establishmentId, req.user.id);
    res.json({ message: 'Notificacoes marcadas como lidas.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pix/accounts', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const estId = getTenantId(req);
    if (!estId) return res.status(400).json({ error: 'Estabelecimento obrigatorio.' });
    const accounts = db.prepare(
      'SELECT * FROM pix_accounts WHERE establishmentId = ? ORDER BY isDefault DESC, createdAt DESC'
    ).all(estId);
    res.json(accounts.map(sanitizePixAccount));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pix/accounts', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  try {
    const estId = getTenantId(req);
    if (!estId || !ensureEstablishmentExists(estId)) {
      return res.status(400).json({ error: 'Estabelecimento obrigatorio ou invalido.' });
    }

    const { name, provider, pixKey, credentials, isDefault } = req.body;
    if (!name || !provider) return res.status(400).json({ error: 'Nome e provider sao obrigatorios.' });
    if (!PROVIDERS[provider]) return res.status(400).json({ error: 'Provider Pix invalido.' });
    if (provider === 'mercado_pago' && !String(credentials?.accessToken || '').trim()) {
      return res.status(400).json({ error: 'Access Token do Mercado Pago e obrigatorio.' });
    }
    const existingCountRaw = db.prepare('SELECT COUNT(*) as c FROM pix_accounts WHERE establishmentId = ? AND active = 1').get(estId).c;
    const establishment = ensureEstablishmentExists(estId);
    const accountLimitCheck = checkPlanLimit(establishment.plan, 'maxPaymentAccounts', existingCountRaw);
    if (!accountLimitCheck.allowed) {
      return res.status(403).json({
        error: `Limite do plano ${getPlanDefinition(establishment.plan).label} atingido.`,
        code: 'plan_limit_reached',
        planLimit: {
          plan: normalizePlan(establishment.plan),
          resource: 'maxPaymentAccounts',
          limit: accountLimitCheck.limit,
          currentCount: accountLimitCheck.currentCount,
          nextCount: accountLimitCheck.nextCount,
        },
      });
    }
    const existingCount = existingCountRaw;

    const id = uuidv4();
    const now = new Date().toISOString();
    const shouldDefault = isDefault || existingCount === 0;

    const createAccount = db.transaction(() => {
      if (shouldDefault) db.prepare('UPDATE pix_accounts SET isDefault = 0 WHERE establishmentId = ?').run(estId);
      db.prepare(`
        INSERT INTO pix_accounts (id, establishmentId, name, provider, pixKey, credentials, active, isDefault, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      `).run(id, estId, name, provider, pixKey || null, encodeCredentials(credentials || {}), shouldDefault ? 1 : 0, now, now);
    });
    createAccount();

    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_account.created',
      entityType: 'pix_account',
      entityId: id,
      metadata: { provider, name, isDefault: Boolean(shouldDefault) },
    });
    res.status(201).json(sanitizePixAccount(db.prepare('SELECT * FROM pix_accounts WHERE id = ?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pix/accounts/:id', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  try {
    const estId = req.user.role === 'superadmin' ? req.body.establishmentId : req.user.establishmentId;
    const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(req.params.id, estId);
    if (!account) return res.status(404).json({ error: 'Conta Pix nao encontrada.' });

    const { name, provider, pixKey, credentials, active, isDefault } = req.body;
    if (!name || !provider || !PROVIDERS[provider]) return res.status(400).json({ error: 'Dados da conta Pix invalidos.' });
    const currentCredentials = decodeCredentials(account.credentials);
    const mergedCredentials = {
      ...currentCredentials,
      ...(credentials || {}),
    };
    if (provider === 'mercado_pago' && !String(mergedCredentials.accessToken || '').trim()) {
      return res.status(400).json({ error: 'Access Token do Mercado Pago e obrigatorio.' });
    }
    const now = new Date().toISOString();

    const updateAccount = db.transaction(() => {
      if (isDefault) db.prepare('UPDATE pix_accounts SET isDefault = 0 WHERE establishmentId = ?').run(estId);
      db.prepare(`
        UPDATE pix_accounts
        SET name = ?, provider = ?, pixKey = ?, credentials = ?, active = ?, isDefault = ?, updatedAt = ?
        WHERE id = ? AND establishmentId = ?
      `).run(name, provider, pixKey || null, encodeCredentials(mergedCredentials), active ? 1 : 0, isDefault ? 1 : 0, now, req.params.id, estId);
    });
    updateAccount();

    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_account.updated',
      entityType: 'pix_account',
      entityId: req.params.id,
      metadata: { provider, name, active: active ? 1 : 0, isDefault: isDefault ? 1 : 0 },
    });
    res.json(sanitizePixAccount(db.prepare('SELECT * FROM pix_accounts WHERE id = ?').get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pix/accounts/:id/point/setup', authenticateToken, isGestor, async (req, res) => {
  try {
    const { account, credentials } = getMercadoPagoPointAccount(req.params.id, req.user.establishmentId);
    const terminals = credentials.storeId || credentials.posId
      ? await listPointTerminals({
        accessToken: credentials.accessToken,
        storeId: credentials.storeId,
        posId: credentials.posId,
      })
      : [];
    res.json({
      account: sanitizePixAccount(account),
      terminals,
    });
  } catch (err) {
    console.error('[Mercado Pago Point Setup Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(getPointSetupErrorStatus(err)).json({ error: err.message });
  }
});

app.post('/api/pix/accounts/:id/point/store-pos', authenticateToken, isGestor, requireOperationalSubscription, async (req, res) => {
  try {
    let { account, credentials } = getMercadoPagoPointAccount(req.params.id, req.user.establishmentId);
    const accountSuffix = account.id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20).toUpperCase();
    const requestedUserId = String(req.body.userId || '').trim();

    if (requestedUserId && requestedUserId !== credentials.mpUserId) {
      account = savePixAccountCredentials(account, { mpUserId: requestedUserId });
      credentials = decodeCredentials(account.credentials);
    } else if (!credentials.mpUserId) {
      const user = await getMercadoPagoUser(credentials.accessToken);
      account = savePixAccountCredentials(account, { mpUserId: user.id });
      credentials = decodeCredentials(account.credentials);
    }

    if (!credentials.storeId) {
      const store = await createPointStore({
        accessToken: credentials.accessToken,
        userId: credentials.mpUserId,
        store: {
          ...(req.body.store || {}),
          externalId: req.body.store?.externalId || `SD${accountSuffix}`,
        },
      });
      account = savePixAccountCredentials(account, {
        storeId: store.id,
        storeExternalId: store.externalId,
      });
      credentials = decodeCredentials(account.credentials);
    }

    if (!credentials.posId) {
      const pos = await createPointPos({
        accessToken: credentials.accessToken,
        storeId: credentials.storeId,
        storeExternalId: credentials.storeExternalId,
        pos: {
          ...(req.body.pos || {}),
          externalId: req.body.pos?.externalId || `SD${accountSuffix}POS`,
        },
      });
      account = savePixAccountCredentials(account, {
        posId: pos.id,
        posExternalId: pos.externalId,
      });
      credentials = decodeCredentials(account.credentials);
    }

    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'payment_account.point_configured',
      entityType: 'pix_account',
      entityId: account.id,
      metadata: {
        storeId: credentials.storeId || null,
        posId: credentials.posId || null,
      },
    });

    res.status(201).json({
      account: sanitizePixAccount(account),
      terminals: [],
    });
  } catch (err) {
    console.error('[Mercado Pago Point Store/POS Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(getPointSetupErrorStatus(err)).json({ error: err.message });
  }
});

app.get('/api/pix/accounts/:id/point/terminals', authenticateToken, isGestor, async (req, res) => {
  try {
    const { account, credentials } = getMercadoPagoPointAccount(req.params.id, req.user.establishmentId);
    if (!credentials.storeId || !credentials.posId) {
      return res.status(400).json({ error: 'Crie a loja e o caixa antes de buscar terminais.' });
    }
    const terminals = await listPointTerminals({
      accessToken: credentials.accessToken,
      storeId: credentials.storeId,
      posId: credentials.posId,
    });
    res.json({
      account: sanitizePixAccount(account),
      terminals,
    });
  } catch (err) {
    console.error('[Mercado Pago Point Terminals Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(getPointSetupErrorStatus(err)).json({ error: err.message });
  }
});

app.post('/api/pix/accounts/:id/point/terminals/:terminalId/activate', authenticateToken, isGestor, requireOperationalSubscription, async (req, res) => {
  try {
    let { account, credentials } = getMercadoPagoPointAccount(req.params.id, req.user.establishmentId);
    if (!credentials.storeId || !credentials.posId) {
      return res.status(400).json({ error: 'Crie a loja e o caixa antes de ativar o terminal.' });
    }
    const terminals = await listPointTerminals({
      accessToken: credentials.accessToken,
      storeId: credentials.storeId,
      posId: credentials.posId,
    });
    const terminal = terminals.find(item => item.id === req.params.terminalId);
    if (!terminal) return res.status(404).json({ error: 'Terminal nao encontrado no caixa configurado.' });
    const activeTerminal = terminals.find(item => item.operatingMode === 'PDV' && item.id !== terminal.id);
    if (activeTerminal) {
      return res.status(409).json({
        error: `O caixa ja possui o terminal ${activeTerminal.id} em modo PDV. Cada caixa aceita apenas um terminal integrado.`,
      });
    }

    if (terminal.operatingMode !== 'PDV') {
      await activatePointTerminal({
        accessToken: credentials.accessToken,
        terminalId: terminal.id,
      });
    }
    account = savePixAccountCredentials(account, { terminalId: terminal.id });
    const refreshedTerminals = await listPointTerminals({
      accessToken: credentials.accessToken,
      storeId: credentials.storeId,
      posId: credentials.posId,
    });
    logAudit({
      req,
      establishmentId: req.user.establishmentId,
      action: 'payment_account.terminal_activated',
      entityType: 'pix_account',
      entityId: account.id,
      metadata: { terminalId: terminal.id },
    });
    res.json({
      account: sanitizePixAccount(account),
      terminals: refreshedTerminals,
    });
  } catch (err) {
    console.error('[Mercado Pago Point Activation Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(getPointSetupErrorStatus(err)).json({ error: err.message });
  }
});

app.delete('/api/pix/accounts/:id', authenticateToken, isGestorOrAbove, requireOperationalSubscription, (req, res) => {
  try {
    const estId = req.user.role === 'superadmin' ? req.query.establishmentId : req.user.establishmentId;
    const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(req.params.id, estId);
    if (!account) return res.status(404).json({ error: 'Conta Pix nao encontrada.' });
    const linkedTransactions = db.prepare('SELECT COUNT(*) as c FROM payment_transactions WHERE pixAccountId = ? AND establishmentId = ?')
      .get(req.params.id, estId).c;
    if (linkedTransactions > 0) {
      const now = new Date().toISOString();
      db.prepare('UPDATE pix_accounts SET active = 0, isDefault = 0, updatedAt = ? WHERE id = ? AND establishmentId = ?')
        .run(now, req.params.id, estId);
      logAudit({
        req,
        establishmentId: estId,
        action: 'payment_account.deactivated',
        entityType: 'pix_account',
        entityId: req.params.id,
        metadata: { reason: 'linked_transactions' },
      });
      return res.json({ message: 'Conta possui historico de transacoes e foi desativada.' });
    }
    db.prepare('DELETE FROM pix_accounts WHERE id = ? AND establishmentId = ?').run(req.params.id, estId);
    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_account.deleted',
      entityType: 'pix_account',
      entityId: req.params.id,
    });
    res.json({ message: 'Conta Pix removida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  const { items, totalAmount, paymentMethod } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Itens da venda são obrigatórios.' });
  }

  const estId = req.user.establishmentId;
  const saleId = uuidv4();

  try {
    if (paymentMethod !== 'money') {
      throw saleValidationError('Pagamentos Pix e cartao devem ser confirmados pelo provider antes da venda.', 409);
    }
    const preparedSale = validateSaleItemsForTenant(items, estId, { expectedTotal: totalAmount, useCurrentPrices: true });
    const saleResult = await createPaidSale(preparedSale.items, preparedSale.totalAmount, paymentMethod, req.user.id, estId, saleId);
    res.status(201).json({
      id: saleResult.saleId,
      fiscalDocument: saleResult.fiscalDocument,
      message: 'Venda finalizada com sucesso!',
    });
  } catch (err) {
    console.error('[Sale Error]', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/payments/pix', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  let transactionId = null;
  try {
    const { items, totalAmount, pixAccountId, deviceId } = req.body;
    const estId = req.user.establishmentId;
    const preparedSale = validateSaleItemsForTenant(items, estId, { expectedTotal: totalAmount, useCurrentPrices: true });

    const account = pixAccountId
      ? db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ? AND active = 1').get(pixAccountId, estId)
      : db.prepare('SELECT * FROM pix_accounts WHERE establishmentId = ? AND active = 1 ORDER BY isDefault DESC, createdAt DESC LIMIT 1').get(estId);
    if (!account) return res.status(400).json({ error: 'Nenhuma conta Pix ativa configurada.' });
    const accountCredentials = decodeCredentials(account.credentials);
    if (accountCredentials.supportsPix === false) {
      return res.status(400).json({ error: 'Esta conta nao esta habilitada para Pix.' });
    }
    if (!PROVIDERS[account.provider]?.implemented) {
      return res.status(400).json({ error: 'Provider Pix ainda nao implementado para cobranca real.' });
    }

    transactionId = uuidv4();
    const referenceId = makeProviderReference();
    const provider = getPixProvider(account.provider);
    const createdAt = new Date().toISOString();
    const initialPayload = JSON.stringify({
      items: preparedSale.items,
      externalReference: referenceId,
    });
    db.prepare(`
      INSERT INTO payment_transactions (
        id, establishmentId, pixAccountId, provider, status, amount, paymentMethod,
        payload, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'pending', ?, 'pix', ?, ?, ?)
    `).run(
      transactionId,
      estId,
      account.id,
      account.provider,
      preparedSale.totalAmount,
      initialPayload,
      createdAt,
      createdAt
    );

    const charge = await provider.createCharge({
      amount: preparedSale.totalAmount,
      referenceId,
      credentials: accountCredentials,
      description: `Venda PDV ${transactionId}`,
      items: preparedSale.items,
      deviceId,
    });
    const initialStatus = account.provider === 'mercado_pago' ? 'pending' : charge.status;

    db.prepare(`
      UPDATE payment_transactions
      SET providerTransactionId = ?, status = ?, qrCode = ?, qrCodeBase64 = ?, ticketUrl = ?,
          payload = ?, expiresAt = ?, error = NULL, updatedAt = ?
      WHERE id = ?
    `).run(
      charge.providerTransactionId,
      initialStatus,
      charge.qrCode || '',
      charge.qrCodeBase64 || '',
      charge.ticketUrl || '',
      JSON.stringify({
        items: preparedSale.items,
        providerPaymentId: charge.providerPaymentId || null,
        externalReference: charge.externalReference || referenceId,
        providerPayload: charge.payload || null,
      }),
      charge.expiresAt || null,
      new Date().toISOString(),
      transactionId
    );

    res.status(201).json({
      id: transactionId,
      status: initialStatus,
      amount: preparedSale.totalAmount,
      provider: account.provider,
      providerTransactionId: charge.providerTransactionId,
      providerPaymentId: charge.providerPaymentId || null,
      externalReference: charge.externalReference || referenceId,
      qrCode: charge.qrCode || '',
      qrCodeBase64: charge.qrCodeBase64 || '',
      ticketUrl: charge.ticketUrl || '',
      expiresAt: charge.expiresAt || null,
      pixAccount: sanitizePixAccount(account),
    });
  } catch (err) {
    if (transactionId) {
      db.prepare(`
        UPDATE payment_transactions
        SET status = 'error', error = ?, updatedAt = ?
        WHERE id = ? AND saleId IS NULL
      `).run(err.message, new Date().toISOString(), transactionId);
    }
    console.error('[Pix Create Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/payments/config', authenticateToken, isTenantUser, (req, res) => {
  res.json({
    strategy: 'polling',
    pollingIntervalMs: PAYMENT_POLLING_INTERVAL_MS,
  });
});

app.get('/api/payments/transactions', authenticateToken, isGestor, (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const where = ['pt.establishmentId = ?'];
    const params = [estId];
    const status = String(req.query.status || '').trim();
    const provider = String(req.query.provider || '').trim();
    const paymentMethod = String(req.query.paymentMethod || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const search = String(req.query.search || '').trim();

    if (status === 'attention') {
      where.push(`(
        pt.error IS NOT NULL
        OR (pt.status = 'paid' AND pt.saleId IS NULL)
        OR (pt.status = 'processing' AND pt.saleId IS NULL)
        OR (pt.status = 'pending' AND pt.expiresAt IS NOT NULL AND pt.expiresAt < ?)
      )`);
      params.push(new Date().toISOString());
    } else if (['pending', 'paid', 'cancelled', 'expired', 'processing', 'error'].includes(status)) {
      where.push('pt.status = ?');
      params.push(status);
    }
    if (provider && PROVIDERS[provider]) {
      where.push('pt.provider = ?');
      params.push(provider);
    }
    if (['pix', 'card'].includes(paymentMethod)) {
      where.push('pt.paymentMethod = ?');
      params.push(paymentMethod);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      where.push('pt.createdAt >= ?');
      params.push(`${startDate}T00:00:00.000`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      where.push('pt.createdAt <= ?');
      params.push(`${endDate}T23:59:59.999`);
    }
    if (search) {
      where.push(`(
        pt.id LIKE ?
        OR pt.providerTransactionId LIKE ?
        OR pt.saleId LIKE ?
        OR pt.error LIKE ?
        OR pa.name LIKE ?
      )`);
      const term = `%${search}%`;
      params.push(term, term, term, term, term);
    }

    const whereSql = where.join(' AND ');
    const transactions = db.prepare(`
      SELECT pt.*, pa.name as accountName, s.fiscalStatus
      FROM payment_transactions pt
      LEFT JOIN pix_accounts pa ON pa.id = pt.pixAccountId AND pa.establishmentId = pt.establishmentId
      LEFT JOIN sales s ON s.id = pt.saleId AND s.establishmentId = pt.establishmentId
      WHERE ${whereSql}
      ORDER BY pt.createdAt DESC
      LIMIT 250
    `).all(...params);

    const summary = db.prepare(`
      SELECT
        COUNT(*) as totalCount,
        COALESCE(SUM(pt.amount), 0) as totalAmount,
        SUM(CASE WHEN pt.status = 'paid' THEN 1 ELSE 0 END) as paidCount,
        COALESCE(SUM(CASE WHEN pt.status = 'paid' THEN pt.amount ELSE 0 END), 0) as paidAmount,
        SUM(CASE WHEN pt.status = 'pending' THEN 1 ELSE 0 END) as pendingCount,
        SUM(CASE WHEN pt.status = 'error' OR pt.error IS NOT NULL THEN 1 ELSE 0 END) as errorCount,
        SUM(CASE WHEN
          pt.error IS NOT NULL
          OR (pt.status = 'paid' AND pt.saleId IS NULL)
          OR (pt.status = 'processing' AND pt.saleId IS NULL)
          OR (pt.status = 'pending' AND pt.expiresAt IS NOT NULL AND pt.expiresAt < ?)
          THEN 1 ELSE 0 END) as attentionCount
      FROM payment_transactions pt
      LEFT JOIN pix_accounts pa ON pa.id = pt.pixAccountId AND pa.establishmentId = pt.establishmentId
      WHERE ${whereSql}
    `).get(new Date().toISOString(), ...params);

    res.json({
      transactions: transactions.map(sanitizePaymentTransactionForPanel),
      summary: {
        totalCount: Number(summary.totalCount || 0),
        totalAmount: Number(summary.totalAmount || 0),
        paidCount: Number(summary.paidCount || 0),
        paidAmount: Number(summary.paidAmount || 0),
        pendingCount: Number(summary.pendingCount || 0),
        errorCount: Number(summary.errorCount || 0),
        attentionCount: Number(summary.attentionCount || 0),
      },
    });
  } catch (err) {
    console.error('[Payment Transactions Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/transactions/:id/reconcile', authenticateToken, isGestor, requireOperationalSubscription, async (req, res) => {
  const estId = req.user.establishmentId;
  try {
    let transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?')
      .get(req.params.id, estId);
    if (!transaction) return res.status(404).json({ error: 'Transacao de pagamento nao encontrada.' });

    if (transaction.status === 'error' && !transaction.providerTransactionId) {
      return res.status(409).json({
        error: 'A cobranca falhou antes de ser criada no provedor. Inicie uma nova venda no PDV.',
      });
    }
    if (transaction.status === 'pending') {
      transaction = transaction.paymentMethod === 'card'
        ? await refreshCardTransactionFromProvider({ transaction, userId: req.user.id })
        : (await refreshPixTransactionFromProvider({ transaction, userId: req.user.id })).transaction;
    } else if (['paid', 'processing'].includes(transaction.status) && !transaction.saleId) {
      transaction = await finalizePaidTransaction({ transactionId: transaction.id, userId: req.user.id });
    }

    db.prepare('UPDATE payment_transactions SET error = NULL, updatedAt = ? WHERE id = ? AND establishmentId = ?')
      .run(new Date().toISOString(), transaction.id, estId);
    const detailed = db.prepare(`
      SELECT pt.*, pa.name as accountName, s.fiscalStatus
      FROM payment_transactions pt
      LEFT JOIN pix_accounts pa ON pa.id = pt.pixAccountId AND pa.establishmentId = pt.establishmentId
      LEFT JOIN sales s ON s.id = pt.saleId AND s.establishmentId = pt.establishmentId
      WHERE pt.id = ? AND pt.establishmentId = ?
    `).get(transaction.id, estId);
    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_transaction.reconciled',
      entityType: 'payment_transaction',
      entityId: transaction.id,
      metadata: { status: transaction.status, saleId: transaction.saleId || null },
    });
    res.json(sanitizePaymentTransactionForPanel(detailed));
  } catch (err) {
    db.prepare('UPDATE payment_transactions SET error = ?, updatedAt = ? WHERE id = ? AND establishmentId = ?')
      .run(err.message, new Date().toISOString(), req.params.id, estId);
    console.error('[Payment Reconciliation Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus } : '');
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/payments/card', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  let transactionId = null;
  try {
    const { items, totalAmount, accountId, paymentType, installments } = req.body;
    const estId = req.user.establishmentId;
    const preparedSale = validateSaleItemsForTenant(items, estId, { expectedTotal: totalAmount, useCurrentPrices: true });

    const account = accountId
      ? db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ? AND active = 1').get(accountId, estId)
      : db.prepare('SELECT * FROM pix_accounts WHERE establishmentId = ? AND active = 1 ORDER BY isDefault DESC, createdAt DESC LIMIT 1').get(estId);
    if (!account) return res.status(400).json({ error: 'Nenhuma conta de recebimento ativa configurada para cartao.' });

    const credentials = decodeCredentials(account.credentials);
    if (!credentials.supportsPoint) {
      return res.status(400).json({ error: 'Esta conta nao esta habilitada para pagamento em terminal.' });
    }
    if (!PROVIDERS[account.provider]?.supportsPoint) {
      return res.status(400).json({ error: 'Provider sem suporte a terminal/Point.' });
    }
    const paymentSelection = normalizePointPaymentSelection(
      paymentType || credentials.defaultType,
      installments || credentials.defaultInstallments
    );

    transactionId = uuidv4();
    const referenceId = makeProviderReference();
    const provider = getPointProvider(account.provider);
    const createdAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO payment_transactions (
        id, establishmentId, pixAccountId, provider, status, amount, paymentMethod,
        payload, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 'pending', ?, 'card', ?, ?, ?)
    `).run(
      transactionId,
      estId,
      account.id,
      account.provider,
      preparedSale.totalAmount,
      JSON.stringify({
        items: preparedSale.items,
        externalReference: referenceId,
        paymentType: paymentSelection.paymentType,
        installments: paymentSelection.installments,
      }),
      createdAt,
      createdAt
    );

    const order = await provider.createOrder({
      amount: preparedSale.totalAmount,
      referenceId,
      credentials,
      description: `Venda PDV ${transactionId}`,
      paymentType: paymentSelection.paymentType,
      installments: paymentSelection.installments,
    });

    db.prepare(`
      UPDATE payment_transactions
      SET providerTransactionId = ?, status = ?, payload = ?, expiresAt = ?, error = NULL, updatedAt = ?
      WHERE id = ?
    `).run(
      order.providerTransactionId,
      order.status,
      JSON.stringify({
        items: preparedSale.items,
        providerPaymentId: order.providerPaymentId || null,
        externalReference: order.externalReference || referenceId,
        paymentType: paymentSelection.paymentType,
        installments: paymentSelection.installments,
        providerPayload: order.payload || null,
      }),
      order.expiresAt || null,
      new Date().toISOString(),
      transactionId
    );

    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?').get(transactionId, estId);
    res.status(201).json(buildCardTransactionResponse(transaction, estId));
  } catch (err) {
    if (transactionId) {
      db.prepare(`
        UPDATE payment_transactions
        SET status = 'error', error = ?, updatedAt = ?
        WHERE id = ? AND saleId IS NULL
      `).run(err.message, new Date().toISOString(), transactionId);
    }
    console.error('[Card Create Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/payments/card/:id/status', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    let transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'card');
    if (!transaction) return res.status(404).json({ error: 'Transacao de cartao nao encontrada.' });

    if (transaction.status === 'pending') {
      transaction = await refreshCardTransactionFromProvider({ transaction, userId: req.user.id });
    } else if (['paid', 'processing'].includes(transaction.status) && !transaction.saleId) {
      transaction = await finalizePaidTransaction({ transactionId: transaction.id, userId: req.user.id });
    }

    res.json(buildCardTransactionResponse(transaction, estId));
  } catch (err) {
    db.prepare('UPDATE payment_transactions SET error = ?, updatedAt = ? WHERE id = ? AND establishmentId = ?')
      .run(err.message, new Date().toISOString(), req.params.id, req.user.establishmentId);
    console.error('[Card Status Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments/pix/:id/status', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    let transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?').get(req.params.id, estId);
    if (!transaction) return res.status(404).json({ error: 'Transacao Pix nao encontrada.' });

    let fiscalDocument = null;
    if (transaction.status === 'pending') {
      const refreshed = await refreshPixTransactionFromProvider({ transaction, userId: req.user.id });
      transaction = refreshed.transaction;
      fiscalDocument = refreshed.fiscalDocument;
    } else if (['paid', 'processing'].includes(transaction.status) && !transaction.saleId) {
      transaction = await finalizePaidTransaction({ transactionId: transaction.id, userId: req.user.id });
    }

    const responseStatus = transaction.status === 'processing' ? 'pending' : transaction.status;
    const responsePayload = parseTransactionPayload(transaction);
    const responseProviderPayload = responsePayload.latestProviderPayload || responsePayload.providerPayload || {};
    const responsePayment = responseProviderPayload.transactions?.payments?.[0] || {};
    if (!fiscalDocument && transaction.saleId) {
      fiscalDocument = db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1')
        .get(transaction.saleId, estId) || null;
    }

    res.json({
      id: transaction.id,
      status: responseStatus,
      saleId: transaction.saleId,
      fiscalDocument,
      paidAt: transaction.paidAt,
      amount: transaction.amount,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      providerPaymentId: responsePayload.providerPaymentId || responsePayment.id || null,
      externalReference: responsePayload.externalReference || responseProviderPayload.external_reference || null,
      paymentConfirmation: transaction.saleId ? getPaymentTransactionForSale(transaction.saleId, estId) : null,
      qrCode: transaction.qrCode,
      qrCodeBase64: transaction.qrCodeBase64,
      ticketUrl: transaction.ticketUrl,
      expiresAt: transaction.expiresAt,
    });
  } catch (err) {
    db.prepare('UPDATE payment_transactions SET error = ?, updatedAt = ? WHERE id = ? AND establishmentId = ?')
      .run(err.message, new Date().toISOString(), req.params.id, req.user.establishmentId);
    console.error('[Pix Status Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SUPER ADMIN — ESTABELECIMENTOS
// ==============================
// PAGAMENTOS PIX
app.post('/api/payments/pix/:id/cancel', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'pix');
    if (!transaction) return res.status(404).json({ error: 'Transacao Pix nao encontrada.' });
    if (transaction.status === 'paid') return res.status(409).json({ error: 'Nao e possivel cancelar um Pix ja pago.' });

    if (transaction.status !== 'pending') {
      return res.json({
        id: transaction.id,
        status: transaction.status === 'processing' ? 'pending' : transaction.status,
        saleId: transaction.saleId,
        paidAt: transaction.paidAt,
        amount: transaction.amount,
        provider: transaction.provider,
        providerTransactionId: transaction.providerTransactionId,
        qrCode: transaction.qrCode,
        qrCodeBase64: transaction.qrCodeBase64,
        ticketUrl: transaction.ticketUrl,
        expiresAt: transaction.expiresAt,
      });
    }

    const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(transaction.pixAccountId, estId);
    if (!account) return res.status(404).json({ error: 'Conta Pix da transacao nao encontrada.' });

    const provider = getPixProvider(account.provider);
    const cancelResult = provider.cancelCharge
      ? await provider.cancelCharge({ transaction, credentials: decodeCredentials(account.credentials) })
      : { status: 'cancelled', payload: { localOnly: true } };

    const currentPayload = JSON.parse(transaction.payload || '{}');
    const nextPayload = {
      ...currentPayload,
      providerPaymentId: cancelResult.providerPaymentId || currentPayload.providerPaymentId || null,
      externalReference: cancelResult.externalReference || currentPayload.externalReference || null,
      latestCancelProviderPayload: cancelResult.payload || null,
    };
    const status = cancelResult.status === 'paid' ? 'paid' : 'cancelled';
    const updatedAt = new Date().toISOString();
    db.prepare(`
      UPDATE payment_transactions
      SET status = ?, updatedAt = ?, payload = ?
      WHERE id = ? AND saleId IS NULL AND status = 'pending'
    `)
      .run(status, updatedAt, JSON.stringify(nextPayload), transaction.id);

    let latest = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id);
    if (latest.status === 'paid' && !latest.saleId) {
      latest = await finalizePaidTransaction({ transactionId: latest.id, userId: req.user.id });
    }
    const responseStatus = latest.status === 'processing' ? 'pending' : latest.status;
    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_transaction.cancel_requested',
      entityType: 'payment_transaction',
      entityId: latest.id,
      metadata: { paymentMethod: 'pix', status: responseStatus },
    });

    res.json({
      id: latest.id,
      status: responseStatus,
      saleId: latest.saleId,
      paidAt: latest.paidAt,
      amount: latest.amount,
      provider: latest.provider,
      providerTransactionId: latest.providerTransactionId,
      providerPaymentId: nextPayload.providerPaymentId || null,
      externalReference: nextPayload.externalReference || null,
      paymentConfirmation: latest.saleId ? getPaymentTransactionForSale(latest.saleId, estId) : null,
      qrCode: latest.qrCode,
      qrCodeBase64: latest.qrCodeBase64,
      ticketUrl: latest.ticketUrl,
      expiresAt: latest.expiresAt,
    });
  } catch (err) {
    console.error('[Pix Cancel Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/card/:id/cancel', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'card');
    if (!transaction) return res.status(404).json({ error: 'Transacao de cartao nao encontrada.' });
    if (transaction.status === 'paid' || transaction.saleId) {
      return res.status(409).json({ error: 'Nao e possivel cancelar um pagamento de cartao ja confirmado.' });
    }
    if (transaction.status !== 'pending') {
      return res.json(buildCardTransactionResponse(transaction, estId));
    }

    const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?')
      .get(transaction.pixAccountId, estId);
    if (!account) return res.status(404).json({ error: 'Conta da transacao nao encontrada.' });

    const provider = getPointProvider(account.provider);
    const cancelResult = provider.cancelOrder
      ? await provider.cancelOrder({ transaction, credentials: decodeCredentials(account.credentials) })
      : { status: 'cancelled', payload: { localOnly: true } };
    const currentPayload = parseTransactionPayload(transaction);
    const nextPayload = {
      ...currentPayload,
      latestCancelProviderPayload: cancelResult.payload || null,
    };
    db.prepare(`
      UPDATE payment_transactions
      SET status = ?, payload = ?, updatedAt = ?, error = NULL
      WHERE id = ? AND establishmentId = ? AND saleId IS NULL AND status = 'pending'
    `).run(
      cancelResult.status === 'paid' ? 'paid' : 'cancelled',
      JSON.stringify(nextPayload),
      new Date().toISOString(),
      transaction.id,
      estId
    );

    let latest = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?').get(transaction.id, estId);
    if (latest.status === 'paid' && !latest.saleId) {
      latest = await finalizePaidTransaction({ transactionId: latest.id, userId: req.user.id });
    }
    logAudit({
      req,
      establishmentId: estId,
      action: 'payment_transaction.cancel_requested',
      entityType: 'payment_transaction',
      entityId: latest.id,
      metadata: { paymentMethod: 'card', status: latest.status },
    });
    res.json(buildCardTransactionResponse(latest, estId));
  } catch (err) {
    console.error('[Card Cancel Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(err.providerStatus || 500).json({ error: err.message });
  }
});

app.post('/api/payments/card/:id/simulate', authenticateToken, isTenantUser, requireOperationalSubscription, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'card');
    if (!transaction) return res.status(404).json({ error: 'Transacao de cartao nao encontrada.' });
    if (transaction.status !== 'pending') return res.status(409).json({ error: 'Somente transacoes pendentes podem ser simuladas.' });

    const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?')
      .get(transaction.pixAccountId, estId);
    if (!account) return res.status(404).json({ error: 'Conta da transacao nao encontrada.' });
    const credentials = decodeCredentials(account.credentials);
    if (account.provider !== 'mercado_pago' || credentials.mpEnvironment === 'production') {
      return res.status(403).json({ error: 'A simulacao Point esta disponivel somente para conta Mercado Pago em ambiente de teste.' });
    }

    const provider = getPointProvider(account.provider);
    if (!provider.simulateStatus) return res.status(400).json({ error: 'Provider sem suporte a simulacao Point.' });
    const currentPayload = parseTransactionPayload(transaction);
    const simulation = await provider.simulateStatus({
      transaction,
      credentials,
      scenario: req.body?.scenario,
      paymentType: currentPayload.paymentType,
      installments: currentPayload.installments,
    });
    const nextPayload = {
      ...currentPayload,
      latestSimulationRequest: simulation.payload || null,
    };
    db.prepare(`
      UPDATE payment_transactions
      SET payload = ?, updatedAt = ?, error = NULL
      WHERE id = ? AND establishmentId = ? AND status = 'pending'
    `).run(JSON.stringify(nextPayload), new Date().toISOString(), transaction.id, estId);

    const latest = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?').get(transaction.id, estId);
    res.json(buildCardTransactionResponse(latest, estId));
  } catch (err) {
    console.error('[Card Simulation Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(err.providerStatus || 500).json({ error: err.message });
  }
});

// SUPER ADMIN - ESTABELECIMENTOS
app.get('/api/admin/plans', authenticateToken, isSuperAdmin, (req, res) => {
  res.json(getPlanCatalogList());
});

app.post('/api/admin/subscriptions/reconcile', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const summary = reconcileSubscriptions();
    res.json({ message: 'Assinaturas atualizadas.', summary });
  } catch (err) {
    console.error('[Subscription Reconciliation Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/stats', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const requestedPeriod = Number(req.query.periodDays || req.query.period || 30);
    const periodDays = [30, 90, 365].includes(requestedPeriod) ? requestedPeriod : 30;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const currentStart = new Date(now - periodDays * dayMs).toISOString();
    const previousStart = new Date(now - periodDays * 2 * dayMs).toISOString();
    const groupBy = periodDays > 90 ? "strftime('%Y-%m', paidAt)" : "date(paidAt)";

    const growthPct = (current, previous) => {
      if (!previous && !current) return 0;
      if (!previous) return 100;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const total = db.prepare('SELECT COUNT(*) as c FROM establishments').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'active'").get().c;
    const overdue = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'overdue'").get().c;
    const suspended = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'suspended'").get().c;
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND isDeleted = 0").get().c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as r FROM payments WHERE paidAt IS NOT NULL").get().r;
    const monthRevenue = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as r FROM payments WHERE paidAt IS NOT NULL AND paidAt >= ?"
    ).get(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).r;
    const periodRevenue = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as r FROM payments WHERE paidAt IS NOT NULL AND paidAt >= ?"
    ).get(currentStart).r;
    const previousPeriodRevenue = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as r FROM payments WHERE paidAt IS NOT NULL AND paidAt >= ? AND paidAt < ?"
    ).get(previousStart, currentStart).r;
    const newUsers = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND isDeleted = 0 AND createdAt >= ?"
    ).get(currentStart).c;
    const previousNewUsers = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND isDeleted = 0 AND createdAt >= ? AND createdAt < ?"
    ).get(previousStart, currentStart).c;
    const newEstablishments = db.prepare(
      "SELECT COUNT(*) as c FROM establishments WHERE createdAt >= ?"
    ).get(currentStart).c;
    const previousNewEstablishments = db.prepare(
      "SELECT COUNT(*) as c FROM establishments WHERE createdAt >= ? AND createdAt < ?"
    ).get(previousStart, currentStart).c;
    const mrr = db.prepare(
      "SELECT COALESCE(SUM(monthlyAmount), 0) as r FROM establishments WHERE subscriptionStatus = 'active'"
    ).get().r;
    const arpa = active > 0 ? mrr / active : 0;

    const revenueSeries = db.prepare(`
      SELECT ${groupBy} as label, COALESCE(SUM(amount), 0) as value
      FROM payments
      WHERE paidAt IS NOT NULL AND paidAt >= ?
      GROUP BY label
      ORDER BY label ASC
    `).all(currentStart);

    const newUsersSeries = db.prepare(`
      SELECT ${periodDays > 90 ? "strftime('%Y-%m', createdAt)" : "date(createdAt)"} as label, COUNT(*) as value
      FROM users
      WHERE role != 'superadmin' AND isDeleted = 0 AND createdAt >= ?
      GROUP BY label
      ORDER BY label ASC
    `).all(currentStart);

    const usersByEstablishment = db.prepare(`
      SELECT e.id, e.name, COUNT(u.id) as totalUsers
      FROM establishments e
      LEFT JOIN users u ON u.establishmentId = e.id AND u.isDeleted = 0 AND u.role != 'superadmin'
      GROUP BY e.id
      ORDER BY totalUsers DESC, e.name ASC
      LIMIT 10
    `).all();

    const topRevenueEstablishments = db.prepare(`
      SELECT e.id, e.name, COALESCE(SUM(p.amount), 0) as revenue
      FROM establishments e
      LEFT JOIN payments p ON p.establishmentId = e.id AND p.paidAt IS NOT NULL AND p.paidAt >= ?
      GROUP BY e.id
      ORDER BY revenue DESC, e.name ASC
      LIMIT 10
    `).all(currentStart);

    res.json({
      total,
      active,
      overdue,
      suspended,
      totalUsers,
      totalRevenue,
      monthRevenue,
      periodDays,
      periodRevenue,
      previousPeriodRevenue,
      revenueGrowthPct: growthPct(periodRevenue, previousPeriodRevenue),
      newUsers,
      previousNewUsers,
      userGrowthPct: growthPct(newUsers, previousNewUsers),
      newEstablishments,
      previousNewEstablishments,
      establishmentGrowthPct: growthPct(newEstablishments, previousNewEstablishments),
      mrr,
      arpa,
      revenueSeries,
      newUsersSeries,
      usersByEstablishment,
      topRevenueEstablishments,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/business-insights', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const requestedPeriod = Number(req.query.periodDays || req.query.period || 30);
    const periodDays = [30, 90, 365].includes(requestedPeriod) ? requestedPeriod : 30;
    const dayMs = 24 * 60 * 60 * 1000;
    const currentStart = new Date(Date.now() - periodDays * dayMs).toISOString();
    const previousStart = new Date(Date.now() - periodDays * 2 * dayMs).toISOString();

    const growthPct = (current, previous) => {
      if (!previous && !current) return 0;
      if (!previous) return 100;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const establishments = db.prepare('SELECT * FROM establishments ORDER BY name ASC').all();
    const salesStmt = db.prepare(`
      SELECT COUNT(*) as salesCount, COALESCE(SUM(totalAmount), 0) as revenue, COALESCE(AVG(totalAmount), 0) as averageTicket
      FROM sales
      WHERE establishmentId = ? AND createdAt >= ?
    `);
    const previousSalesStmt = db.prepare(`
      SELECT COUNT(*) as salesCount, COALESCE(SUM(totalAmount), 0) as revenue
      FROM sales
      WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ?
    `);
    const productStmt = db.prepare(`
      SELECT
        COUNT(*) as productCount,
        SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END) as lowStockCount,
        SUM(CASE WHEN stock <= 0 THEN 1 ELSE 0 END) as outOfStockCount
      FROM products
      WHERE establishmentId = ?
    `);
    const userStmt = db.prepare(`
      SELECT
        COUNT(*) as userCount,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as activeUsers
      FROM users
      WHERE establishmentId = ? AND isDeleted = 0 AND role != 'superadmin'
    `);
    const lastSaleStmt = db.prepare('SELECT createdAt FROM sales WHERE establishmentId = ? ORDER BY createdAt DESC LIMIT 1');
    const topProductStmt = db.prepare(`
      SELECT si.name, SUM(si.quantity) as quantity, COALESCE(SUM(si.totalPrice), 0) as revenue
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.establishmentId = ? AND s.createdAt >= ?
      GROUP BY si.name
      ORDER BY quantity DESC, revenue DESC
      LIMIT 5
    `);

    const rawBusinesses = establishments.map(est => {
      const current = salesStmt.get(est.id, currentStart);
      const previous = previousSalesStmt.get(est.id, previousStart, currentStart);
      const products = productStmt.get(est.id);
      const users = userStmt.get(est.id);
      const lastSale = lastSaleStmt.get(est.id);
      const topProducts = topProductStmt.all(est.id, currentStart);

      return {
        id: est.id,
        name: est.name,
        ownerName: est.ownerName,
        plan: est.plan,
        subscriptionStatus: est.subscriptionStatus,
        monthlyAmount: est.monthlyAmount || 0,
        periodRevenue: current.revenue || 0,
        previousPeriodRevenue: previous.revenue || 0,
        revenueGrowthPct: growthPct(current.revenue || 0, previous.revenue || 0),
        salesCount: current.salesCount || 0,
        previousSalesCount: previous.salesCount || 0,
        salesGrowthPct: growthPct(current.salesCount || 0, previous.salesCount || 0),
        averageTicket: current.averageTicket || 0,
        productCount: products.productCount || 0,
        lowStockCount: products.lowStockCount || 0,
        outOfStockCount: products.outOfStockCount || 0,
        userCount: users.userCount || 0,
        activeUsers: users.activeUsers || 0,
        lastSaleAt: lastSale?.createdAt || null,
        topProducts,
      };
    });

    const maxRevenue = Math.max(...rawBusinesses.map(b => b.periodRevenue), 1);
    const maxSales = Math.max(...rawBusinesses.map(b => b.salesCount), 1);
    const maxUsers = Math.max(...rawBusinesses.map(b => b.activeUsers), 1);

    const businesses = rawBusinesses.map(b => {
      const revenueScore = (b.periodRevenue / maxRevenue) * 38;
      const salesScore = (b.salesCount / maxSales) * 24;
      const userScore = (b.activeUsers / maxUsers) * 14;
      const growthScore = Math.max(-10, Math.min(14, b.revenueGrowthPct / 4));
      const activityScore = b.lastSaleAt ? 10 : 0;
      const stockPenalty = Math.min(12, b.lowStockCount * 1.5 + b.outOfStockCount * 2);
      const statusPenalty = b.subscriptionStatus === 'suspended' ? 18 : b.subscriptionStatus === 'overdue' ? 8 : 0;
      const healthScore = Math.max(0, Math.min(100, Math.round(revenueScore + salesScore + userScore + growthScore + activityScore - stockPenalty - statusPenalty)));

      return { ...b, healthScore };
    }).sort((a, b) => b.healthScore - a.healthScore || b.periodRevenue - a.periodRevenue);

    const totalRevenue = businesses.reduce((sum, b) => sum + b.periodRevenue, 0);
    const totalSales = businesses.reduce((sum, b) => sum + b.salesCount, 0);
    const activeBusinesses = businesses.filter(b => b.salesCount > 0).length;
    const lowStockBusinesses = businesses.filter(b => b.lowStockCount > 0 || b.outOfStockCount > 0).length;

    res.json({
      periodDays,
      summary: {
        totalBusinesses: businesses.length,
        activeBusinesses,
        totalRevenue,
        totalSales,
        averageTicket: totalSales > 0 ? totalRevenue / totalSales : 0,
        lowStockBusinesses,
      },
      businesses,
      topFive: businesses.slice(0, 5),
      bottomFive: [...businesses].sort((a, b) => a.healthScore - b.healthScore || a.periodRevenue - b.periodRevenue).slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/audit-logs', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 80), 1), 250);
    const establishmentId = String(req.query.establishmentId || '').trim();
    const params = [];
    let where = '';
    if (establishmentId) {
      where = 'WHERE al.establishmentId = ?';
      params.push(establishmentId);
    }
    const rows = db.prepare(`
      SELECT al.*, e.name as establishmentName, u.name as actorName, u.username as actorUsername
      FROM audit_logs al
      LEFT JOIN establishments e ON e.id = al.establishmentId
      LEFT JOIN users u ON u.id = al.actorUserId
      ${where}
      ORDER BY al.createdAt DESC
      LIMIT ?
    `).all(...params, limit);
    res.json(rows.map(row => {
      let metadata = {};
      try { metadata = JSON.parse(row.metadata || '{}'); } catch {}
      return { ...row, metadata };
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/establishments', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const ests = db.prepare('SELECT * FROM establishments ORDER BY createdAt DESC').all();
    const result = ests.map(est => {
      const userCount = db.prepare(
        "SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND isDeleted = 0 AND role != 'superadmin'"
      ).get(est.id).c;
      const salesCount = db.prepare("SELECT COUNT(*) as c FROM sales WHERE establishmentId = ?").get(est.id).c;
      const revenueMonth = db.prepare(
        "SELECT COALESCE(SUM(totalAmount), 0) as r FROM sales WHERE establishmentId = ? AND createdAt >= ?"
      ).get(est.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()).r;
      const lastPayment = db.prepare(
        "SELECT paidAt, amount FROM payments WHERE establishmentId = ? AND paidAt IS NOT NULL ORDER BY paidAt DESC LIMIT 1"
      ).get(est.id);
      return {
        ...est,
        plan: normalizePlan(est.plan),
        planDefinition: getPlanDefinition(est.plan),
        billing: getSubscriptionBilling(est),
        onboarding: getEstablishmentOnboarding(est),
        usage: getTenantUsage(est.id),
        userCount,
        salesCount,
        revenueMonth,
        lastPayment,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/establishments', authenticateToken, isSuperAdmin, (req, res) => {
  const { name, loginCode, ownerName, email, phone, plan, monthlyAmount, subscriptionDueDate, subscriptionGraceDays, gestorUsername, gestorPassword, gestorName } = req.body;
  if (!name || !gestorUsername || !gestorPassword || !gestorName) {
    return res.status(400).json({ error: 'Nome do estabelecimento, login, senha e nome do gestor são obrigatórios.' });
  }
  const normalizedLoginCode = normalizeEstablishmentCode(loginCode || name);
  if (normalizedLoginCode.length < 3) {
    return res.status(400).json({ error: 'O codigo do estabelecimento deve possuir ao menos 3 caracteres.' });
  }
  const usernameResult = validateUsername(gestorUsername);
  if (!usernameResult.valid) return res.status(400).json({ error: usernameResult.error });
  const passwordResult = validatePassword(gestorPassword);
  if (!passwordResult.valid) return res.status(400).json({ error: passwordResult.error });

  const estId = uuidv4();
  const gestorId = uuidv4();
  const now = new Date().toISOString();
  const normalizedPlan = normalizePlan(plan || 'basic');
  const graceDays = normalizeGraceDays(subscriptionGraceDays, DEFAULT_SUBSCRIPTION_GRACE_DAYS);
  // Assinatura mensal: vence no mesmo dia do mês seguinte
  const dueDate = subscriptionDueDate || addOneMonth(now);

  try {
    const createEstAndGestor = db.transaction(() => {
      db.prepare(`INSERT INTO establishments (
        id, name, loginCode, ownerName, email, phone, plan, monthlyAmount,
        subscriptionStatus, subscriptionDueDate, subscriptionGraceDays, subscriptionStatusUpdatedAt, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
        .run(estId, name, normalizedLoginCode, ownerName || gestorName, email || null, phone || null, normalizedPlan,
          parseFloat(monthlyAmount) || 0, dueDate, graceDays, now, now);
      db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt)
        VALUES (?, ?, ?, ?, 'gestor', ?, 1, 0, ?)`)
        .run(gestorId, usernameResult.username, bcrypt.hashSync(passwordResult.password, 10), gestorName.trim(), estId, now);
    });
    createEstAndGestor();
    getTenantSettings(estId);
    ensureFiscalSettings(estId);
    reconcileSubscriptions();
    createNotification({
      establishmentId: estId,
      audience: 'gestor',
      type: 'onboarding_started',
      title: 'Conta pronta para configuracao',
      message: 'Seu acesso foi criado. Cadastre os primeiros produtos e configure os recebimentos conforme a operacao do estabelecimento.',
      referenceType: 'establishment',
      referenceId: `${estId}:onboarding`,
    });
    const createdEstablishment = ensureEstablishmentExists(estId);
    const onboarding = getEstablishmentOnboarding(createdEstablishment);
    logAudit({
      req,
      establishmentId: estId,
      action: 'establishment.created',
      entityType: 'establishment',
      entityId: estId,
      metadata: { name, loginCode: normalizedLoginCode, plan: normalizedPlan, graceDays, gestorUsername: usernameResult.username },
    });
    res.status(201).json({
      id: estId,
      loginCode: normalizedLoginCode,
      gestorUsername: usernameResult.username,
      onboarding,
      message: 'Estabelecimento criado com sucesso!',
    });
  } catch (err) {
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Codigo do estabelecimento ou login do gestor ja esta em uso.' });
    }
    res.status(500).json({ error: 'Erro ao criar estabelecimento.' });
  }
});

app.put('/api/admin/establishments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { name, loginCode, ownerName, email, phone, plan, monthlyAmount, subscriptionStatus, subscriptionDueDate, subscriptionGraceDays, notes } = req.body;
  try {
    const current = ensureEstablishmentExists(id);
    if (!current) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    const normalizedLoginCode = normalizeEstablishmentCode(loginCode || current.loginCode || name);
    if (normalizedLoginCode.length < 3) {
      return res.status(400).json({ error: 'O codigo do estabelecimento deve possuir ao menos 3 caracteres.' });
    }
    const normalizedPlan = normalizePlan(plan || 'basic');
    const normalizedStatus = normalizeSubscriptionStatus(subscriptionStatus || 'active');
    const graceDays = normalizeGraceDays(subscriptionGraceDays, current.subscriptionGraceDays ?? DEFAULT_SUBSCRIPTION_GRACE_DAYS);
    const statusReason = normalizedStatus === 'suspended' ? 'manual' : null;
    const statusUpdatedAt = new Date().toISOString();
    db.prepare(`UPDATE establishments SET name=?, loginCode=?, ownerName=?, email=?, phone=?, plan=?, monthlyAmount=?,
      subscriptionStatus=?, subscriptionDueDate=?, subscriptionGraceDays=?, subscriptionStatusReason=?, subscriptionStatusUpdatedAt=?, notes=? WHERE id=?`)
      .run(name, normalizedLoginCode, ownerName, email, phone, normalizedPlan, parseFloat(monthlyAmount) || 0,
        normalizedStatus, subscriptionDueDate, graceDays, statusReason, statusUpdatedAt, notes || null, id);
    reconcileSubscriptions();
    logAudit({
      req,
      establishmentId: id,
      action: 'establishment.updated',
      entityType: 'establishment',
      entityId: id,
      metadata: { loginCode: normalizedLoginCode, plan: normalizedPlan, subscriptionStatus: normalizedStatus, graceDays, monthlyAmount: parseFloat(monthlyAmount) || 0 },
    });
    res.json({ message: 'Estabelecimento atualizado!' });
  } catch (err) {
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Este codigo de estabelecimento ja esta em uso.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/establishments/:id/subscription', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { subscriptionStatus, subscriptionDueDate, subscriptionGraceDays } = req.body;
  try {
    const current = ensureEstablishmentExists(id);
    if (!current) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    const normalizedStatus = normalizeSubscriptionStatus(subscriptionStatus || 'active');
    const graceDays = normalizeGraceDays(subscriptionGraceDays, current.subscriptionGraceDays ?? DEFAULT_SUBSCRIPTION_GRACE_DAYS);
    const statusReason = normalizedStatus === 'suspended' ? 'manual' : null;
    const statusUpdatedAt = new Date().toISOString();
    db.prepare(`UPDATE establishments SET subscriptionStatus=?, subscriptionDueDate=?, subscriptionGraceDays=?,
      subscriptionStatusReason=?, subscriptionStatusUpdatedAt=? WHERE id=?`)
      .run(normalizedStatus, subscriptionDueDate, graceDays, statusReason, statusUpdatedAt, id);
    reconcileSubscriptions();
    logAudit({
      req,
      establishmentId: id,
      action: 'subscription.updated',
      entityType: 'establishment',
      entityId: id,
      metadata: { subscriptionStatus: normalizedStatus, subscriptionDueDate, graceDays, statusReason },
    });
    res.json({ message: 'Assinatura atualizada!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/establishments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  try {
    const est = db.prepare('SELECT * FROM establishments WHERE id = ?').get(id);
    if (!est) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
    const dependencies = {
      products: db.prepare('SELECT COUNT(*) as count FROM products WHERE establishmentId = ?').get(id).count,
      sales: db.prepare('SELECT COUNT(*) as count FROM sales WHERE establishmentId = ?').get(id).count,
      paymentAccounts: db.prepare('SELECT COUNT(*) as count FROM pix_accounts WHERE establishmentId = ?').get(id).count,
      paymentTransactions: db.prepare('SELECT COUNT(*) as count FROM payment_transactions WHERE establishmentId = ?').get(id).count,
      payments: db.prepare('SELECT COUNT(*) as count FROM payments WHERE establishmentId = ?').get(id).count,
    };
    if (Object.values(dependencies).some(count => count > 0)) {
      return res.status(409).json({
        error: 'Este estabelecimento possui dados operacionais. Suspenda a assinatura para preservar o historico.',
        dependencies,
      });
    }

    const fiscal = db.prepare('SELECT certificatePath FROM fiscal_settings WHERE establishmentId = ?').get(id);
    const removeEstablishment = db.transaction(() => {
      db.prepare('DELETE FROM notifications WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM ai_reports WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM ai_suggestions WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM tenant_settings WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM fiscal_settings WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM users WHERE establishmentId = ?').run(id);
      db.prepare('DELETE FROM establishments WHERE id = ?').run(id);
    });
    removeEstablishment();
    if (fiscal?.certificatePath) {
      try { removeManagedCertificate(fiscal.certificatePath); } catch (error) {
        console.warn('[Establishment Delete] Certificado nao removido:', error.message);
      }
    }
    logAudit({
      req,
      establishmentId: id,
      action: 'establishment.deleted',
      entityType: 'establishment',
      entityId: id,
      metadata: { name: est.name },
    });
    res.json({ message: 'Estabelecimento removido!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/establishments/:id/users', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const users = db.prepare(
      "SELECT id, username, name, role, active, createdAt FROM users WHERE establishmentId = ? AND isDeleted = 0 ORDER BY role, name"
    ).all(req.params.id);
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/establishments/:id/users', authenticateToken, isSuperAdmin, (req, res) => {
  const { id: establishmentId } = req.params;
  const { username, password, name } = req.body || {};
  const establishment = ensureEstablishmentExists(establishmentId);
  if (!establishment) return res.status(404).json({ error: 'Estabelecimento nao encontrado.' });
  if (!String(name || '').trim()) return res.status(400).json({ error: 'Nome obrigatorio.' });

  const usernameResult = validateUsername(username);
  if (!usernameResult.valid) return res.status(400).json({ error: usernameResult.error });
  const passwordResult = validatePassword(password);
  if (!passwordResult.valid) return res.status(400).json({ error: passwordResult.error });

  try {
    const usage = getTenantUsage(establishmentId);
    enforcePlanLimit(establishmentId, 'maxUsers', usage.users);
    enforcePlanLimit(establishmentId, 'maxOperators', usage.operators);

    const userId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, authVersion, createdAt)
      VALUES (?, ?, ?, ?, 'operador', ?, 1, 0, 0, ?)
    `).run(
      userId,
      usernameResult.username,
      bcrypt.hashSync(passwordResult.password, 10),
      String(name).trim(),
      establishmentId,
      now
    );
    logAudit({
      req,
      establishmentId,
      action: 'user.created_by_superadmin',
      entityType: 'user',
      entityId: userId,
      metadata: { username: usernameResult.username, role: 'operador' },
    });
    res.status(201).json({
      message: 'Funcionario criado com sucesso.',
      user: {
        id: userId,
        username: usernameResult.username,
        name: String(name).trim(),
        role: 'operador',
        active: 1,
        createdAt: now,
      },
    });
  } catch (err) {
    if (err.planLimit) return sendPlanLimitError(res, err);
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Este login ja esta em uso neste estabelecimento.' });
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.patch('/api/admin/users/:id/password', authenticateToken, isSuperAdmin, (req, res) => {
  const passwordResult = validatePassword(req.body?.newPassword);
  if (!passwordResult.valid) return res.status(400).json({ error: passwordResult.error });

  try {
    const user = db.prepare(
      "SELECT id, username, role, establishmentId FROM users WHERE id = ? AND role != 'superadmin' AND isDeleted = 0"
    ).get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario nao encontrado.' });

    db.prepare('UPDATE users SET password = ?, authVersion = authVersion + 1 WHERE id = ?')
      .run(bcrypt.hashSync(passwordResult.password, 10), user.id);
    logAudit({
      req,
      establishmentId: user.establishmentId,
      action: 'user.password_reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { username: user.username, invalidatedSessions: true },
    });
    res.json({ message: 'Senha redefinida. As sessoes anteriores do usuario foram encerradas.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// COBRANÇAS / PAGAMENTOS
// ==============================
app.get('/api/admin/establishments/:id/payments', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const payments = db.prepare(
      'SELECT * FROM payments WHERE establishmentId = ? ORDER BY createdAt DESC'
    ).all(req.params.id);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/establishments/:id/payments', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { amount, notes } = req.body;
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Valor do pagamento é obrigatório.' });
  }

  try {
    const est = db.prepare('SELECT * FROM establishments WHERE id = ?').get(id);
    if (!est) return res.status(404).json({ error: 'Estabelecimento não encontrado.' });

    const now = new Date().toISOString();
    const currentDueDate = est.subscriptionDueDate || now;
    const newDueDate = addOneMonth(currentDueDate);
    const paymentId = uuidv4();
    const billingAfterPayment = evaluateSubscription({
      dueDate: newDueDate,
      currentStatus: est.subscriptionStatus,
      statusReason: est.subscriptionStatusReason,
      graceDays: est.subscriptionGraceDays ?? DEFAULT_SUBSCRIPTION_GRACE_DAYS,
      now,
    });

    const registerPayment = db.transaction(() => {
      // Registrar pagamento
      db.prepare(`INSERT INTO payments (id, establishmentId, amount, dueDate, paidAt, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(paymentId, id, parseFloat(amount), currentDueDate, now, notes || null, now);
      // Avanca um ciclo e recalcula o status; dividas antigas continuam visiveis.
      db.prepare(`UPDATE establishments SET subscriptionDueDate = ?, subscriptionStatus = ?,
        subscriptionStatusReason = ?, subscriptionStatusUpdatedAt = ? WHERE id = ?`)
        .run(newDueDate, billingAfterPayment.status, billingAfterPayment.reason || null, now, id);
    });
    registerPayment();
    logAudit({
      req,
      establishmentId: id,
      action: 'platform_payment.registered',
      entityType: 'payment',
      entityId: paymentId,
      metadata: {
        amount: parseFloat(amount),
        previousDueDate: currentDueDate,
        newDueDate,
        subscriptionStatus: billingAfterPayment.status,
        notes: notes || null,
      },
    });

    createNotification({
      establishmentId: id,
      audience: 'gestor',
      type: 'subscription_payment_registered',
      title: 'Pagamento da mensalidade registrado',
      message: `Pagamento de R$ ${parseFloat(amount).toFixed(2).replace('.', ',')} confirmado. Novo vencimento em ${new Date(newDueDate).toLocaleDateString('pt-BR')}.`,
      referenceType: 'payment',
      referenceId: paymentId,
    });

    res.status(201).json({
      message: 'Pagamento registrado! Próximo vencimento: ' + new Date(newDueDate).toLocaleDateString('pt-BR'),
      newDueDate,
      subscriptionStatus: billingAfterPayment.status,
      paymentId,
    });
  } catch (err) {
    console.error('[Payment Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/payments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
    if (payment) {
      logAudit({
        req,
        establishmentId: payment.establishmentId,
        action: 'platform_payment.deleted',
        entityType: 'payment',
        entityId: req.params.id,
        metadata: { amount: payment.amount, paidAt: payment.paidAt },
      });
    }
    res.json({ message: 'Pagamento removido!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ROTAS DE IA
// ==============================
app.get('/api/ai/stock-predictions', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const f = estFilterWhere(req);
    const products = db.prepare(`SELECT * FROM products ${f.clause}`).all(...f.params);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const estClause = req.user.role !== 'superadmin' ? 'AND s.establishmentId = ?' : '';
    const estParams = req.user.role !== 'superadmin' ? [req.user.establishmentId] : [];

    const salesInPeriod = db.prepare(`
      SELECT si.productId, SUM(si.quantity) as totalSold
      FROM sale_items si INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ? ${estClause} GROUP BY si.productId
    `).all(thirtyDaysAgo.toISOString(), ...estParams);

    const salesMap = {};
    salesInPeriod.forEach(s => { salesMap[s.productId] = s.totalSold; });

    const predictions = products.map(product => {
      const totalSold = salesMap[product.id] || 0;
      const dailyRate = totalSold / 30;
      const daysUntilStockout = dailyRate > 0 ? Math.round(product.stock / dailyRate) : null;
      const suggestedOrder = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * 7) - product.stock) : 0;
      let urgency = 'ok';
      if (daysUntilStockout !== null) {
        if (daysUntilStockout <= 3) urgency = 'critical';
        else if (daysUntilStockout <= 7) urgency = 'warning';
        else if (daysUntilStockout <= 14) urgency = 'attention';
      }
      return { id: product.id, name: product.name, category: product.category, currentStock: product.stock, totalSold30d: totalSold, dailyRate: Math.round(dailyRate * 10) / 10, daysUntilStockout, suggestedOrder, urgency };
    }).filter(p => p.urgency !== 'ok').sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999));

    res.json(predictions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ai/reports', authenticateToken, isGestorOrAbove, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      return res.status(403).json({ error: 'Relatorios de IA sao por estabelecimento.' });
    }
    const periodType = req.query.period === 'weekly' ? 'weekly' : 'daily';
    const report = await generateAiReport({ estId: req.user.establishmentId, periodType });
    res.json(report);
  } catch (err) {
    console.error('[AI Report Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/chat', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Chat de IA foi desativado. Use os relatorios gerenciais.' });
});

app.post('/api/ai/cross-sell', authenticateToken, (req, res) => {
  res.status(410).json({ error: 'Sugestoes de IA no PDV foram desativadas. Use os relatorios gerenciais.' });
});

app.get('/api/ai/suggestions', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const f = estFilterWhere(req);
    res.json(db.prepare(`SELECT * FROM ai_suggestions ${f.clause} ORDER BY count DESC, updatedAt DESC`).all(...f.params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/suggestions/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    if (req.user.role === 'superadmin') {
      db.prepare('DELETE FROM ai_suggestions WHERE id = ?').run(req.params.id);
    } else {
      db.prepare('DELETE FROM ai_suggestions WHERE id = ? AND establishmentId = ?').run(req.params.id, req.user.establishmentId);
    }
    res.json({ message: 'Sugestão removida!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// HEALTH CHECK
// ==============================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: NODE_ENV, timestamp: new Date().toISOString() });
});

app.get('/api/session', authenticateToken, (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota da API nao encontrada.' });
});

let lastScheduledMinute = '';
const scheduledReportsTimer = setInterval(() => {
  const now = new Date();
  const key = now.toISOString().slice(0, 16);
  if (key === lastScheduledMinute) return;
  lastScheduledMinute = key;

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;

  if (time === '03:00') {
    generateScheduledAiReports('daily');
    if (now.getDay() === 1) generateScheduledAiReports('weekly');
  }
  if (time === '06:00') {
    publishScheduledReportNotifications('daily');
    if (now.getDay() === 1) publishScheduledReportNotifications('weekly');
  }
}, 60 * 1000);
scheduledReportsTimer.unref();

const startSubscriptionReconciliation = () => {
  const run = () => {
    try {
      const summary = reconcileSubscriptions();
      if (summary.changed > 0) {
        console.log('[Subscriptions] Reconciliacao concluida:', summary);
      }
    } catch (err) {
      console.error('[Subscriptions] Falha na reconciliacao:', err.message);
    }
  };
  run();
  const timer = setInterval(run, SUBSCRIPTION_RECONCILIATION_INTERVAL_MS);
  timer.unref();
  return timer;
};

if (NODE_ENV === 'production') {
  app.use((req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

const startServer = ({ port = PORT, host = HOST } = {}) => app.listen(port, host, () => {
  console.log(`[Payments] Confirmacao por polling a cada ${PAYMENT_POLLING_INTERVAL_MS}ms`);
  console.log(`Servidor rodando em http://${host}:${port} [${NODE_ENV}]`);
});

if (require.main === module) {
  startSubscriptionReconciliation();
  startServer();
  process.on('SIGTERM', () => { console.log('SIGTERM. Encerrando...'); process.exit(0); });
  process.on('SIGINT', () => { console.log('SIGINT. Encerrando...'); process.exit(0); });
}

module.exports = { app, reconcileSubscriptions, startServer };
