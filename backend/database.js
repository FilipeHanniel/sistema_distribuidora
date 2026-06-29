const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { normalizeEstablishmentCode } = require('./tenantIdentity');

const configuredDatabasePath = String(process.env.DATABASE_PATH || '').trim();
const databasePath = configuredDatabasePath
  ? (configuredDatabasePath === ':memory:' ? configuredDatabasePath : path.resolve(configuredDatabasePath))
  : path.join(__dirname, 'banco.sqlite');
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');

const initDB = () => {
  // ============================================================
  // TABELAS PRINCIPAIS
  // ============================================================
  db.prepare(`
    CREATE TABLE IF NOT EXISTS establishments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      loginCode TEXT,
      ownerName TEXT,
      email TEXT,
      phone TEXT,
      plan TEXT DEFAULT 'basic',
      monthlyAmount REAL DEFAULT 0,
      subscriptionStatus TEXT DEFAULT 'active',
      subscriptionDueDate TEXT,
      subscriptionGraceDays INTEGER DEFAULT 7,
      subscriptionStatusReason TEXT,
      subscriptionStatusUpdatedAt TEXT,
      notes TEXT,
      createdAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      password TEXT,
      name TEXT,
      role TEXT,
      establishmentId TEXT,
      active INTEGER DEFAULT 1,
      isDeleted INTEGER DEFAULT 0,
      authVersion INTEGER DEFAULT 0,
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
      ncm TEXT,
      cfop TEXT,
      csosn TEXT,
      cst TEXT,
      fiscalUnit TEXT DEFAULT 'UN',
      origin TEXT DEFAULT '0',
      taxRate REAL DEFAULT 0,
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

  db.prepare(`
    CREATE TABLE IF NOT EXISTS tenant_settings (
      establishmentId TEXT PRIMARY KEY,
      lowStockThreshold INTEGER NOT NULL DEFAULT 5,
      receiptAutoCloseSeconds INTEGER NOT NULL DEFAULT 5,
      receiptFooter TEXT DEFAULT '',
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      establishmentId TEXT,
      actorUserId TEXT,
      actorRole TEXT,
      action TEXT NOT NULL,
      entityType TEXT,
      entityId TEXT,
      metadata TEXT,
      createdAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS fiscal_settings (
      establishmentId TEXT PRIMARY KEY,
      enabled INTEGER DEFAULT 0,
      providerMode TEXT DEFAULT 'simulated',
      environment TEXT DEFAULT 'homologation',
      documentModel TEXT DEFAULT '65',
      serie TEXT DEFAULT '1',
      nextNumber INTEGER DEFAULT 1,
      cnpj TEXT,
      stateRegistration TEXT,
      legalName TEXT,
      tradeName TEXT,
      taxRegime TEXT DEFAULT 'simples',
      crt TEXT DEFAULT '1',
      streetName TEXT,
      streetNumber TEXT,
      district TEXT,
      cityName TEXT,
      cityCode TEXT,
      state TEXT DEFAULT 'GO',
      zipCode TEXT,
      complement TEXT,
      cscId TEXT,
      csc TEXT,
      certificatePath TEXT,
      certificatePassword TEXT,
      certificateFileName TEXT,
      certificateFingerprint TEXT,
      certificateSubject TEXT,
      certificateIssuer TEXT,
      certificateSerialNumber TEXT,
      certificateValidFrom TEXT,
      certificateValidTo TEXT,
      certificateUploadedAt TEXT,
      autoIssueOnPayment INTEGER DEFAULT 0,
      autoPrintOnAuthorization INTEGER DEFAULT 0,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS fiscal_documents (
      id TEXT PRIMARY KEY,
      establishmentId TEXT NOT NULL,
      saleId TEXT NOT NULL,
      model TEXT DEFAULT '65',
      serie TEXT,
      number INTEGER,
      environment TEXT DEFAULT 'homologation',
      status TEXT DEFAULT 'pending_configuration',
      cStat TEXT,
      accessKey TEXT,
      protocol TEXT,
      qrCodeUrl TEXT,
      xml TEXT,
      validationMessages TEXT,
      error TEXT,
      authorizedAt TEXT,
      printedAt TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      FOREIGN KEY (establishmentId) REFERENCES establishments(id),
      FOREIGN KEY (saleId) REFERENCES sales(id)
    )
  `).run();

  // ============================================================
  // MIGRAÇÕES
  // ============================================================
  const migrations = [
    'ALTER TABLE establishments ADD COLUMN loginCode TEXT',
    'ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1',
    'ALTER TABLE users ADD COLUMN isDeleted INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN establishmentId TEXT',
    'ALTER TABLE users ADD COLUMN authVersion INTEGER DEFAULT 0',
    'ALTER TABLE products ADD COLUMN establishmentId TEXT',
    'ALTER TABLE products ADD COLUMN ncm TEXT',
    'ALTER TABLE products ADD COLUMN cfop TEXT',
    'ALTER TABLE products ADD COLUMN csosn TEXT',
    'ALTER TABLE products ADD COLUMN cst TEXT',
    "ALTER TABLE products ADD COLUMN fiscalUnit TEXT DEFAULT 'UN'",
    "ALTER TABLE products ADD COLUMN origin TEXT DEFAULT '0'",
    'ALTER TABLE products ADD COLUMN taxRate REAL DEFAULT 0',
    'ALTER TABLE sales ADD COLUMN paymentMethod TEXT',
    'ALTER TABLE sales ADD COLUMN fiscalStatus TEXT',
    'ALTER TABLE sales ADD COLUMN userId TEXT',
    'ALTER TABLE sales ADD COLUMN establishmentId TEXT',
    'ALTER TABLE ai_suggestions ADD COLUMN establishmentId TEXT',
    'ALTER TABLE establishments ADD COLUMN monthlyAmount REAL DEFAULT 0',
    'ALTER TABLE establishments ADD COLUMN subscriptionGraceDays INTEGER DEFAULT 7',
    'ALTER TABLE establishments ADD COLUMN subscriptionStatusReason TEXT',
    'ALTER TABLE establishments ADD COLUMN subscriptionStatusUpdatedAt TEXT',
    'ALTER TABLE payment_transactions ADD COLUMN payload TEXT',
    'ALTER TABLE payment_transactions ADD COLUMN error TEXT',
    "ALTER TABLE fiscal_settings ADD COLUMN providerMode TEXT DEFAULT 'simulated'",
    'ALTER TABLE fiscal_settings ADD COLUMN certificateFileName TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateFingerprint TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateSubject TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateIssuer TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateSerialNumber TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateValidFrom TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateValidTo TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN certificateUploadedAt TEXT',
    "ALTER TABLE fiscal_settings ADD COLUMN crt TEXT DEFAULT '1'",
    'ALTER TABLE fiscal_settings ADD COLUMN streetName TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN streetNumber TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN district TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN cityName TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN cityCode TEXT',
    "ALTER TABLE fiscal_settings ADD COLUMN state TEXT DEFAULT 'GO'",
    'ALTER TABLE fiscal_settings ADD COLUMN zipCode TEXT',
    'ALTER TABLE fiscal_settings ADD COLUMN complement TEXT',
    'ALTER TABLE fiscal_documents ADD COLUMN validationMessages TEXT',
    'ALTER TABLE fiscal_documents ADD COLUMN cStat TEXT',
  ];
  for (const sql of migrations) {
    try { db.prepare(sql).run(); } catch (e) {}
  }

  // Versoes antigas tornavam o login globalmente unico. A tabela e recriada
  // para permitir o mesmo login em estabelecimentos diferentes.
  const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || '';
  if (/username\s+TEXT\s+UNIQUE/i.test(usersTableSql)) {
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        BEGIN;
        DROP TABLE IF EXISTS users_new;
        CREATE TABLE users_new (
          id TEXT PRIMARY KEY,
          username TEXT,
          password TEXT,
          name TEXT,
          role TEXT,
          establishmentId TEXT,
          active INTEGER DEFAULT 1,
          isDeleted INTEGER DEFAULT 0,
          authVersion INTEGER DEFAULT 0,
          createdAt TEXT
        );
        INSERT INTO users_new (id, username, password, name, role, establishmentId, active, isDeleted, authVersion, createdAt)
          SELECT id, username, password, name, role, establishmentId,
            COALESCE(active, 1), COALESCE(isDeleted, 0), COALESCE(authVersion, 0), createdAt
          FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        COMMIT;
      `);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_establishment ON users(establishmentId, isDeleted, role)',
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_scope ON users(COALESCE(establishmentId, '__platform__'), lower(username)) WHERE isDeleted = 0",
    'CREATE INDEX IF NOT EXISTS idx_products_establishment ON products(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_sales_establishment ON sales(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(saleId)',
    'CREATE INDEX IF NOT EXISTS idx_ai_suggestions_establishment ON ai_suggestions(establishmentId, updatedAt)',
    'CREATE INDEX IF NOT EXISTS idx_payments_establishment ON payments(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_pix_accounts_establishment ON pix_accounts(establishmentId, active, isDefault)',
    'CREATE INDEX IF NOT EXISTS idx_payment_transactions_establishment ON payment_transactions(establishmentId, status, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_ai_reports_establishment ON ai_reports(establishmentId, periodType, periodStart)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(establishmentId, audience, readAt, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_establishment ON audit_logs(establishmentId, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, createdAt)',
    'CREATE INDEX IF NOT EXISTS idx_fiscal_documents_sale ON fiscal_documents(establishmentId, saleId, status)',
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

  // Todo estabelecimento recebe um codigo curto e unico para o login.
  const usedLoginCodes = new Set();
  const establishmentRows = db.prepare('SELECT id, name, loginCode FROM establishments ORDER BY createdAt, id').all();
  const updateLoginCode = db.prepare('UPDATE establishments SET loginCode = ? WHERE id = ?');
  for (const establishment of establishmentRows) {
    const base = normalizeEstablishmentCode(establishment.loginCode || establishment.name) || 'estabelecimento';
    let candidate = base;
    let suffix = 2;
    while (usedLoginCodes.has(candidate)) candidate = `${base}-${suffix++}`;
    usedLoginCodes.add(candidate);
    if (establishment.loginCode !== candidate) updateLoginCode.run(candidate, establishment.id);
  }
  db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_establishments_login_code ON establishments(lower(loginCode))').run();

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
      db.prepare("UPDATE users SET username = 'gestor', name = 'Gestor Padrão' WHERE id = ?")
        .run(adminUser.id);
      console.log('🔄 Login legado "admin" renomeado para "gestor".');
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
    const isProduction = process.env.NODE_ENV === 'production';
    const configuredPassword = String(process.env.SUPERADMIN_PASSWORD || '').trim();
    if (isProduction && (!configuredPassword || configuredPassword === 'troque_em_producao')) {
      throw new Error('SUPERADMIN_PASSWORD seguro e obrigatorio na primeira inicializacao em producao.');
    }
    const SUPERADMIN_PWD = configuredPassword || 'superadmin123';
    db.prepare(`
      INSERT INTO users (id, username, password, name, role, active, isDeleted, createdAt)
      VALUES ('superadmin-uuid-1', 'superadmin', ?, 'Super Administrador', 'superadmin', 1, 0, ?)
    `).run(bcrypt.hashSync(SUPERADMIN_PWD, salt), new Date().toISOString());
    console.log('🔑 Usuario SuperAdmin inicial criado.');
  }

  // Criar gestor padrão se nenhum existir no estabelecimento padrão
  const gestorCount = db.prepare(
    "SELECT COUNT(*) as c FROM users WHERE establishmentId = ? AND role = 'gestor' AND isDeleted = 0"
  ).get(DEFAULT_EST_ID);
  if (gestorCount.c === 0 && process.env.NODE_ENV !== 'production') {
    const salt = bcrypt.genSaltSync(10);
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password, name, role, establishmentId, active, isDeleted, createdAt)
      VALUES ('gestor-default-1', 'gestor', ?, 'Gestor Padrão', 'gestor', ?, 1, 0, ?)
    `).run(bcrypt.hashSync('gestor123', salt), DEFAULT_EST_ID, new Date().toISOString());
    console.log('👔 Gestor padrao de desenvolvimento criado.');
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
