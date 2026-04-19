const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

// Criar (ou abrir se já existir) o arquivo do banco de dados SQLite na mesma pasta.
const db = new Database(path.join(__dirname, 'banco.sqlite'), { verbose: console.log });

// Inicia as Tabelas se não existirem
const initDB = () => {
  // Tabela de Usuários
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      name TEXT,
      role TEXT,
      active INTEGER DEFAULT 1,
      isDeleted INTEGER DEFAULT 0,
      createdAt TEXT
    )
  `).run();

  // Tabela de Produtos (Inventory)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      barcode TEXT,
      name TEXT,
      costPrice REAL,
      sellPrice REAL,
      stock INTEGER,
      category TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `).run();

  // Tabela de Vendas (Sales) - Atualizada com paymentMethod e fiscalStatus
  db.prepare(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      totalAmount REAL,
      paymentMethod TEXT,
      fiscalStatus TEXT,
      userId TEXT,
      createdAt TEXT
    )
  `).run();

  // Tabela de Sugestões Externas da IA (Oportunidades de Compra)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id TEXT PRIMARY KEY,
      productName TEXT UNIQUE,
      suggestion TEXT,
      count INTEGER DEFAULT 1,
      updatedAt TEXT
    )
  `).run();

  // Migrações para bancos existentes
  try {
    db.prepare('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE users ADD COLUMN isDeleted INTEGER DEFAULT 0').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE sales ADD COLUMN paymentMethod TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE sales ADD COLUMN fiscalStatus TEXT').run();
  } catch (e) {}
  try {
    db.prepare('ALTER TABLE sales ADD COLUMN userId TEXT').run();
  } catch (e) {}

  // Tabela de Itens da Venda (SaleItems) - Relacionado com Sale
  db.prepare(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      saleId TEXT,
      productId TEXT,
      name TEXT,
      quantity INTEGER,
      unitPrice REAL,
      totalPrice REAL,
      FOREIGN KEY (saleId) REFERENCES sales(id)
    )
  `).run();

  // Criar Usuário Admin Padrão se a tabela estiver vazia
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const salt = bcrypt.genSaltSync(10);
    const adminPassword = bcrypt.hashSync('admin123', salt);
    const operadorPassword = bcrypt.hashSync('123', salt);

    // Criar Admin
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('admin-uuid-1', 'admin', adminPassword, 'Administrador', 'admin', new Date().toISOString());
    
    // Criar Operador
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('operador-uuid-1', 'operador', operadorPassword, 'Operador Fulano', 'staff', new Date().toISOString());

    console.log('Usuários padrão criados:');
    console.log('- Admin: admin / admin123');
    console.log('- Operador: operador / 123');
  }

  console.log('Banco de Dados SQLite conectado e tabelas verificadas!');
};

initDB();

module.exports = db;
