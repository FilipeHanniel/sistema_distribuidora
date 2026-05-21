const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'banco.sqlite'));
db.pragma('foreign_keys = ON');

const initDB = () => {
  // ============================================================
  // TABELAS PRINCIPAIS
  // ============================================================
  db.prepare(`
    CREATE TABLE IF NOT EXISTS establishments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ownerName TEXT,
      email TEXT,
      phone TEXT,
      plan TEXT DEFAULT 'basic',
      monthlyAmount REAL DEFAULT 0,
      subscriptionStatus TEXT DEFAULT 'active',
      subscriptionDueDate TEXT,
      notes TEXT,
      createdAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE,
      password TEXT,
      name TEXT,
      role TEXT,
      establishmentId TEXT,
      active INTEGER DEFAULT 1,
      isDeleted INTEGER DEFAULT 0,
      createdAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      barcode TEXT,
      name TEXT,
      costPrice REAL,
      sellPrice REAL,
      stock INTEGER,
      category TEXT,
      establishmentId TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      totalAmount REAL,
      paymentMethod TEXT,
      fiscalStatus TEXT,
      userId TEXT,
      establishmentId TEXT,
      createdAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id TEXT PRIMARY KEY,
      productName TEXT,
      suggestion TEXT,
      count INTEGER DEFAULT 1,
      establishmentId TEXT,
      updatedAt TEXT
    )
  `).run();

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

  // Tabela de Cobranças/Pagamentos
  db.prepare(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      establishmentId TEXT NOT NULL,
      amount REAL NOT NULL,
      dueDate TEXT,
      paidAt TEXT,
      notes TEXT,
      createdAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pix_accounts (
      id TEXT PRIMARY KEY,
      establishmentId TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      pixKey TEXT,
      credentials TEXT,
      active INTEGER DEFAULT 1,
      isDefault INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id TEXT PRIMARY KEY,
      establishmentId TEXT NOT NULL,
      pixAccountId TEXT,
      provider TEXT NOT NULL,
      providerTransactionId TEXT,
      saleId TEXT,
      status TEXT DEFAULT 'pending',
      amount REAL NOT NULL,
      paymentMethod TEXT DEFAULT 'pix',
      qrCode TEXT,
      qrCodeBase64 TEXT,
      ticketUrl TEXT,
      payload TEXT,
      error TEXT,
      expiresAt TEXT,
      paidAt TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id),
      FOREIGN KEY (pixAccountId) REFERENCES pix_accounts(id),
      FOREIGN KEY (saleId) REFERENCES sales(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_reports (
      id TEXT PRIMARY KEY,
      establishmentId TEXT NOT NULL,
      periodType TEXT NOT NULL,
      periodStart TEXT NOT NULL,
      periodEnd TEXT NOT NULL,
      content TEXT NOT NULL,
      metrics TEXT,
      createdAt TEXT,
      UNIQUE(establishmentId, periodType, periodStart),
      FOREIGN KEY (establishmentId) REFERENCES establishments(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      establishmentId TEXT,
      userId TEXT,
      audience TEXT DEFAULT 'gestor',
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      referenceType TEXT,
      referenceId TEXT,
      readAt TEXT,
      scheduledFor TEXT,
      createdAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `).run();

  // ============================================================
  // MIGRAÇÕES
  // ============================================================
  const migrations = [
    'ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN isDeleted INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN establishmentId TEXT',
    'ALTER TABLE products ADD COLUMN establishmentId TEXT',
    'ALTER TABLE sales ADD COLUMN paymentMethod TEXT',
    'ALTER TABLE sales ADD COLUMN fiscalStatus TEXT',
    'ALTER TABLE sales ADD COLUMN userId TEXT',
    'ALTER TABLE sales ADD COLUMN establishmentId TEXT',
    'ALTER TABLE ai_suggestions ADD COLUMN establishmentId TEXT',
    'ALTER TABLE establishments ADD COLUMN monthlyAmount REAL DEFAULT 0',
    'ALTER TABLE payment_transactions ADD COLUMN payload TEXT',
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (e) {}
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_establishment ON users(establishmentId, isDeleted, role)',
    'CREATE INDEX IF NOT EXISTS idx_products_establishment ON products(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_sales_establishment ON sales(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(saleId)',
    'CREATE INDEX IF NOT EXISTS idx_ai_suggestions_establishment ON ai_suggestions(establishmentId, updatedAt)',
    'CREATE INDEX IF NOT EXISTS idx_payments_establishment ON payments(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_pix_accounts_establishment ON pix_accounts(establishmentId, active, isDefault)',
    'CREATE INDEX IF NOT EXISTS idx_payment_transactions_establishment ON payment_transactions(establishmentId, status, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_ai_reports_establishment ON ai_reports(establishmentId, periodType, periodStart)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(establishmentId, audience, readAt, createdAt)',
  ];
  for (const sql of indexes) {
    try { db.prepare(sql).run(); } catch (e) {}
  }

  // ============================================================
  // ESTABELECIMENTO PADRÃO (dados legados)
  // ============================================================
  const DEFAULT_EST_ID = 'default-establishment-1';
  const defaultEst = db.prepare('SELECT id FROM establishments WHERE id = ?').get(DEFAULT_EST_ID);
  if (!defaultEst) {
    const dueDate = addOneMonth(new Date().toISOString());
    db.prepare(`
      INSERT INTO establishments (id, name, ownerName, plan, monthlyAmount, subscriptionStatus, subscriptionDueDate, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(DEFAULT_EST_ID, 'Estabelecimento Padrão', 'Gestor Padrão', 'basic', 0, 'active',
      dueDate, new Date().toISOString());
  }

  // Migrar roles legados
  try {
    db.prepare("UPDATE users SET role = 'gestor' WHERE role = 'admin' AND role != 'superadmin'").run();
    db.prepare("UPDATE users SET role = 'operador' WHERE role = 'staff'").run();
    db.prepare("UPDATE users SET establishmentId = ? WHERE establishmentId IS NULL AND role != 'superadmin'").run(DEFAULT_EST_ID);
    db.prepare("UPDATE products SET establishmentId = ? WHERE establishmentId IS NULL").run(DEFAULT_EST_ID);
    db.prepare("UPDATE sales SET establishmentId = ? WHERE establishmentId IS NULL").run(DEFAULT_EST_ID);
    db.prepare("UPDATE ai_suggestions SET establishmentId = ? WHERE establishmentId IS NULL").run(DEFAULT_EST_ID);
  } catch (e) {}

  // ============================================================
  // RENOMEAR USUÁRIO 'admin' PARA 'gestor' (migração de credencial)
  // ============================================================
  try {
    const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin' AND role = 'gestor' AND isDeleted = 0").get();
    const gestorAlready = db.prepare("SELECT id FROM users WHERE username = 'gestor' AND isDeleted = 0").get();

    if (adminUser && !gestorAlready) {
      const salt = bcrypt.genSaltSync(10);
      db.prepare("UPDATE users SET username = 'gestor', name = 'Gestor Padrão', password = ? WHERE id = ?")
        .run(bcrypt.hashSync('gestor123', salt), adminUser.id);
      console.log('🔄 Login "admin" renomeado para "gestor" (senha: gestor123)');
    } else if (adminUser && gestorAlready) {
      // Desativar o 'admin' duplicado
      db.prepare("UPDATE users SET isDeleted = 1 WHERE username = 'admin' AND role = 'gestor'").run();
    }
  } catch (e) {}

  // ============================================================
  // CRIAR SUPERADMIN SE NÃO EXISTIR
  // ============================================================
  const superAdminExists = db.prepare("SELECT id FROM users WHERE role = 'superadmin'").get();
  if (!superAdminExists) {
    const salt = bcrypt.genSaltSync(10);
    const SUPERADMIN_PWD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, active, isDeleted, createdAt)
      VALUES ('superadmin-uuid-1', 'superadmin', ?, 'Super Administrador', 'superadmin', 1, 0, ?)
    `).run(bcrypt.hashSync(SUPERADMIN_PWD, salt), new Date().toISOString());
    console.log('🔑 SuperAdmin: superadmin / ' + SUPERADMIN_PWD);
  }

  // Criar gestor padrão se nenhum existir no estabelecimento padrão
  const gestorCount = db.prepare(
    "SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role = 'gestor' AND isDeleted = 0"
  ).get(DEFAULT_EST_ID);
  if (gestorCount.c === 0) {
    const salt = bcrypt.genSaltSync(10);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt)
      VALUES ('gestor-default-1', 'gestor', ?, 'Gestor Padrão', 'gestor', ?, 1, 0, ?)
    `).run(bcrypt.hashSync('gestor123', salt), DEFAULT_EST_ID, new Date().toISOString());
    console.log('👔 Gestor padrão: gestor / gestor123');
  }

  console.log('Banco de Dados SQLite conectado e tabelas verificadas!');
};

// Avança a data em 1 mês (mantendo o dia, com tratamento de fim de mês)
function addOneMonth(isoDateStr) {
  const d = new Date(isoDateStr);
  const originalDay = d.getDate();
  d.setMonth(d.getMonth() + 1);
  if (d.getDate() !== originalDay) d.setDate(0); // Ex.: 31/jan → 28/fev
  return d.toISOString();
}

initDB();

module.exports = db;
module.exports.addOneMonth = addOneMonth;
