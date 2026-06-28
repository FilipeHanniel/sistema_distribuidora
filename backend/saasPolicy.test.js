const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkPlanLimit,
  getPlanDefinition,
  getSubscriptionAccess,
  normalizePlan,
  normalizeSubscriptionStatus,
} = require('./saasPolicy');

test('normaliza plano desconhecido para basic', () => {
  assert.equal(normalizePlan('qualquer'), 'basic');
  assert.equal(getPlanDefinition('qualquer').key, 'basic');
});

test('limite enterprise aceita recursos ilimitados', () => {
  const result = checkPlanLimit('enterprise', 'maxProducts', 100000, 1);
  assert.equal(result.allowed, true);
  assert.equal(result.limit, null);
});

test('limite basic bloqueia acima do maximo configurado', () => {
  const allowed = checkPlanLimit('basic', 'maxPaymentAccounts', 2, 1);
  const denied = checkPlanLimit('basic', 'maxPaymentAccounts', 3, 1);

  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, 3);
});

test('limites de equipe incluem o gestor do estabelecimento', () => {
  assert.equal(getPlanDefinition('basic').limits.maxUsers, 4);
  assert.equal(getPlanDefinition('basic').limits.maxOperators, 3);
  assert.equal(checkPlanLimit('basic', 'maxUsers', 3, 1).allowed, true);
  assert.equal(checkPlanLimit('basic', 'maxUsers', 4, 1).allowed, false);

  assert.equal(getPlanDefinition('premium').limits.maxUsers, 7);
  assert.equal(getPlanDefinition('premium').limits.maxOperators, 6);
});

test('assinatura suspensa bloqueia operacao', () => {
  assert.equal(normalizeSubscriptionStatus('desconhecido'), 'active');
  assert.equal(getSubscriptionAccess('active').canOperate, true);
  assert.equal(getSubscriptionAccess('overdue').canOperate, true);
  assert.equal(getSubscriptionAccess('suspended').canOperate, false);
});
