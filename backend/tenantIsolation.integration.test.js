const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { once } = require('node:events');
const bcrypt = require('bcryptjs');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distribuidora-tenant-test-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tempDir, 'tenant-test.sqlite');
process.env.JWT_SECRET = 'tenant-test-jwt-secret-with-more-than-32-characters';
process.env.SUPERADMIN_PASSWORD = 'superadmin-test-123';
process.env.GEMINI_API_KEY = '';

const db = require('./database');
const { reconcileSubscriptions, startServer } = require('./server');

const now = new Date().toISOString();
let server;
let baseUrl;
let tokenA;
let tokenB;
let superToken;

const request = async (pathname, { token, method = 'GET', body } = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
};

const login = async (establishment, password) => request('/api/login', {
  method: 'POST',
  body: { establishment, username: 'gestor', password },
});

const seedDatabase = () => {
  db.exec('DELETE FROM users; DELETE FROM establishments;');
  const insertEstablishment = db.prepare(`
    INSERT INTO establishments (
      id, name, loginCode, ownerName, plan, subscriptionStatus, subscriptionDueDate, createdAt
    ) VALUES (?, ?, ?, ?, 'enterprise', 'active', ?, ?)
  `);
  insertEstablishment.run('est-a', 'Loja A', 'loja-a', 'Gestor A', '2030-01-01T00:00:00.000Z', now);
  insertEstablishment.run('est-b', 'Loja B', 'loja-b', 'Gestor B', '2030-01-01T00:00:00.000Z', now);

  const insertUser = db.prepare(`
    INSERT INTO users (
      id, username, password, name, role, establishmentId, active, isDeleted, authVersion, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, ?)
  `);
  insertUser.run('gestor-a', 'gestor', bcrypt.hashSync('senha-a-123', 4), 'Gestor A', 'gestor', 'est-a', now);
  insertUser.run('gestor-b', 'gestor', bcrypt.hashSync('senha-b-123', 4), 'Gestor B', 'gestor', 'est-b', now);
  insertUser.run('operador-a', 'caixa', bcrypt.hashSync('caixa-a-123', 4), 'Caixa A', 'operador', 'est-a', now);
  insertUser.run('operador-b', 'caixa', bcrypt.hashSync('caixa-b-123', 4), 'Caixa B', 'operador', 'est-b', now);
  insertUser.run(
    'superadmin-test',
    'superadmin',
    bcrypt.hashSync('superadmin-test-123', 4),
    'Super Admin',
    'superadmin',
    null,
    now
  );

  const insertProduct = db.prepare(`
    INSERT INTO products (
      id, barcode, name, costPrice, sellPrice, stock, category, establishmentId, createdAt, updatedAt
    ) VALUES (?, ?, ?, 1, 2, 10, 'Teste', ?, ?, ?)
  `);
  insertProduct.run('product-a', 'A001', 'Produto A', 'est-a', now, now);
  insertProduct.run('product-b', 'B001', 'Produto B', 'est-b', now, now);

  const insertSale = db.prepare(`
    INSERT INTO sales (id, totalAmount, paymentMethod, fiscalStatus, userId, establishmentId, createdAt)
    VALUES (?, 2, 'money', 'not_required', ?, ?, ?)
  `);
  insertSale.run('sale-a', 'gestor-a', 'est-a', now);
  insertSale.run('sale-b', 'gestor-b', 'est-b', now);
  db.prepare(`
    INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice)
    VALUES (?, ?, ?, 1, 2, 2)
  `).run('sale-a', 'product-a', 'Produto A');
  db.prepare(`
    INSERT INTO sale_items (saleId, productId, name, quantity, unitPrice, totalPrice)
    VALUES (?, ?, ?, 1, 2, 2)
  `).run('sale-b', 'product-b', 'Produto B');

  const insertAccount = db.prepare(`
    INSERT INTO pix_accounts (
      id, establishmentId, name, provider, credentials, active, isDefault, createdAt, updatedAt
    ) VALUES (?, ?, ?, 'fake', '{}', 1, 1, ?, ?)
  `);
  insertAccount.run('account-a', 'est-a', 'Conta A', now, now);
  insertAccount.run('account-b', 'est-b', 'Conta B', now, now);

  const insertTransaction = db.prepare(`
    INSERT INTO payment_transactions (
      id, establishmentId, pixAccountId, provider, status, amount, paymentMethod, createdAt, updatedAt
    ) VALUES (?, ?, ?, 'fake', 'paid', 2, 'pix', ?, ?)
  `);
  insertTransaction.run('transaction-a', 'est-a', 'account-a', now, now);
  insertTransaction.run('transaction-b', 'est-b', 'account-b', now, now);
};

