const assert = require('node:assert/strict');
const test = require('node:test');
const { buildOnboardingStatus } = require('./onboardingPolicy');

const completeEstablishment = {
  name: 'Loja Teste',
  loginCode: 'loja-teste',
  ownerName: 'Gestor Teste',
  email: 'gestor@example.com',
  plan: 'basic',
  subscriptionDueDate: '2026-07-28T00:00:00.000Z',
};

test('libera primeiro acesso quando requisitos obrigatorios estao completos', () => {
  const result = buildOnboardingStatus({
    establishment: completeEstablishment,
    activeManagers: 1,
    managerUsername: 'gestor',
    settingsConfigured: true,
  });

  assert.equal(result.ready, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.managerUsername, 'gestor');
});

test('aponta contato ausente como pendencia obrigatoria', () => {
  const result = buildOnboardingStatus({
    establishment: { ...completeEstablishment, email: '', phone: '' },
    activeManagers: 1,
    settingsConfigured: true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.nextStep.key, 'contact');
});

test('considera conta operacional depois do primeiro produto', () => {
  const result = buildOnboardingStatus({
    establishment: completeEstablishment,
    activeManagers: 1,
    settingsConfigured: true,
    productCount: 1,
  });

  assert.equal(result.operational, true);
  assert.equal(result.status, 'operational');
});
