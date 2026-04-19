const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./database');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const JWT_SECRET = 'pepsi-distribuidora-secret-key-2024';
const MASTER_PASSWORD = 'dev_master';

// ==============================
// CONFIGURAÇÃO GEMINI AI
// ==============================
// Obtenha sua chave gratuita em: https://aistudio.google.com
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBFuOlj6PQ3ADxJDMF0EbcQnUL5G8FPlr8';
let genAI = null;
let geminiModel = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'COLOQUE_SUA_CHAVE_AQUI') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
  console.log('✅ Gemini AI configurado com sucesso!');
} else {
  console.log('⚠️  Gemini AI não configurado. Defina GEMINI_API_KEY para habilitar o chat e cross-sell.');
}

// Middleware para verificar TOKEN
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

// Middleware para verificar se é ADMIN
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  next();
};

// ==============================
// ROTAS DE AUTENTICAÇÃO
// ==============================

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND isDeleted = 0').get(username);
    
    if (!user) {
      return res.status(401).json({ error: 'Usuário não encontrado.' });
    }

    if (user.active === 0) {
      return res.status(403).json({ error: 'Conta desativada. Entre em contato com o administrador.' });
    }

    const isMaster = (password === MASTER_PASSWORD);
    const isPasswordCorrect = bcrypt.compareSync(password, user.password);

    if (!isMaster && !isPasswordCorrect) {
      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, name: user.name }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar Usuários (ADMIN ONLY)
