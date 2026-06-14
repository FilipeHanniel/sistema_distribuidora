const test = require('node:test');
const assert = require('node:assert/strict');
const { getPaymentTransactionIssue } = require('./paymentReconciliation');

const now = new Date('2026-06-14T12:00:00.000Z');

test('identifica pagamento confirmado sem venda vinculada', () => {
  assert.equal(getPaymentTransactionIssue({ status: 'paid', saleId: null }, now), 'paid_without_sale');
});

test('identifica falha registrada pelo provider', () => {
  assert.equal(getPaymentTransactionIssue({ status: 'pending', error: 'Provider indisponivel' }, now), 'provider_error');
});

test('identifica cobranca vencida ainda pendente', () => {
  assert.equal(
    getPaymentTransactionIssue({ status: 'pending', expiresAt: '2026-06-14T11:00:00.000Z' }, now),
    'expired_pending'
  );
});

test('nao sinaliza transacao paga e vinculada', () => {
  assert.equal(getPaymentTransactionIssue({ status: 'paid', saleId: 'sale-1' }, now), null);
});
