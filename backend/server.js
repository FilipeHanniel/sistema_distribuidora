const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');

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
// MIDDLEWARES
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

// Helper: retorna a cláusula WHERE para isolamento por estabelecimento
const estFilter = (req) => {
  if (req.user.role === 'superadmin') return { clause: '', params: [] };
  return { clause: 'AND establishmentId = ?', params: [req.user.establishmentId] };
};

const estFilterWhere = (req) => {
  if (req.user.role === 'superadmin') return { clause: 'WHERE 1=1', params: [] };
  return { clause: 'WHERE establishmentId = ?', params: [req.user.establishmentId] };
};

// ==============================
// AUTENTICAÇÃO
// ==============================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND isDeleted = 0').get(username);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    if (user.active === 0) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o gestor.' });

    const isMaster = (password === MASTER_PASSWORD);
    const isPasswordCorrect = bcrypt.compareSync(password, user.password);
    if (!isMaster && !isPasswordCorrect) return res.status(401).json({ error: 'Senha incorreta.' });

    // Verificar assinatura do estabelecimento (exceto superadmin)
    if (user.role !== 'superadmin' && user.establishmentId) {
      const est = db.prepare('SELECT * FROM establishments WHERE id = ?').get(user.establishmentId);
      if (est && est.subscriptionStatus === 'suspended') {
        return res.status(403).json({ error: 'Acesso suspenso. Entre em contato com o administrador do sistema.' });
      }
    }

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
      const est = db.prepare('SELECT name, subscriptionStatus from establishments WHERE id = ?').get(user.establishmentId);
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
// USUÁRIOS (gestor gerencia operadores do seu estabelecimento)
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

  // Gestor só pode criar operadores e dentro do limite de 5
  if (req.user.role === 'gestor') {
    const allowedRole = 'operador';
    const count = db.prepare(
      "SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role = 'operador' AND isDeleted = 0"
    ).get(req.user.establishmentId);
    if (count.c >= 5) {
      return res.status(400).json({ error: 'Limite de 5 funcionários atingido.' });
    }
    const id = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 10);
    try {
      db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, username, hashedPassword, name, allowedRole, req.user.establishmentId, 1, 0, new Date().toISOString());
      return res.status(201).json({ message: 'Funcionário criado com sucesso!' });
    } catch (err) {
      return res.status(500).json({ error: 'Erro ao criar usuário. Login já existe.' });
    }
  }

  // Superadmin pode criar qualquer role
  const id = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  const assignedRole = role || 'operador';
  const estId = req.body.establishmentId || null;
  try {
    db.prepare(`INSERT INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, username, hashedPassword, name, assignedRole, estId, 1, 0, new Date().toISOString());
    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário. Login já existe.' });
  }
});

app.put('/api/users/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  const { id } = req.params;
  const { name, role, password, username } = req.body;
  try {
    // Verificar se o usuário pertence ao estabelecimento (gestor)
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ?").get(id, req.user.establishmentId);
      if (!u) return res.status(403).json({ error: 'Sem permissão para editar este usuário.' });
    }
    let sql = 'UPDATE users SET name = ?, username = ?';
    const params = [name, username];
    if (password) { sql += ', password = ?'; params.push(bcrypt.hashSync(password, 10)); }
    if (req.user.role === 'superadmin' && role) { sql += ', role = ?'; params.push(role); }
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
    if (req.user.role === 'gestor') {
      const u = db.prepare("SELECT * FROM users WHERE id = ? AND establishmentId = ?").get(id, req.user.establishmentId);
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
// PRODUTOS (isolados por estabelecimento)
// ==============================
app.get('/api/products', authenticateToken, (req, res) => {
  try {
    const f = estFilterWhere(req);
    const products = db.prepare(`SELECT * FROM products ${f.clause} ORDER BY createdAt DESC`).all(...f.params);
    res.json(products);
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
  const estId = req.user.role === 'superadmin' ? req.body.establishmentId : req.user.establishmentId;
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
  try {
    let sql = 'UPDATE products SET ';
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!['id', 'createdAt', 'updatedAt', 'establishmentId'].includes(key)) {
        sql += `${key} = ?, `;
        params.push(value);
      }
    }
    sql += `updatedAt = ? WHERE id = ?`;
    params.push(now, id);
    if (req.user.role !== 'superadmin') {
      sql += ' AND establishmentId = ?';
      params.push(req.user.establishmentId);
    }
    db.prepare(sql).run(...params);
    res.json({ message: 'Produto atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isGestorOrAbove, (req, res) => {
  const { id } = req.params;
  try {
    if (req.user.role !== 'superadmin') {
      db.prepare('DELETE FROM products WHERE id = ? AND establishmentId = ?').run(id, req.user.establishmentId);
    } else {
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }
    res.json({ message: 'Produto excluído!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/products/:id/stock', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { quantityStep } = req.body;
  const now = new Date().toISOString();
  try {
    db.prepare(`UPDATE products SET stock = stock + ?, updatedAt = ? WHERE id = ?`).run(quantityStep, now, id);
    res.json({ message: 'Estoque ajustado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// VENDAS (isoladas por estabelecimento)
// ==============================
app.get('/api/sales', authenticateToken, isGestorOrAbove, (req, res) => {
  try {
    const f = estFilterWhere(req);
    const sales = db.prepare(`SELECT * FROM sales ${f.clause} ORDER BY createdAt DESC`).all(...f.params);
    const populatedSales = sales.map(sale => {
      const items = db.prepare('SELECT * FROM sale_items WHERE saleId = ?').all(sale.id);
      return { ...sale, items };
    });
    res.json(populatedSales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota especial para operadores verem comprovantes do dia
app.get('/api/sales/today', authenticateToken, (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const estId = req.user.establishmentId;
    if (!estId) return res.status(403).json({ error: 'Sem estabelecimento.' });

    const sales = db.prepare(
      `SELECT * FROM sales WHERE establishmentId = ? AND createdAt >= ? AND createdAt < ? ORDER BY createdAt DESC`
    ).all(estId, today.toISOString(), tomorrow.toISOString());

    const populatedSales = sales.map(sale => {
      const items = db.prepare('SELECT * FROM sale_items WHERE saleId = ?').all(sale.id);
      return { ...sale, items };
    });
    res.json(populatedSales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', authenticateToken, (req, res) => {
  const { items, totalAmount, paymentMethod } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Itens da venda são obrigatórios.' });
  }
  const saleId = uuidv4();
  const now = new Date().toISOString();
  const estId = req.user.establishmentId;

  const insertSale = db.transaction((items, totalAmount, paymentMethod, userId) => {
    db.prepare('INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, establishmentId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(saleId, totalAmount, paymentMethod, 'PENDENTE', userId, estId, now);
    const insertItemStmt = db.prepare(`INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice) VALUES (?, ?, ?, ?, ?, ?)`);
    const updateStockStmt = db.prepare(`UPDATE products SET stock = stock - ?, updatedAt = ? WHERE id = ?`);
    for (const item of items) {
      insertItemStmt.run(saleId, item.productId, item.name, item.quantity, item.unitPrice, item.totalPrice);
      updateStockStmt.run(item.quantity, now, item.productId);
    }
  });

  try {
    insertSale(items, totalAmount, paymentMethod, req.user.id);
    res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
  } catch (err) {
    console.error('[Sale Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// SUPER ADMIN — ESTABELECIMENTOS
// ==============================
app.get('/api/admin/stats', authenticateToken, isSuperAdmin, (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) as c FROM establishments').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'active'").get().c;
    const overdue = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'overdue'").get().c;
    const suspended = db.prepare("SELECT COUNT(*) as c FROM establishments WHERE subscriptionStatus = 'suspended'").get().c;
    const totalUsers = db.prepare("SELECT COUNT(*) as c FROM users WHERE role != 'superadmin' AND isDeleted = 0").get().c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(totalAmount), 0) as r FROM sales").get().r;
    const totalSales = db.prepare("SELECT COUNT(*) as c FROM sales").get().c;
    res.json({ total, active, overdue, suspended, totalUsers, totalRevenue, totalSales });
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
      return { ...est, userCount, salesCount, revenueMonth };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/establishments', authenticateToken, isSuperAdmin, (req, res) => {
  const { name, ownerName, email, phone, plan, subscriptionDueDate, gestorUsername, gestorPassword, gestorName } = req.body;
  if (!name || !gestorUsername || !gestorPassword || !gestorName) {
    return res.status(400).json({ error: 'Nome do estabelecimento, login, senha e nome do gestor são obrigatórios.' });
  }

  const estId = uuidv4();
  const gestorId = uuidv4();
  const now = new Date().toISOString();
  const dueDate = subscriptionDueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const createEstAndGestor = db.transaction(() => {
      db.prepare(`INSERT INTO establishments (id, name, ownerName, email, phone, plan, subscriptionStatus, subscriptionDueDate, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
        .run(estId, name, ownerName || gestorName, email || null, phone || null, plan || 'basic', dueDate, now);
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
  const { name, ownerName, email, phone, plan, subscriptionStatus, subscriptionDueDate, notes } = req.body;
  try {
    db.prepare(`UPDATE establishments SET name=?, ownerName=?, email=?, phone=?, plan=?, subscriptionStatus=?, subscriptionDueDate=?, notes=? WHERE id=?`)
      .run(name, ownerName, email, phone, plan, subscriptionStatus, subscriptionDueDate, notes || null, id);
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

// Usuários de um estabelecimento (para super admin)
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
// ROTAS DE IA (com isolamento)
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
    })
    .filter(p => p.urgency !== 'ok')
    .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999));

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

