const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');
const { addOneMonth } = require('./database');
const { PROVIDERS, getPixProvider, makeProviderReference } = require('./pixProviders');

const app = express();

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBFuOlj6PQ3ADxJDMF0EbcQnUL5G8FPlr8';
let genAI = null;
let geminiModel = null;
if (GEMINI_API_KEY && GEMINI_API_KEY !== 'COLOQUE_SUA_CHAVE_AQUI') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  console.log('✅ Gemini AI configurado com sucesso!');
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

const sanitizePixAccount = (account) => {
  if (!account) return account;
  return {
    id: account.id,
    establishmentId: account.establishmentId,
    name: account.name,
    provider: account.provider,
    pixKey: account.pixKey,
    active: account.active,
    isDefault: account.isDefault,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
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

const createPaidSale = (items, totalAmount, paymentMethod, userId, estId, saleId = uuidv4()) => {
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
  return saleId;
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
  const { barcode, name, costPrice, sellPrice, stock, category } = req.body;
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
    db.prepare(`INSERT INTO products (id, barcode, name, costPrice, sellPrice, stock, category, establishmentId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, barcode || '', name, costPrice, sellPrice, stock || 0, category || 'Geral', estId, now, now);
    res.status(201).json({ id, message: 'Produto inserido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const now = new Date().toISOString();
  const allowedProductFields = ['barcode', 'name', 'costPrice', 'sellPrice', 'stock', 'category'];
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
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pix/providers', authenticateToken, isGestorOrAbove, (req, res) => {
  res.json(PROVIDERS);
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
    const now = new Date().toISOString();

    const updateAccount = db.transaction(() => {
      if (isDefault) db.prepare('UPDATE pix_accounts SET isDefault = 0 WHERE establishmentId = ?').run(estId);
      db.prepare(`
        UPDATE pix_accounts
        SET name = ?, provider = ?, pixKey = ?, credentials = ?, active = ?, isDefault = ?, updatedAt = ?
        WHERE id = ? AND establishmentId = ?
      `).run(name, provider, pixKey || null, encodeCredentials(credentials || {}), active ? 1 : 0, isDefault ? 1 : 0, now, req.params.id, estId);
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
    db.prepare('DELETE FROM pix_accounts WHERE id = ? AND establishmentId = ?').run(req.params.id, estId);
    res.json({ message: 'Conta Pix removida.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', authenticateToken, isTenantUser, (req, res) => {
  const { items, totalAmount, paymentMethod } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Itens da venda são obrigatórios.' });
  }

  const estId = req.user.establishmentId;
  const saleId = uuidv4();

  try {
    validateSaleItemsForTenant(items, estId);
    createPaidSale(items, totalAmount, paymentMethod, req.user.id, estId, saleId);
    res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
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
    if (!PROVIDERS[account.provider]?.implemented) {
      return res.status(400).json({ error: 'Provider Pix ainda nao implementado para cobranca real.' });
    }

    const transactionId = uuidv4();
    const referenceId = makeProviderReference();
    const provider = getPixProvider(account.provider);
    const charge = await provider.createCharge({
      amount: totalAmount,
      referenceId,
      credentials: decodeCredentials(account.credentials),
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
      JSON.stringify({ items, providerPayload: charge.payload || null }),
      charge.expiresAt || null,
      createdAt,
      createdAt
    );

    res.status(201).json({
      id: transactionId,
      status: charge.status,
      amount: totalAmount,
      qrCode: charge.qrCode || '',
      qrCodeBase64: charge.qrCodeBase64 || '',
      ticketUrl: charge.ticketUrl || '',
      expiresAt: charge.expiresAt || null,
      pixAccount: sanitizePixAccount(account),
    });
  } catch (err) {
    console.error('[Pix Create Error]', err.message);
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
      saleId = createPaidSale(storedItems, fresh.amount, 'pix', req.user.id, estId);
      db.prepare('UPDATE payment_transactions SET saleId = ?, status = ?, paidAt = COALESCE(paidAt, ?), updatedAt = ? WHERE id = ?')
        .run(saleId, 'paid', paidAt || new Date().toISOString(), new Date().toISOString(), transaction.id);
    }

    res.json({
      id: transaction.id,
      status,
      saleId,
      paidAt,
      amount: transaction.amount,
      qrCode: transaction.qrCode,
      qrCodeBase64: transaction.qrCodeBase64,
      ticketUrl: transaction.ticketUrl,
      expiresAt: transaction.expiresAt,
    });
  } catch (err) {
    console.error('[Pix Status Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SUPER ADMIN — ESTABELECIMENTOS
// ==============================
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
app.get('/api/ai/stock-predictions', authenticateToken, (req, res) => {
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

app.post('/api/ai/chat', authenticateToken, isGestorOrAbove, async (req, res) => {
  if (!geminiModel) return res.status(503).json({ error: 'Gemini AI não configurado.' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensagem é obrigatória.' });

  try {
    const f = estFilterWhere(req);
    const products = db.prepare(`SELECT name, stock, sellPrice, costPrice, category FROM products ${f.clause}`).all(...f.params);
    const totalStockValue = products.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const estClause = req.user.role !== 'superadmin' ? 'AND s.establishmentId = ?' : '';
    const estParams = req.user.role !== 'superadmin' ? [req.user.establishmentId] : [];

    const recentSales = db.prepare(`SELECT s.totalAmount FROM sales s WHERE s.createdAt >= ? ${estClause}`).all(sevenDaysAgo.toISOString(), ...estParams);
    const weekRevenue = recentSales.reduce((sum, s) => sum + s.totalAmount, 0);
    const topSellers = db.prepare(`
      SELECT si.name, SUM(si.quantity) as totalQty, SUM(si.totalPrice) as totalRev
      FROM sale_items si INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ? ${estClause} GROUP BY si.productId ORDER BY totalQty DESC LIMIT 5
    `).all(thirtyDaysAgo.toISOString(), ...estParams);
    const lowStock = products.filter(p => p.stock <= 5);

    const contextPrompt = `Você é o assistente de gestão inteligente de uma distribuidora de bebidas.
Responda SEMPRE em português do Brasil, de forma concisa e útil.
DADOS: Produtos: ${products.length} | Estoque (custo): R$${totalStockValue.toFixed(2)} | Faturamento 7d: R$${weekRevenue.toFixed(2)}
TOP VENDIDOS: ${topSellers.map((t, i) => `${i + 1}.${t.name}(${t.totalQty}un)`).join(', ') || 'sem dados'}
BAIXO ESTOQUE: ${lowStock.map(p => `${p.name}:${p.stock}un`).join(', ') || 'nenhum'}
PERGUNTA: ${message}
Responda de forma objetiva com dados.`;

    const result = await geminiModel.generateContent(contextPrompt);
    res.json({ response: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar sua pergunta.' });
  }
});

app.post('/api/ai/cross-sell', authenticateToken, isTenantUser, async (req, res) => {
  if (!geminiModel) return res.json({ suggestion: null, productName: null });
  const { cartItems } = req.body;
  if (!cartItems || cartItems.length === 0) return res.json({ suggestion: null, productName: null });

  try {
    const estClause = req.user.role !== 'superadmin' ? 'AND s.establishmentId = ?' : '';
    const estParams = req.user.role !== 'superadmin' ? [req.user.establishmentId] : [];
    const placeholders = cartItems.map(() => '?').join(',');

    const coOccurrences = db.prepare(`
      SELECT si2.name, COUNT(*) as frequency
      FROM sale_items si1 INNER JOIN sale_items si2 ON si1.saleId = si2.saleId AND si1.productId != si2.productId
      INNER JOIN sales s ON si1.saleId = s.id
      WHERE si1.name IN (${placeholders}) AND si2.name NOT IN (${placeholders}) ${estClause}
      GROUP BY si2.productId ORDER BY frequency DESC LIMIT 5
    `).all(...cartItems, ...cartItems, ...estParams);

    if (coOccurrences.length === 0) return res.json({ suggestion: null, productName: null });

    const topCoProducts = coOccurrences.map(c => `${c.name}(${c.frequency}x)`).join(', ');
    const prompt = `Você é assistente de vendas de distribuidora de bebidas. O cliente compra: ${cartItems.join(', ')}. Histórico: ${topCoProducts}. Sugira 1 produto complementar. Formato EXATO: PRODUTO|FRASE_CURTA (máx 10 palavras total)`;
    const result = await geminiModel.generateContent(prompt);
    const parts = result.response.text().trim().split('|');
    const suggestedName = parts[0]?.trim();
    const suggestedText = parts[1]?.trim();

    const estIdFilter = req.user.role !== 'superadmin' ? 'AND establishmentId = ?' : '';
    const estIdParam = req.user.role !== 'superadmin' ? [req.user.establishmentId] : [];
    const inStockProduct = db.prepare(`SELECT id, name, stock FROM products WHERE name = ? COLLATE NOCASE ${estIdFilter}`).get(suggestedName, ...estIdParam);
    if (inStockProduct?.stock > 0) return res.json({ suggestion: suggestedText, productName: inStockProduct.name });
    res.json({ suggestion: null, productName: null });
  } catch (err) {
    res.json({ suggestion: null, productName: null });
  }
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
