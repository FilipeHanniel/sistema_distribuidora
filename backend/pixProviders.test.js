const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStatus,
  normalizePointStatus,
  normalizePointPaymentSelection,
  buildPointSimulationEvent,
  buildMercadoPagoIdentification,
} = require('./pixProviders');

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
  assert.equal(normalizePointStatus('mercado_pago', 'action_required'), 'pending');
  assert.equal(normalizePointStatus('mercado_pago', 'refunded'), 'cancelled');
});

test('normaliza modalidade e parcelas do Point', () => {
  assert.deepEqual(normalizePointPaymentSelection('debit_card', 8), {
    paymentType: 'debit_card',
    installments: 1,
  });
  assert.deepEqual(normalizePointPaymentSelection('credit_card', 20), {
    paymentType: 'credit_card',
    installments: 12,
  });
});

test('monta eventos oficiais de simulacao Point', () => {
  assert.deepEqual(buildPointSimulationEvent({
    scenario: 'approved',
    paymentType: 'credit_card',
    installments: 3,
  }), {
    status: 'processed',
    payment_method_type: 'credit_card',
    installments: 3,
    payment_method_id: 'visa',
    status_detail: 'accredited',
  });
  assert.deepEqual(buildPointSimulationEvent({
    scenario: 'failed',
    paymentType: 'debit_card',
    installments: 4,
  }), {
    status: 'failed',
    payment_method_type: 'debit_card',
    payment_method_id: 'debvisa',
    status_detail: 'insufficient_amount',
  });
});

test('omite identificacao do pagador quando o numero nao foi informado', () => {
  assert.equal(buildMercadoPagoIdentification({ payerIdentificationType: 'CPF' }), undefined);
});

test('envia tipo e numero da identificacao sempre juntos', () => {
  assert.deepEqual(
    buildMercadoPagoIdentification({
      payerIdentificationType: 'CPF',
      payerIdentificationNumber: '123.456.789-00',
    }),
    { type: 'CPF', number: '12345678900' }
  );
});