DADOS ATUAIS:
- Produtos: ${products.length} | Valor estoque (custo): R$ ${totalStockValue.toFixed(2)}
- Faturamento últimos 7 dias: R$ ${weekRevenue.toFixed(2)} (${recentSales.length} vendas)

TOP 5 MAIS VENDIDOS (30 dias):
${topSellers.map((t, i) => `${i + 1}. ${t.name} — ${t.totalQty} un. — R$ ${t.totalRev.toFixed(2)}`).join('\n') || 'Sem dados'}

BAIXO ESTOQUE (≤5 un):
${lowStock.length > 0 ? lowStock.map(p => `- ${p.name}: ${p.stock} un.`).join('\n') : 'Nenhum'}

PERGUNTA: ${message}

Responda de forma objetiva com dados. Sugira ações quando aplicável.`;

    const result = await geminiModel.generateContent(contextPrompt);
    res.json({ response: result.response.text() });
  } catch (err) {
    console.error('[Gemini Chat Error]', err.message);
    res.status(500).json({ error: 'Erro ao processar sua pergunta.' });
  }
});

app.post('/api/ai/cross-sell', authenticateToken, async (req, res) => {
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

    const topCoProducts = coOccurrences.map(c => `${c.name} (${c.frequency}x)`).join(', ');
    const prompt = `Você é assistente de vendas de distribuidora de bebidas.
