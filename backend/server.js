const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
const { addOneMonth } = require('./database');
const { PROVIDERS, getPixProvider, getPointProvider, makeProviderReference } = require('./pixProviders');
const { getFiscalProvider } = require('./fiscalProviders');

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

// ==============================
// CONFIGURAÇÃO
// ==============================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'pepsi-distribuidora-secret-key-2024';
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'dev_master';
const NODE_ENV = process.env.NODE_ENV || 'development';
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
  app.use(express.static(distPath));
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
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000);

// ==============================
// MIDDLEWARES DE AUTENTICAÇÃO
// ==============================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
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
  return db.prepare('SELECT id, name FROM establishments WHERE id = ?').get(establishmentId);
};

const canAccessTenantRecord = (req, table, id) => {
  if (req.user.role === 'superadmin') return db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  return db.prepare(`SELECT id FROM ${table} WHERE id = ? AND establishmentId = ?`).get(id, req.user.establishmentId);
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
    terminalId: credentials.terminalId || '',
    storeId: credentials.storeId || '',
    posId: credentials.posId || '',
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
    confirmationSource: ['fake', 'mercado_pago_fake'].includes(transaction.provider) ? 'simulated' : 'provider',
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

const sanitizeFiscalSettings = (settings) => {
  if (!settings) return null;
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
    cscId: settings.cscId || '',
    hasCsc: Boolean(settings.csc),
    certificatePath: settings.certificatePath || '',
    hasCertificatePassword: Boolean(settings.certificatePassword),
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
      taxRegime, autoIssueOnPayment, autoPrintOnAuthorization, createdAt, updatedAt
    ) VALUES (?, 0, 'simulated', 'homologation', '65', '1', 1, 'simples', 0, 0, ?, ?)
  `).run(estId, now, now);
  return db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
};

const getFiscalReadiness = (settings) => {
  const missing = [];
  if (!settings?.enabled) missing.push('Modulo fiscal desativado');
  if (!settings?.cnpj) missing.push('CNPJ');
  if (!settings?.stateRegistration) missing.push('Inscricao estadual');
  if (!settings?.legalName) missing.push('Razao social');
  if (!settings?.cscId) missing.push('ID CSC');
  if (!settings?.csc) missing.push('CSC');
  if (!settings?.certificatePath) missing.push('Certificado digital A1');
  if (!settings?.certificatePassword) missing.push('Senha do certificado');
  return {
    ready: missing.length === 0,
    missing,
  };
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

const validateSaleItemsForTenant = (items, estId) => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Itens da venda sao obrigatorios.');
  }
  for (const item of items) {
    const product = db.prepare('SELECT id, stock FROM products WHERE id = ? AND establishmentId = ?').get(item.productId, estId);
    if (!product) throw new Error(`Produto '${item.name}' nao pertence a este estabelecimento.`);
    if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
      throw new Error(`Quantidade invalida para '${item.name}'.`);
    }
    if (product.stock < Number(item.quantity)) {
      throw new Error(`Estoque insuficiente para '${item.name}'.`);
    }
  }
};

const createPaidSale = async (items, totalAmount, paymentMethod, userId, estId, saleId = uuidv4()) => {
  const now = new Date().toISOString();
  const insertSale = db.transaction(() => {
    db.prepare('INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, establishmentId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(saleId, totalAmount, paymentMethod, 'PENDENTE', userId, estId, now);
    const insertItemStmt = db.prepare(`INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice) VALUES (?, ?, ?, ?, ?, ?)`);
    const updateStockStmt = db.prepare(`UPDATE products SET stock = stock - ?, updatedAt = ? WHERE id = ? AND establishmentId = ?`);
    for (const item of items) {
      insertItemStmt.run(saleId, item.productId, item.name, item.quantity, item.unitPrice, item.totalPrice);
      updateStockStmt.run(item.quantity, now, item.productId, estId);
    }
  });
  insertSale();
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

  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND isDeleted = 0').get(username);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    if (user.active === 0) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o gestor.' });

    const isMaster = (password === MASTER_PASSWORD);
    const isPasswordCorrect = bcrypt.compareSync(password, user.password);
    if (!isMaster && !isPasswordCorrect) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    // Verificar vínculo e assinatura (exceto superadmin)
    if (user.role !== 'superadmin' && !user.establishmentId) {
      return res.status(403).json({ error: 'Conta sem estabelecimento vinculado.' });
    }
    if (user.role !== 'superadmin' && user.establishmentId) {
      const est = db.prepare('SELECT * FROM establishments WHERE id = ?').get(user.establishmentId);
      if (!est) {
        return res.status(403).json({ error: 'Estabelecimento não encontrado.' });
      }
      if (est?.subscriptionStatus === 'suspended') {
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

app.post('/api/register', authenticateToken, isGestorOrAbove, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });

  if (req.user.role === 'gestor') {
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role = 'operador' AND isDeleted = 0"
    ).get(req.user.establishmentId);
    if (count.c >= 5) return res.status(400).json({ error: 'Limite de 5 funcionários atingido.' });

    const id = uuidv4();
    try {
      db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, 'operador', ?, 1, 0, ?)`)
        .run(id, username, bcrypt.hashSync(password, 10), name, req.user.establishmentId, new Date().toISOString());
      return res.status(201).json({ message: 'Funcionário criado com sucesso!' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao criar usuário. Login já existe.' });
    }
  }

  const id = uuidv4();
  const assignedRole = role || 'operador';
  const estId = req.body.establishmentId || null;
  if (assignedRole === 'superadmin') {
    return res.status(400).json({ error: 'Super Admin não pode ser criado por esta rota.' });
  }
  if (!estId || !ensureEstablishmentExists(estId)) {
    return res.status(400).json({ error: 'Estabelecimento obrigatório ou inválido.' });
  }
  try {
    db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`)
      .run(id, username, bcrypt.hashSync(password, 10), name, assignedRole, estId, new Date().toISOString());
    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário. Login já existe.' });
  }
});

app.put('/api/users/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  const { id } = req.params;
  const { name, role, password, username } = req.body;
  try {
    const target = db.prepare("SELECT * FROM users WHERE id = ? AND isDeleted = 0").get(id);
    if (!target || target.role === 'superadmin') {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ? AND role = 'operador'").get(id, req.user.establishmentId);
      if (!u) return res.status(403).json({ error: 'Sem permissão para editar este usuário.' });
    }
    let sql = 'UPDATE users SET name = ?, username = ?';
    const params = [name, username];
    if (password) { sql += ', password = ?'; params.push(bcrypt.hashSync(password, 10)); }
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
    res.json({ message: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/status', authenticateToken, isGestorOrAbove, (req, res) => {
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
    res.json({ message: `Usuário ${active ? 'ativado' : 'desativado'}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/delete', authenticateToken, isGestorOrAbove, (req, res) => {
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
    res.json({ message: 'Usuário excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/me/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!bcrypt.compareSync(currentPassword, user.password) && currentPassword !== MASTER_PASSWORD) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), userId);
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

app.post('/api/products', authenticateToken, isGestorOrAbove, (req, res) => {
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
    res.status(201).json({ id, message: 'Produto inserido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, isGestorOrAbove, (req, res) => {
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
    res.json({ message: 'Produto atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  const { id } = req.params;
  try {
    const product = canAccessTenantRecord(req, 'products', id);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado ou sem permissao.' });
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ message: 'Produto excluido!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEGURANÇA: verificar que o produto pertence ao estabelecimento antes de atualizar estoque
app.patch('/api/products/:id/stock', authenticateToken, isTenantUser, (req, res) => {
  const { id } = req.params;
  const { quantityStep } = req.body;
  const now = new Date().toISOString();
  try {
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND establishmentId = ?').get(id, req.user.establishmentId);
    if (!product) return res.status(404).json({ error: 'Produto nao encontrado ou sem permissao.' });
    db.prepare(`UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ? AND establishmentId = ?`).run(quantityStep, now, id, req.user.establishmentId);
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
      taxRegime, cscId, csc, certificatePath, certificatePassword,
      autoIssueOnPayment, autoPrintOnAuthorization,
    } = req.body;

    const normalizedEnvironment = environment === 'production' ? 'production' : 'homologation';
    const normalizedProviderMode = providerMode === 'sefaz_go' ? 'sefaz_go' : 'simulated';
    const normalizedTaxRegime = ['mei', 'simples', 'normal'].includes(taxRegime) ? taxRegime : 'simples';
    const safeSerie = String(serie || '1').trim();
    const safeNextNumber = Math.max(1, Number.parseInt(nextNumber, 10) || 1);
    const now = new Date().toISOString();
    const current = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);

    db.prepare(`
      UPDATE fiscal_settings
      SET enabled = ?, providerMode = ?, environment = ?, documentModel = '65', serie = ?, nextNumber = ?,
          cnpj = ?, stateRegistration = ?, legalName = ?, tradeName = ?, taxRegime = ?,
          cscId = ?, csc = ?, certificatePath = ?, certificatePassword = ?,
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
      cscId || null,
      csc === undefined ? current.csc : (csc ? encodeCredentials({ value: csc }) : null),
      certificatePath || null,
      certificatePassword === undefined ? current.certificatePassword : (certificatePassword ? encodeCredentials({ value: certificatePassword }) : null),
      autoIssueOnPayment ? 1 : 0,
      autoPrintOnAuthorization ? 1 : 0,
      now,
      estId
    );

    const settings = db.prepare('SELECT * FROM fiscal_settings WHERE establishmentId = ?').get(estId);
    res.json({
      settings: sanitizeFiscalSettings(settings),
      readiness: getFiscalReadiness(settings),
      message: 'Configuracao fiscal salva.',
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
    res.status(201).json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fiscal/documents/:id/issue', authenticateToken, isGestorOrAbove, async (req, res) => {
  try {
    if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Documento fiscal pertence a um estabelecimento.' });
    const document = await issueFiscalDocument(req.params.id, req.user.establishmentId);
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

app.post('/api/pix/accounts', authenticateToken, isGestorOrAbove, (req, res) => {
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
    if (provider === 'mercado_pago' && credentials?.supportsPoint && !String(credentials?.terminalId || '').trim()) {
      return res.status(400).json({ error: 'Terminal ID do Mercado Pago Point e obrigatorio.' });
    }

    const existingCount = db.prepare('SELECT COUNT(*) as c FROM pix_accounts WHERE establishmentId = ?').get(estId).c;
    if (existingCount >= 3) return res.status(400).json({ error: 'Limite inicial de 3 contas Pix atingido.' });

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

    res.status(201).json(sanitizePixAccount(db.prepare('SELECT * FROM pix_accounts WHERE id = ?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pix/accounts/:id', authenticateToken, isGestorOrAbove, (req, res) => {
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
    if (provider === 'mercado_pago' && mergedCredentials.supportsPoint && !String(mergedCredentials.terminalId || '').trim()) {
      return res.status(400).json({ error: 'Terminal ID do Mercado Pago Point e obrigatorio.' });
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

    res.json(sanitizePixAccount(db.prepare('SELECT * FROM pix_accounts WHERE id = ?').get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pix/accounts/:id', authenticateToken, isGestorOrAbove, (req, res) => {
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
      return res.json({ message: 'Conta possui historico de transacoes e foi desativada.' });
    }
    db.prepare('DELETE FROM pix_accounts WHERE id = ? AND establishmentId = ?').run(req.params.id, estId);
    res.json({ message: 'Conta Pix removida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', authenticateToken, isTenantUser, async (req, res) => {
  const { items, totalAmount, paymentMethod } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Itens da venda são obrigatórios.' });
  }

  const estId = req.user.establishmentId;
  const saleId = uuidv4();

  try {
    validateSaleItemsForTenant(items, estId);
    const saleResult = await createPaidSale(items, totalAmount, paymentMethod, req.user.id, estId, saleId);
    res.status(201).json({
      id: saleResult.saleId,
      fiscalDocument: saleResult.fiscalDocument,
      message: 'Venda finalizada com sucesso!',
    });
  } catch (err) {
    console.error('[Sale Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/pix', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const { items, totalAmount, pixAccountId } = req.body;
    const estId = req.user.establishmentId;
    validateSaleItemsForTenant(items, estId);

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

    const transactionId = uuidv4();
    const referenceId = makeProviderReference();
    const provider = getPixProvider(account.provider);
    const charge = await provider.createCharge({
      amount: totalAmount,
      referenceId,
      credentials: accountCredentials,
      description: `Venda PDV ${transactionId}`,
    });
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO payment_transactions (
        id, establishmentId, pixAccountId, provider, providerTransactionId, status, amount, paymentMethod,
        qrCode, qrCodeBase64, ticketUrl, payload, expiresAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pix', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      estId,
      account.id,
      account.provider,
      charge.providerTransactionId,
      charge.status,
      totalAmount,
      charge.qrCode || '',
      charge.qrCodeBase64 || '',
      charge.ticketUrl || '',
      JSON.stringify({
        items,
        providerPaymentId: charge.providerPaymentId || null,
        externalReference: charge.externalReference || referenceId,
        providerPayload: charge.payload || null,
      }),
      charge.expiresAt || null,
      createdAt,
      createdAt
    );

    res.status(201).json({
      id: transactionId,
      status: charge.status,
      amount: totalAmount,
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
    console.error('[Pix Create Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/payments/card', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const { items, totalAmount, accountId } = req.body;
    const estId = req.user.establishmentId;
    validateSaleItemsForTenant(items, estId);

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

    const transactionId = uuidv4();
    const referenceId = makeProviderReference();
    const provider = getPointProvider(account.provider);
    const order = await provider.createOrder({
      amount: totalAmount,
      referenceId,
      credentials,
      description: `Venda PDV ${transactionId}`,
    });
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO payment_transactions (
        id, establishmentId, pixAccountId, provider, providerTransactionId, status, amount, paymentMethod,
        payload, expiresAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'card', ?, ?, ?, ?)
    `).run(
      transactionId,
      estId,
      account.id,
      account.provider,
      order.providerTransactionId,
      order.status,
      totalAmount,
      JSON.stringify({ items, providerPaymentId: order.providerPaymentId || null, providerPayload: order.payload || null }),
      order.expiresAt || null,
      createdAt,
      createdAt
    );

    res.status(201).json({
      id: transactionId,
      status: order.status,
      amount: totalAmount,
      provider: account.provider,
      providerTransactionId: order.providerTransactionId,
      terminalId: credentials.terminalId || '',
      expiresAt: order.expiresAt || null,
    });
  } catch (err) {
    console.error('[Card Create Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments/card/:id/status', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'card');
    if (!transaction) return res.status(404).json({ error: 'Transacao de cartao nao encontrada.' });

    let status = transaction.status;
    let paidAt = transaction.paidAt;
    let saleId = transaction.saleId;

    if (status === 'pending') {
      const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(transaction.pixAccountId, estId);
      if (!account) return res.status(404).json({ error: 'Conta da transacao nao encontrada.' });
      const statusResult = await getPointProvider(account.provider).getStatus({
        transaction,
        credentials: decodeCredentials(account.credentials),
      });
      status = statusResult.status;
      paidAt = statusResult.paidAt || paidAt;
      db.prepare('UPDATE payment_transactions SET status = ?, paidAt = ?, updatedAt = ?, payload = ? WHERE id = ?')
        .run(status, paidAt || null, new Date().toISOString(), JSON.stringify({
          ...JSON.parse(transaction.payload || '{}'),
          latestProviderPayload: statusResult.payload || null,
        }), transaction.id);
    }

    if (status === 'paid' && !saleId) {
      const fresh = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id);
      const stored = JSON.parse(fresh.payload || '{}');
      const storedItems = stored.items || [];
      validateSaleItemsForTenant(storedItems, estId);
      const saleResult = await createPaidSale(storedItems, fresh.amount, 'card', req.user.id, estId);
      saleId = saleResult.saleId;
      db.prepare('UPDATE payment_transactions SET saleId = ?, status = ?, paidAt = COALESCE(paidAt, ?), updatedAt = ? WHERE id = ?')
        .run(saleId, 'paid', paidAt || new Date().toISOString(), new Date().toISOString(), transaction.id);
    }

    const fiscalDocument = saleId
      ? db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1').get(saleId, estId) || null
      : null;

    res.json({
      id: transaction.id,
      status,
      saleId,
      fiscalDocument,
      paidAt,
      amount: transaction.amount,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      paymentConfirmation: saleId ? getPaymentTransactionForSale(saleId, estId) : null,
      expiresAt: transaction.expiresAt,
    });
  } catch (err) {
    console.error('[Card Status Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/payments/pix/:id/status', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ?').get(req.params.id, estId);
    if (!transaction) return res.status(404).json({ error: 'Transacao Pix nao encontrada.' });

    let status = transaction.status;
    let paidAt = transaction.paidAt;
    let saleId = transaction.saleId;

    if (status === 'pending') {
      const account = db.prepare('SELECT * FROM pix_accounts WHERE id = ? AND establishmentId = ?').get(transaction.pixAccountId, estId);
      if (!account) return res.status(404).json({ error: 'Conta Pix da transacao nao encontrada.' });
      const statusResult = await getPixProvider(account.provider).getStatus({
        transaction,
        credentials: decodeCredentials(account.credentials),
      });
      status = statusResult.status;
      paidAt = statusResult.paidAt || paidAt;

      const currentPayload = JSON.parse(transaction.payload || '{}');
      db.prepare('UPDATE payment_transactions SET status = ?, paidAt = ?, updatedAt = ?, payload = ? WHERE id = ?')
        .run(status, paidAt || null, new Date().toISOString(), JSON.stringify({
          ...currentPayload,
          providerPaymentId: statusResult.providerPaymentId || currentPayload.providerPaymentId || null,
          externalReference: statusResult.externalReference || currentPayload.externalReference || null,
          latestProviderPayload: statusResult.payload || null,
        }), transaction.id);
    }

    if (status === 'paid' && !saleId) {
      const fresh = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id);
      const stored = JSON.parse(fresh.payload || '{}');
      const storedItems = stored.items || [];
      validateSaleItemsForTenant(storedItems, estId);
      const saleResult = await createPaidSale(storedItems, fresh.amount, 'pix', req.user.id, estId);
      saleId = saleResult.saleId;
      db.prepare('UPDATE payment_transactions SET saleId = ?, status = ?, paidAt = COALESCE(paidAt, ?), updatedAt = ? WHERE id = ?')
        .run(saleId, 'paid', paidAt || new Date().toISOString(), new Date().toISOString(), transaction.id);
    }

    const fiscalDocument = saleId
      ? db.prepare('SELECT * FROM fiscal_documents WHERE saleId = ? AND establishmentId = ? ORDER BY createdAt DESC LIMIT 1').get(saleId, estId) || null
      : null;

    const latestTransaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(transaction.id) || transaction;
    const responsePayload = JSON.parse(latestTransaction.payload || '{}');
    const responseProviderPayload = responsePayload.latestProviderPayload || responsePayload.providerPayload || {};
    const responsePayment = responseProviderPayload.transactions?.payments?.[0] || {};

    res.json({
      id: transaction.id,
      status,
      saleId,
      fiscalDocument,
      paidAt,
      amount: transaction.amount,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      providerPaymentId: responsePayload.providerPaymentId || responsePayment.id || null,
      externalReference: responsePayload.externalReference || responseProviderPayload.external_reference || null,
      paymentConfirmation: saleId ? getPaymentTransactionForSale(saleId, estId) : null,
      qrCode: transaction.qrCode,
      qrCodeBase64: transaction.qrCodeBase64,
      ticketUrl: transaction.ticketUrl,
      expiresAt: transaction.expiresAt,
    });
  } catch (err) {
    console.error('[Pix Status Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SUPER ADMIN — ESTABELECIMENTOS
// ==============================
// PAGAMENTOS PIX
app.post('/api/payments/pix/:id/cancel', authenticateToken, isTenantUser, async (req, res) => {
  try {
    const estId = req.user.establishmentId;
    const transaction = db.prepare('SELECT * FROM payment_transactions WHERE id = ? AND establishmentId = ? AND paymentMethod = ?')
      .get(req.params.id, estId, 'pix');
    if (!transaction) return res.status(404).json({ error: 'Transacao Pix nao encontrada.' });
    if (transaction.status === 'paid') return res.status(409).json({ error: 'Nao e possivel cancelar um Pix ja pago.' });

    if (transaction.status !== 'pending') {
      return res.json({
        id: transaction.id,
        status: transaction.status,
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
    db.prepare('UPDATE payment_transactions SET status = ?, updatedAt = ?, payload = ? WHERE id = ?')
      .run(status, updatedAt, JSON.stringify(nextPayload), transaction.id);

    res.json({
      id: transaction.id,
      status,
      saleId: transaction.saleId,
      paidAt: transaction.paidAt,
      amount: transaction.amount,
      provider: transaction.provider,
      providerTransactionId: transaction.providerTransactionId,
      providerPaymentId: nextPayload.providerPaymentId || null,
      externalReference: nextPayload.externalReference || null,
      paymentConfirmation: null,
      qrCode: transaction.qrCode,
      qrCodeBase64: transaction.qrCodeBase64,
      ticketUrl: transaction.ticketUrl,
      expiresAt: transaction.expiresAt,
    });
  } catch (err) {
    console.error('[Pix Cancel Error]', err.message, err.providerStatus ? { providerStatus: err.providerStatus, providerPayload: err.providerPayload } : '');
    res.status(500).json({ error: err.message });
  }
});

// SUPER ADMIN - ESTABELECIMENTOS
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
      return { ...est, userCount, salesCount, revenueMonth, lastPayment };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/establishments', authenticateToken, isSuperAdmin, (req, res) => {
  const { name, ownerName, email, phone, plan, monthlyAmount, subscriptionDueDate, gestorUsername, gestorPassword, gestorName } = req.body;
  if (!name || !gestorUsername || !gestorPassword || !gestorName) {
    return res.status(400).json({ error: 'Nome do estabelecimento, login, senha e nome do gestor são obrigatórios.' });
  }

  const estId = uuidv4();
  const gestorId = uuidv4();
  const now = new Date().toISOString();
  // Assinatura mensal: vence no mesmo dia do mês seguinte
  const dueDate = subscriptionDueDate || addOneMonth(now);

  try {
    const createEstAndGestor = db.transaction(() => {
      db.prepare(`INSERT INTO establishments (id, name, ownerName, email, phone, plan, monthlyAmount, subscriptionStatus, subscriptionDueDate, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(estId, name, ownerName || gestorName, email || null, phone || null, plan || 'basic',
          parseFloat(monthlyAmount) || 0, dueDate, now);
      db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt)
        VALUES (?, ?, ?, ?, 'gestor', ?, 1, 0, ?)`)
        .run(gestorId, gestorUsername, bcrypt.hashSync(gestorPassword, 10), gestorName, estId, now);
    });
    createEstAndGestor();
    res.status(201).json({ id: estId, message: 'Estabelecimento criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar. Login do gestor pode já estar em uso.' });
  }
});

app.put('/api/admin/establishments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { name, ownerName, email, phone, plan, monthlyAmount, subscriptionStatus, subscriptionDueDate, notes } = req.body;
  try {
    db.prepare(`UPDATE establishments SET name=?, ownerName=?, email=?, phone=?, plan=?, monthlyAmount=?, subscriptionStatus=?, subscriptionDueDate=?, notes=? WHERE id=?`)
      .run(name, ownerName, email, phone, plan, parseFloat(monthlyAmount) || 0, subscriptionStatus, subscriptionDueDate, notes || null, id);
    res.json({ message: 'Estabelecimento atualizado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/establishments/:id/subscription', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  const { subscriptionStatus, subscriptionDueDate } = req.body;
  try {
    db.prepare('UPDATE establishments SET subscriptionStatus=?, subscriptionDueDate=? WHERE id=?')
      .run(subscriptionStatus, subscriptionDueDate, id);
    res.json({ message: 'Assinatura atualizada!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/establishments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('UPDATE users SET isDeleted = 1 WHERE establishmentId = ?').run(id);
    db.prepare('DELETE FROM establishments WHERE id = ?').run(id);
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
  if (!amount || isNaN(parseFloat(amount))) {
    return res.status(400).json({ error: 'Valor do pagamento é obrigatório.' });
  }

  try {
    const est = db.prepare('SELECT * FROM establishments WHERE id = ?').get(id);
    if (!est) return res.status(404).json({ error: 'Estabelecimento não encontrado.' });

    const now = new Date().toISOString();
    const currentDueDate = est.subscriptionDueDate || now;
    const newDueDate = addOneMonth(currentDueDate);
    const paymentId = uuidv4();

    const registerPayment = db.transaction(() => {
      // Registrar pagamento
      db.prepare(`INSERT INTO payments (id, establishmentId, amount, dueDate, paidAt, notes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(paymentId, id, parseFloat(amount), currentDueDate, now, notes || null, now);
      // Avançar vencimento 1 mês e ativar assinatura
      db.prepare('UPDATE establishments SET subscriptionDueDate = ?, subscriptionStatus = ? WHERE id = ?')
        .run(newDueDate, 'active', id);
    });
    registerPayment();

    res.status(201).json({
      message: 'Pagamento registrado! Próximo vencimento: ' + new Date(newDueDate).toLocaleDateString('pt-BR'),
      newDueDate,
      paymentId,
    });
  } catch (err) {
    console.error('[Payment Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/payments/:id', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
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

let lastScheduledMinute = '';
setInterval(() => {
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

if (NODE_ENV === 'production') {
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT} [${NODE_ENV}]`);
});

process.on('SIGTERM', () => { console.log('🛑 SIGTERM. Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT. Encerrando...'); process.exit(0); });
