const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStatus, normalizePointStatus } = require('./pixProviders');

test('normaliza pagamentos Mercado Pago aprovados como pagos', () => {
  assert.equal(normalizeStatus('mercado_pago', 'approved'), 'paid');
  assert.equal(normalizeStatus('mercado_pago', 'accredited'), 'paid');
  assert.equal(normalizePointStatus('mercado_pago', 'processed'), 'paid');
});

test('normaliza pagamentos Mercado Pago pendentes e cancelados', () => {
  assert.equal(normalizeStatus('mercado_pago', 'pending'), 'pending');
  assert.equal(normalizeStatus('mercado_pago', 'rejected'), 'cancelled');
  assert.equal(normalizePointStatus('mercado_pago', 'processing'), 'pending');
  assert.equal(normalizePointStatus('mercado_pago', 'failed'), 'cancelled');
});

test('considera o status do pagamento interno da Order', () => {
  assert.equal(normalizePointStatus('mercado_pago', 'processing', [{ status: 'processed' }]), 'paid');
  assert.equal(normalizePointStatus('mercado_pago', 'processing', [{ status: 'rejected' }]), 'cancelled');
});
