const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateSubscription, normalizeGraceDays } = require('./subscriptionPolicy');

const now = new Date('2026-06-28T15:00:00.000Z');

test('mantem assinatura ativa ate o dia do vencimento', () => {
  const future = evaluateSubscription({ dueDate: '2026-07-01T00:00:00.000Z', now, graceDays: 7 });
  const today = evaluateSubscription({ dueDate: '2026-06-28T00:00:00.000Z', now, graceDays: 7 });
  assert.equal(future.status, 'active');
  assert.equal(future.daysUntilDue, 3);
  assert.equal(today.status, 'active');
  assert.equal(today.daysUntilDue, 0);
});

test('marca atraso durante o periodo de tolerancia', () => {
  const result = evaluateSubscription({ dueDate: '2026-06-24T00:00:00.000Z', now, graceDays: 7 });
  assert.equal(result.status, 'overdue');
  assert.equal(result.daysPastDue, 4);
  assert.equal(result.reason, 'past_due');
  assert.equal(result.suspensionDate, '2026-07-02T00:00:00.000Z');
});

test('suspende automaticamente depois da tolerancia', () => {
  const result = evaluateSubscription({ dueDate: '2026-06-20T00:00:00.000Z', now, graceDays: 7 });
  assert.equal(result.status, 'suspended');
  assert.equal(result.reason, 'past_due');
});

test('preserva suspensao manual independentemente do vencimento', () => {
  const result = evaluateSubscription({
    dueDate: '2026-07-20T00:00:00.000Z',
    currentStatus: 'suspended',
    statusReason: 'manual',
    now,
  });
  assert.equal(result.status, 'suspended');
  assert.equal(result.manualSuspension, true);
});

test('normaliza tolerancia para intervalo seguro', () => {
  assert.equal(normalizeGraceDays(-1), 0);
  assert.equal(normalizeGraceDays(120), 90);
  assert.equal(normalizeGraceDays('invalido'), 7);
});
