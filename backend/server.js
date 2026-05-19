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
// CONFIGURAÇÃO DE PRODUÇÃO
// ==============================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'pepsi-distribuidora-secret-key-2024';
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'dev_master';
const NODE_ENV = process.env.NODE_ENV || 'development';

// CORS configurável por variável de ambiente
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : true; // true = todos (desenvolvimento)

app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Segurança básica em produção
if (NODE_ENV === 'production') {
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
}

// Servir frontend em produção
if (NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
}

// ==============================
// CONFIGURAÇÃO GEMINI AI
// ==============================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBFuOlj6PQ3ADxJDMF0EbcQnUL5G8FPlr8';
let genAI = null;
let geminiModel = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'COLOQUE_SUA_CHAVE_AQUI') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  console.log('✅ Gemini AI configurado com sucesso!');
} else {
  console.log('⚠️  Gemini AI não configurado. Defina GEMINI_API_KEY para habilitar o chat e cross-sell.');
}

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

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  next();
};

// ==============================
// ROTAS DE AUTENTICAÇÃO
// ==============================

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  }
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND isDeleted = 0').get(username);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
    if (user.active === 0) return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador.' });

    const isMaster = (password === MASTER_PASSWORD);
    const isPasswordCorrect = bcrypt.compareSync(password, user.password);
    if (!isMaster && !isPasswordCorrect) return res.status(401).json({ error: 'Senha incorreta.' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
  } catch (err) {
    console.error('[Login Error]', err.message);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.get('/api/users', authenticateToken, isAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, name, role, active, createdAt FROM users WHERE isDeleted = 0').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', authenticateToken, isAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Campos obrigatórios ausentes.' });
  const id = uuidv4();
  const hashedPassword = bcrypt.hashSync(password, 10);
  try {
    db.prepare(`INSERT INTO users (id, username, password, name, role, active, isDeleted, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, username, hashedPassword, name, role || 'staff', 1, 0, new Date().toISOString());
    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário. Talvez o login já exista.' });
  }
});

app.put('/api/users/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { name, role, password, username } = req.body;
  try {
    let sql = 'UPDATE users SET name = ?, role = ?, username = ?';
    const params = [name, role, username];
    if (password) {
      sql += ', password = ?';
      params.push(bcrypt.hashSync(password, 10));
    }
    sql += ' WHERE id = ?';
    params.push(id);
    db.prepare(sql).run(...params);
    res.json({ message: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/status', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { active } = req.body;
  try {
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    res.json({ message: `Usuário ${active ? 'ativado' : 'desativado'}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id/delete', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  try {
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
// ROTAS DE PRODUTOS
// ==============================

app.get('/api/products', authenticateToken, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY createdAt DESC').all();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', authenticateToken, isAdmin, (req, res) => {
  const { barcode, name, costPrice, sellPrice, stock, category } = req.body;
  if (!name || costPrice == null || sellPrice == null) {
    return res.status(400).json({ error: 'Nome, preço de custo e preço de venda são obrigatórios.' });
  }
  const id = uuidv4();
  const now = new Date().toISOString();
  try {
    db.prepare(`INSERT INTO products (id, barcode, name, costPrice, sellPrice, stock, category, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, barcode || '', name, costPrice, sellPrice, stock || 0, category || 'Geral', now, now);
    res.status(201).json({ id, message: 'Produto inserido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const now = new Date().toISOString();
  try {
    let sql = 'UPDATE products SET ';
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!['id', 'createdAt', 'updatedAt'].includes(key)) {
        sql += `${key} = ?, `;
        params.push(value);
      }
    }
    sql += `updatedAt = ? WHERE id = ?`;
    params.push(now, id);
    db.prepare(sql).run(...params);
    res.json({ message: 'Produto atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
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
// ROTAS DE VENDAS
// ==============================

app.get('/api/sales', authenticateToken, isAdmin, (req, res) => {
  try {
    const sales = db.prepare('SELECT * FROM sales ORDER BY createdAt DESC').all();
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

  const insertSale = db.transaction((items, totalAmount, paymentMethod, userId) => {
    db.prepare('INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(saleId, totalAmount, paymentMethod, 'PENDENTE', userId, now);
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
// ROTAS DE IA
// ==============================

app.get('/api/ai/stock-predictions', authenticateToken, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products').all();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const salesInPeriod = db.prepare(`
      SELECT si.productId, SUM(si.quantity) as totalSold
      FROM sale_items si INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ? GROUP BY si.productId
    `).all(thirtyDaysAgo.toISOString());

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

app.post('/api/ai/chat', authenticateToken, isAdmin, async (req, res) => {
  if (!geminiModel) return res.status(503).json({ error: 'Gemini AI não configurado. Defina a GEMINI_API_KEY no servidor.' });
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Mensagem é obrigatória.' });

  try {
    const products = db.prepare('SELECT name, stock, sellPrice, costPrice, category FROM products').all();
    const totalStockValue = products.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);
    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSales = db.prepare(`SELECT s.totalAmount FROM sales s WHERE s.createdAt >= ?`).all(sevenDaysAgo.toISOString());
    const weekRevenue = recentSales.reduce((sum, s) => sum + s.totalAmount, 0);
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const topSellers = db.prepare(`
      SELECT si.name, SUM(si.quantity) as totalQty, SUM(si.totalPrice) as totalRev
      FROM sale_items si INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ? GROUP BY si.productId ORDER BY totalQty DESC LIMIT 5
    `).all(thirtyDaysAgo.toISOString());
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

PRODUTOS:
${products.map(p => `- ${p.name} | ${p.category} | Est: ${p.stock} | Venda: R$${p.sellPrice} | Custo: R$${p.costPrice}`).join('\n')}

PERGUNTA: ${message}

Responda de forma objetiva com dados. Sugira ações quando aplicável.`;

    const result = await geminiModel.generateContent(contextPrompt);
    res.json({ response: result.response.text() });
  } catch (err) {
    console.error('[Gemini Chat Error]', err.message);
    res.status(500).json({ error: 'Erro ao processar sua pergunta. Tente novamente.' });
  }
});

app.post('/api/ai/cross-sell', authenticateToken, async (req, res) => {
  if (!geminiModel) return res.json({ suggestion: null, productName: null });
  const { cartItems } = req.body;
  if (!cartItems || cartItems.length === 0) return res.json({ suggestion: null, productName: null });

  try {
    const placeholders = cartItems.map(() => '?').join(',');
    const coOccurrences = db.prepare(`
      SELECT si2.name, COUNT(*) as frequency
      FROM sale_items si1 INNER JOIN sale_items si2 ON si1.saleId = si2.saleId AND si1.productId != si2.productId
      WHERE si1.name IN (${placeholders}) AND si2.name NOT IN (${placeholders})
      GROUP BY si2.productId ORDER BY frequency DESC LIMIT 5
    `).all(...cartItems, ...cartItems);

    if (coOccurrences.length === 0) return res.json({ suggestion: null, productName: null });

    const topCoProducts = coOccurrences.map(c => `${c.name} (${c.frequency}x)`).join(', ');
    const prompt = `Você é assistente de vendas de distribuidora de bebidas.
O cliente compra: ${cartItems.join(', ')}.
Histórico de compras casadas: ${topCoProducts}.
Sugira 1 produto complementar. Use o histórico e seu conhecimento (cerveja→gelo/salgadinho, destilados→energético/gelo, refrigerante→chocolate).
Resposta em NO MÁXIMO 10 palavras. Formato EXATO: PRODUTO|FRASE_CURTA
Exemplo: Gelo de Coco|Ideal para acompanhar seu Destilado!`;

    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    const parts = text.split('|');
    const suggestedName = parts.length >= 2 ? parts[0].trim() : text;
    const suggestedText = parts.length >= 2 ? parts[1].trim() : text;

    const inStockProduct = db.prepare('SELECT id, name, stock FROM products WHERE name = ? COLLATE NOCASE').get(suggestedName);
    if (inStockProduct && inStockProduct.stock > 0) {
      return res.json({ suggestion: suggestedText, productName: inStockProduct.name });
    }

    const now = new Date().toISOString();
    try {
      const existing = db.prepare('SELECT id, count FROM ai_suggestions WHERE productName = ? COLLATE NOCASE').get(suggestedName);
      if (existing) {
        db.prepare('UPDATE ai_suggestions SET count = count + 1, updatedAt = ?, suggestion = ? WHERE id = ?').run(now, suggestedText, existing.id);
      } else {
        db.prepare('INSERT INTO ai_suggestions (id, productName, suggestion, count, updatedAt) VALUES (?, ?, ?, ?, ?)').run(uuidv4(), suggestedName, suggestedText, 1, now);
      }
    } catch (dbErr) {
      console.error('[Cross-sell DB Error]', dbErr.message);
    }
    res.json({ suggestion: null, productName: null });
  } catch (err) {
    console.error('[Gemini Cross-sell Error]', err.message);
    res.json({ suggestion: null, productName: null });
  }
});

app.get('/api/ai/suggestions', authenticateToken, isAdmin, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM ai_suggestions ORDER BY count DESC, updatedAt DESC').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/suggestions/:id', authenticateToken, isAdmin, (req, res) => {
  try {
    db.prepare('DELETE FROM ai_suggestions WHERE id = ?').run(req.params.id);
    res.json({ message: 'Sugestão removida com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ROTA DE SAÚDE (health check para VPS)
// ==============================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: NODE_ENV, timestamp: new Date().toISOString() });
});

// Fallback para SPA em produção
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recebido. Encerrando servidor...');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('🛑 SIGINT recebido. Encerrando servidor...');
  process.exit(0);
});