before(async () => {
  seedDatabase();
  server = startServer({ port: 0, host: '127.0.0.1' });
  if (!server.listening) await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const loginA = await login('loja-a', 'senha-a-123');
  const loginB = await login('loja-b', 'senha-b-123');
  const loginSuper = await request('/api/login', {
    method: 'POST',
    body: { establishment: 'plataforma', username: 'superadmin', password: 'superadmin-test-123' },
  });
  assert.equal(loginA.status, 200);
  assert.equal(loginB.status, 200);
  assert.equal(loginSuper.status, 200);
  tokenA = loginA.payload.token;
  tokenB = loginB.payload.token;
  superToken = loginSuper.payload.token;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('separa o mesmo nome de usuario pelo codigo do estabelecimento', async () => {
  const loginA = await login('loja-a', 'senha-a-123');
  const loginB = await login('loja-b', 'senha-b-123');
  const wrongScope = await login('loja-a', 'senha-b-123');

  assert.equal(loginA.payload.user.establishmentId, 'est-a');
  assert.equal(loginB.payload.user.establishmentId, 'est-b');
  assert.equal(wrongScope.status, 401);
});

test('isola consultas de produtos, usuarios, vendas, contas e transacoes', async () => {
  const [products, users, sales, accounts, transactions] = await Promise.all([
    request('/api/products', { token: tokenA }),
    request('/api/users', { token: tokenA }),
    request('/api/sales', { token: tokenA }),
    request('/api/pix/accounts', { token: tokenA }),
    request('/api/payments/transactions', { token: tokenA }),
  ]);

  assert.deepEqual(products.payload.map(item => item.id), ['product-a']);
  assert.deepEqual(users.payload.map(item => item.establishmentId), ['est-a', 'est-a']);
  assert.deepEqual(sales.payload.map(item => item.id), ['sale-a']);
  assert.deepEqual(accounts.payload.map(item => item.id), ['account-a']);
  assert.deepEqual(transactions.payload.transactions.map(item => item.id), ['transaction-a']);
});

test('ignora tentativa de escolher outro tenant no corpo da requisicao', async () => {
  const created = await request('/api/products', {
    token: tokenA,
    method: 'POST',
    body: {
      establishmentId: 'est-b',
      name: 'Produto criado pela Loja A',
      barcode: 'A002',
      costPrice: 1,
      sellPrice: 3,
      stock: 4,
    },
  });
  assert.equal(created.status, 201);
  const stored = db.prepare('SELECT establishmentId FROM products WHERE id = ?').get(created.payload.id);
  assert.equal(stored.establishmentId, 'est-a');

  const settings = await request('/api/settings', {
    token: tokenA,
    method: 'PUT',
    body: {
      establishmentId: 'est-b',
      name: 'Loja A Atualizada',
      ownerName: 'Gestor A',
      email: 'a@example.com',
      phone: '',
      lowStockThreshold: 7,
      receiptAutoCloseSeconds: 5,
      receiptFooter: '',
    },
  });
  assert.equal(settings.status, 200);
  assert.equal(db.prepare('SELECT name FROM establishments WHERE id = ?').get('est-a').name, 'Loja A Atualizada');
  assert.equal(db.prepare('SELECT name FROM establishments WHERE id = ?').get('est-b').name, 'Loja B');
});

test('bloqueia alteracao de produto e usuario pertencentes a outro tenant', async () => {
  const productUpdate = await request('/api/products/product-b', {
    token: tokenA,
    method: 'PUT',
    body: { name: 'Produto invadido' },
  });
  const userUpdate = await request('/api/users/operador-b/status', {
    token: tokenA,
    method: 'PATCH',
    body: { active: false },
  });

  assert.equal(productUpdate.status, 404);
  assert.equal(userUpdate.status, 403);
  assert.equal(db.prepare('SELECT name FROM products WHERE id = ?').get('product-b').name, 'Produto B');
  assert.equal(db.prepare('SELECT active FROM users WHERE id = ?').get('operador-b').active, 1);
});

test('rejeita venda com produto de outro estabelecimento', async () => {
  const beforeCount = db.prepare('SELECT COUNT(*) c FROM sales').get().c;
  const response = await request('/api/sales', {
    token: tokenA,
    method: 'POST',
    body: {
      items: [{ productId: 'product-b', name: 'Produto B', quantity: 1, unitPrice: 2, totalPrice: 2 }],
      totalAmount: 2,
      paymentMethod: 'money',
    },
  });

  assert.equal(response.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sales').get().c, beforeCount);
});

test('impede login duplicado dentro do mesmo estabelecimento', async () => {
  const response = await request('/api/register', {
    token: tokenA,
    method: 'POST',
    body: { username: 'caixa', password: 'outra-senha-123', name: 'Outro Caixa' },
  });
  assert.equal(response.status, 409);
});

test('restringe rotas administrativas e permite acesso controlado ao SuperAdmin', async () => {
  const denied = await request('/api/admin/establishments', { token: tokenA });
  const allowed = await request('/api/admin/establishments', { token: superToken });

  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
  assert.deepEqual(allowed.payload.map(item => item.id).sort(), ['est-a', 'est-b']);

  const productsB = await request('/api/products', { token: tokenB });
  assert.ok(productsB.payload.every(item => item.establishmentId === 'est-b'));
});

test('automatiza atraso, suspensao, notificacoes e reativacao por pagamento', async () => {
  const afterGrace = new Date();
  const overdueDate = new Date(afterGrace);
  overdueDate.setUTCDate(overdueDate.getUTCDate() - 9);
  const reconciliationDate = new Date(afterGrace);
  reconciliationDate.setUTCDate(reconciliationDate.getUTCDate() - 5);
  db.prepare(`UPDATE establishments SET subscriptionDueDate = ?, subscriptionGraceDays = 7,
    subscriptionStatus = 'active', subscriptionStatusReason = NULL WHERE id = 'est-a'`)
    .run(overdueDate.toISOString());

  const overdueSummary = reconcileSubscriptions({ now: reconciliationDate });
  assert.equal(overdueSummary.overdue, 1);
  assert.equal(db.prepare("SELECT subscriptionStatus FROM establishments WHERE id = 'est-a'").get().subscriptionStatus, 'overdue');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE establishmentId = 'est-a' AND type = 'subscription_overdue'").get().c, 1);

  reconcileSubscriptions({ now: reconciliationDate });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE establishmentId = 'est-a' AND type = 'subscription_overdue'").get().c, 1);

  reconcileSubscriptions({ now: afterGrace });
  assert.equal(db.prepare("SELECT subscriptionStatus FROM establishments WHERE id = 'est-a'").get().subscriptionStatus, 'suspended');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE establishmentId = 'est-a' AND type = 'subscription_suspended'").get().c, 1);

  const blockedOperation = await request('/api/products', {
    token: tokenA,
    method: 'POST',
    body: { name: 'Produto bloqueado', sellPrice: 2, stock: 1 },
  });
  assert.equal(blockedOperation.status, 402);

  const operatorLogin = await request('/api/login', {
    method: 'POST',
    body: { establishment: 'loja-a', username: 'caixa', password: 'caixa-a-123' },
  });
  const managerLogin = await login('loja-a', 'senha-a-123');
  assert.equal(operatorLogin.status, 403);
  assert.equal(managerLogin.status, 200);

  const payment = await request('/api/admin/establishments/est-a/payments', {
    token: superToken,
    method: 'POST',
    body: { amount: 99.9, notes: 'Regularizacao de teste' },
  });
  assert.equal(payment.status, 201);
  assert.equal(payment.payload.subscriptionStatus, 'active');
  assert.equal(db.prepare("SELECT subscriptionStatus FROM establishments WHERE id = 'est-a'").get().subscriptionStatus, 'active');
  assert.equal(db.prepare("SELECT COUNT(*) c FROM notifications WHERE establishmentId = 'est-a' AND type = 'subscription_payment_registered'").get().c, 1);
});