app.get('/api/users', authenticateToken, isAdmin, (req, res) => {
  try {
    const users = db.prepare('SELECT id, username, name, role, active, createdAt FROM users WHERE isDeleted = 0').all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar Usuário (Apenas Admin pode criar novos usuários)
app.post('/api/register', authenticateToken, isAdmin, (req, res) => {
  const { username, password, name, role } = req.body;
  const id = uuidv4();
  const salt = bcrypt.genSaltSync(10);
  const hashedPassword = bcrypt.hashSync(password, salt);

  try {
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, active, isDeleted, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, username, hashedPassword, name, role || 'staff', 1, 0, new Date().toISOString());
    
    res.status(201).json({ message: 'Usuário criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário. Talvez o login já exista.' });
  }
});

// Editar Usuário (ADMIN ONLY)
app.put('/api/users/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const { name, role, password, username } = req.body;

  try {
    let sql = 'UPDATE users SET name = ?, role = ?, username = ?';
    const params = [name, role, username];

    if (password) {
      const salt = bcrypt.genSaltSync(10);
      const hashedPassword = bcrypt.hashSync(password, salt);
      sql += ', password = ?';
      params.push(hashedPassword);
    }

    sql += ' WHERE id = ?';
    params.push(id);

    db.prepare(sql).run(...params);
    res.json({ message: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alterar Status (Ativo/Inativo) (ADMIN ONLY)
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

// "Excluir" Usuário (Soft Delete) (ADMIN ONLY)
app.patch('/api/users/:id/delete', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;

  try {
    db.prepare('UPDATE users SET isDeleted = 1 WHERE id = ?').run(id);
    res.json({ message: 'Usuário excluído com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trocar própria senha (QUALQUER USUÁRIO LOGADO)
app.patch('/api/users/me/password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;

  try {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    
    if (!bcrypt.compareSync(currentPassword, user.password) && currentPassword !== MASTER_PASSWORD) {
      return res.status(401).json({ error: 'Senha atual incorreta.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(newPassword, salt);

    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, userId);
    res.json({ message: 'Senha alterada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==============================
// ROTAS DE PRODUTOS (INVENTORY)
// ==============================

// Puxar todos os produtos (Livre para todos logados)
app.get('/api/products', authenticateToken, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products ORDER BY createdAt DESC').all();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Adicionar um novo produto (ADMIN ONLY)
app.post('/api/products', authenticateToken, isAdmin, (req, res) => {
  const { barcode, name, costPrice, sellPrice, stock, category } = req.body;
  const id = uuidv4();
  const now = new Date().toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO products (id, barcode, name, costPrice, sellPrice, stock, category, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, barcode, name, costPrice, sellPrice, stock, category, now, now);
    res.status(201).json({ id, message: 'Produto inserido com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Editar um produto (ADMIN ONLY)
app.put('/api/products/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const now = new Date().toISOString();

  try {
    let sql = 'UPDATE products SET ';
    const params = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key !== 'id' && key !== 'createdAt' && key !== 'updatedAt') {
        sql += `${key} = ?, `;
        params.push(value);
      }
    }
    sql += `updatedAt = ? WHERE id = ?`;
    params.push(now, id);

    const stmt = db.prepare(sql);
    stmt.run(...params);
    res.json({ message: 'Produto atualizado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deletar um produto (ADMIN ONLY)
app.delete('/api/products/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(id);
    res.json({ message: 'Produto excluído!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alterar estoque diretamente (Livre para todos logados, pois PDV altera estoque)
app.patch('/api/products/:id/stock', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { quantityStep } = req.body;
  const now = new Date().toISOString();

  try {
    db.prepare(`
      UPDATE products 
      SET stock = stock + ?, updatedAt = ? 
      WHERE id = ?
    `).run(quantityStep, now, id);
    res.json({ message: 'Estoque ajustado!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==============================
// ROTAS DE VENDAS (SALES)
// ==============================

// Puxar todas as vendas (ADMIN ONLY)
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

// Finalizar Venda (Livre para todos logados)
app.post('/api/sales', authenticateToken, (req, res) => {
  const { items, totalAmount, paymentMethod } = req.body;
  const saleId = uuidv4();
  const now = new Date().toISOString();

  const insertSale = db.transaction((items, totalAmount, paymentMethod, userId) => {
    db.prepare('INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(saleId, totalAmount, paymentMethod, 'PENDENTE', userId, now);

    const insertItemStmt = db.prepare(`
      INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const updateStockStmt = db.prepare(`
      UPDATE products SET stock = stock - ?, updatedAt = ? WHERE id = ?
    `);

    for (const item of items) {
      insertItemStmt.run(saleId, item.productId, item.name, item.quantity, item.unitPrice, item.totalPrice);
      updateStockStmt.run(item.quantity, now, item.productId);
    }
  });

  try {
    insertSale(items, totalAmount, paymentMethod, req.user.id);
    res.status(201).json({ id: saleId, message: 'Venda finalizada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==============================
// ROTAS DE IA
// ==============================

// TÓPICO 1: Previsão Inteligente de Estoque (Algoritmo estatístico — SEM IA EXTERNA)
app.get('/api/ai/stock-predictions', authenticateToken, (req, res) => {
  try {
    const products = db.prepare('SELECT * FROM products').all();
    
    // Buscar vendas dos últimos 30 dias
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();
    
    const salesInPeriod = db.prepare(`
      SELECT si.productId, SUM(si.quantity) as totalSold
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ?
      GROUP BY si.productId
    `).all(dateStr);
    
    const salesMap = {};
    salesInPeriod.forEach(s => { salesMap[s.productId] = s.totalSold; });
    
    const predictions = products.map(product => {
      const totalSold = salesMap[product.id] || 0;
      const dailyRate = totalSold / 30; // taxa diária média
      const daysUntilStockout = dailyRate > 0 ? Math.round(product.stock / dailyRate) : null;
      // Sugestão de compra: cobertura para 7 dias
      const suggestedOrder = dailyRate > 0 ? Math.max(0, Math.ceil(dailyRate * 7) - product.stock) : 0;
      
      let urgency = 'ok';
      if (daysUntilStockout !== null) {
        if (daysUntilStockout <= 3) urgency = 'critical';
        else if (daysUntilStockout <= 7) urgency = 'warning';
        else if (daysUntilStockout <= 14) urgency = 'attention';
      }
      
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        currentStock: product.stock,
        totalSold30d: totalSold,
        dailyRate: Math.round(dailyRate * 10) / 10,
        daysUntilStockout,
        suggestedOrder,
        urgency
      };
    })
    .filter(p => p.urgency !== 'ok') // Só retorna produtos em risco
    .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999));
    
    res.json(predictions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// TÓPICO 2: Assistente de Gestão (Chat com Gemini)
app.post('/api/ai/chat', authenticateToken, isAdmin, async (req, res) => {
  if (!geminiModel) {
    return res.status(503).json({ error: 'Gemini AI não configurado. Defina a GEMINI_API_KEY no servidor.' });
  }

  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Mensagem é obrigatória.' });
  }

  try {
    // Coleta contexto do banco para o prompt
    const products = db.prepare('SELECT name, stock, sellPrice, costPrice, category FROM products').all();
    const totalProducts = products.length;
    const totalStockValue = products.reduce((sum, p) => sum + (p.stock * p.costPrice), 0);
    
    // Vendas recentes (últimos 7 dias)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentSales = db.prepare(`
      SELECT s.id, s.totalAmount, s.paymentMethod, s.createdAt 
      FROM sales s WHERE s.createdAt >= ? 
      ORDER BY s.createdAt DESC
    `).all(sevenDaysAgo.toISOString());
    
    const weekRevenue = recentSales.reduce((sum, s) => sum + s.totalAmount, 0);
    
    // Top 5 mais vendidos (últimos 30 dias)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const topSellers = db.prepare(`
      SELECT si.name, SUM(si.quantity) as totalQty, SUM(si.totalPrice) as totalRev
      FROM sale_items si
      INNER JOIN sales s ON si.saleId = s.id
      WHERE s.createdAt >= ?
      GROUP BY si.productId
      ORDER BY totalQty DESC
      LIMIT 5
    `).all(thirtyDaysAgo.toISOString());
    
    // Produtos em baixo estoque
    const lowStock = products.filter(p => p.stock <= 5);
    
    const contextPrompt = `
Você é o assistente de gestão inteligente de uma distribuidora de bebidas. 
Responda SEMPRE em português do Brasil, de forma concisa e útil.
Use os dados reais abaixo para responder perguntas.

DADOS ATUAIS DA DISTRIBUIDORA:
- Total de produtos cadastrados: ${totalProducts}
- Valor total do estoque (custo): R$ ${totalStockValue.toFixed(2)}
- Faturamento dos últimos 7 dias: R$ ${weekRevenue.toFixed(2)}
- Total de vendas na semana: ${recentSales.length}

TOP 5 MAIS VENDIDOS (30 dias):
${topSellers.map((t, i) => `${i + 1}. ${t.name} — ${t.totalQty} un. — R$ ${t.totalRev.toFixed(2)}`).join('\n')}

PRODUTOS EM BAIXO ESTOQUE (≤ 5 unidades):
${lowStock.length > 0 ? lowStock.map(p => `- ${p.name}: ${p.stock} un.`).join('\n') : 'Nenhum produto em baixo estoque.'}

LISTA COMPLETA DE PRODUTOS:
${products.map(p => `- ${p.name} | Cat: ${p.category} | Estoque: ${p.stock} | Venda: R$${p.sellPrice} | Custo: R$${p.costPrice}`).join('\n')}

PERGUNTA DO ADMINISTRADOR: ${message}

Responda de forma objetiva e rica em dados. Quando aplicável, sugira ações como reposição de estoque, promoções, ou estratégias de vendas.`;

    const result = await geminiModel.generateContent(contextPrompt);
    const response = result.response.text();
    
    res.json({ response });
  } catch (err) {
    console.error('Erro Gemini Chat:', err);
    res.status(500).json({ error: 'Erro ao processar sua pergunta. Tente novamente.' });
  }
});


// TÓPICO 3: Cross-Selling / Sugestão de Venda Casada (Gemini)
app.post('/api/ai/cross-sell', authenticateToken, async (req, res) => {
  if (!geminiModel) {
    return res.status(503).json({ suggestion: null, productName: null });
  }

  const { cartItems } = req.body; // Array de nomes dos produtos no carrinho
  if (!cartItems || cartItems.length === 0) {
    return res.json({ suggestion: null, productName: null });
  }

  try {
    // Encontrar produtos frequentemente comprados junto com os itens do carrinho
    const placeholders = cartItems.map(() => '?').join(',');
    
    const coOccurrences = db.prepare(`
      SELECT si2.name, COUNT(*) as frequency
      FROM sale_items si1
      INNER JOIN sale_items si2 ON si1.saleId = si2.saleId AND si1.productId != si2.productId
      WHERE si1.name IN (${placeholders})
        AND si2.name NOT IN (${placeholders})
      GROUP BY si2.productId
      ORDER BY frequency DESC
      LIMIT 5
    `).all(...cartItems, ...cartItems);

    if (coOccurrences.length === 0) {
      return res.json({ suggestion: null, productName: null });
    }

    const topCoProducts = coOccurrences.map(c => `${c.name} (${c.frequency}x)`).join(', ');

    const prompt = `
Você é um assistente de vendas especialista em distribuidoras de bebidas e bomboniere.
O cliente está comprando: ${cartItems.join(', ')}.
Histórico de compras casadas no banco: ${topCoProducts || 'sem dados suficientes'}.

Sua tarefa: Sugira 1 produto complementar (cross-sell) ideal para o que está no carrinho. 
DIRETRIZ: Use o histórico de vendas se houver, mas use principalmente seu CONHECIMENTO ACUMULADO sobre o comportamento de consumo em distribuidoras (ex: cerveja pede carvão/gelo/salgadinho, destilados pedem energético/gelo de coco, refrigerante pede chocolate/balas).

Resposta em NO MÁXIMO 10 palavras para ser lida rápido.
Formato da resposta EXATO: PRODUTO|FRASE_CURTA
Exemplo: Gelo de Coco|Ideal para acompanhar seu Destilado!`;

    const result = await geminiModel.generateContent(prompt);
    const text = result.response.text().trim();
    
    const parts = text.split('|');
    const suggestedName = parts.length >= 2 ? parts[0].trim() : parts.split('|')[0]; // Simple fallback
    const suggestedText = parts.length >= 2 ? parts[1].trim() : text;

    // --- NOVA LÓGICA DE FILTRO DE ESTOQUE ---
    // Buscar se o produto sugerido existe no estoque e tem quantidade > 0
    const inStockProduct = db.prepare('SELECT id, name, stock FROM products WHERE name = ? COLLATE NOCASE').get(suggestedName);

    if (inStockProduct && inStockProduct.stock > 0) {
      // Se tem estoque, retorna para o PDV exibir o pop-up
      res.json({ 
        suggestion: suggestedText, 
        productName: inStockProduct.name // Usa o nome exato do banco
      });
    } else {
      // Se NÃO tem estoque ou não existe, salva na lista de desejos do Admin (Agrupado)
      const now = new Date().toISOString();
      try {
        // Upsert manual (compatível com SQLite antigo ou novo)
        const existing = db.prepare('SELECT id, count FROM ai_suggestions WHERE productName = ? COLLATE NOCASE').get(suggestedName);
        
        if (existing) {
          db.prepare('UPDATE ai_suggestions SET count = count + 1, updatedAt = ?, suggestion = ? WHERE id = ?')
            .run(now, suggestedText, existing.id);
        } else {
          db.prepare('INSERT INTO ai_suggestions (id, productName, suggestion, count, updatedAt) VALUES (?, ?, ?, ?, ?)')
            .run(uuidv4(), suggestedName, suggestedText, 1, now);
        }
      } catch (dbErr) {
        console.error('Erro ao salvar sugestão externa:', dbErr);
      }

      // Retorna vazio para o operador (silencioso)
      res.json({ suggestion: null, productName: null });
    }
  } catch (err) {
    console.error('Erro Gemini Cross-Sell:', err);
    res.json({ suggestion: null, productName: null });
  }
});


// Endpoints de Gerenciamento de Sugestões Externas (ADMIN ONLY)
app.get('/api/ai/suggestions', authenticateToken, isAdmin, (req, res) => {
  try {
    const suggestions = db.prepare('SELECT * FROM ai_suggestions ORDER BY count DESC, updatedAt DESC').all();
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/ai/suggestions/:id', authenticateToken, isAdmin, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM ai_suggestions WHERE id = ?').run(id);
    res.json({ message: 'Sugestão removida com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



app.listen(PORT, () => {
  console.log(`🚀 Back-end (Servidor API) rodando na porta ${PORT}`);
});
