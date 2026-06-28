const assert = require('node:assert/strict');
const test = require('node:test');
const { validateTenantSettings } = require('./tenantSettingsPolicy');

test('normaliza configuracoes validas do estabelecimento', () => {
  const result = validateTenantSettings({
    name: ' Loja Centro ',
    email: 'CONTATO@EXEMPLO.COM',
    lowStockThreshold: '8',
    receiptAutoCloseSeconds: '10',
  });
  assert.equal(result.valid, true);
  assert.equal(result.value.name, 'Loja Centro');
  assert.equal(result.value.email, 'contato@exemplo.com');
  assert.equal(result.value.lowStockThreshold, 8);
  assert.equal(result.value.receiptAutoCloseSeconds, 10);
});

test('aceita fechamento manual do recibo', () => {
  const result = validateTenantSettings({ name: 'Loja', receiptAutoCloseSeconds: 0 });
  assert.equal(result.valid, true);
});

test('rejeita preferencias fora dos limites operacionais', () => {
  const result = validateTenantSettings({
    name: '',
    email: 'email-invalido',
    lowStockThreshold: -1,
    receiptAutoCloseSeconds: 2,
    receiptFooter: 'x'.repeat(181),
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 5);
});