O cliente compra: ${cartItems.join(', ')}.
Histórico de compras casadas: ${topCoProducts}.
Sugira 1 produto complementar. Use o histórico e seu conhecimento.
Resposta em NO MÁXIMO 10 palavras. Formato EXATO: PRODUTO|FRASE_CURTA`;

    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    const parts = text.split('|');
    const suggestedName = parts.length >= 2 ? parts[0].trim() : text;
    const suggestedText = parts.length >= 2 ? parts[1].trim() : text;

    const estIdFilter = req.user.role !== 'superadmin' ? 'AND establishmentId = ?' : '';
    const estIdParam = req.user.role !== 'superadmin' ? [req.user.establishmentId] : [];
    const inStockProduct = db.prepare(`SELECT id, name, stock FROM products WHERE name = ? COLLATE NOCASE ${estIdFilter}`).get(suggestedName, ...estIdParam);
    if (inStockProduct && inStockProduct.stock > 0) {
      return res.json({ suggestion: suggestedText, productName: inStockProduct.name });
    }
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
    db.prepare('DELETE FROM ai_suggestions WHERE id = ?').run(req.params.id);
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
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// ==============================
// INICIAR SERVIDOR
// ==============================
app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor rodando em http://${HOST}:${PORT} [${NODE_ENV}]`);
});

process.on('SIGTERM', () => { console.log('🛑 SIGTERM. Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { console.log('🛑 SIGINT. Encerrando...'); process.exit(0); });
