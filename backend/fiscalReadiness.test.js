const assert = require('node:assert/strict');
const test = require('node:test');
const { getFiscalReadiness, normalizeCrt } = require('./fiscalReadiness');

const completeSettings = {
  enabled: 1,
  providerMode: 'simulated',
  cnpj: '12.345.678/0001-90',
  stateRegistration: '10.987.654-3',
  legalName: 'Distribuidora Teste Ltda',
  tradeName: 'Distribuidora Teste',
  taxRegime: 'simples',
  crt: '1',
  streetName: 'Rua 001',
  streetNumber: '10',
  district: 'Centro',
  cityName: 'Goiania',
  cityCode: '5208707',
  state: 'GO',
  zipCode: '74000000',
  serie: '1',
  nextNumber: 1,
  cscId: '1',
  csc: 'secret',
  certificatePath: __filename,
  certificatePassword: 'secret',
  certificateValidTo: new Date(Date.now() + 86400000).toISOString(),
};

test('trata modulo fiscal desativado como controle interno', () => {
  const readiness = getFiscalReadiness({ enabled: 0 });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.mode, 'internal_control');
  assert.deepEqual(readiness.missing, []);
  assert.equal(readiness.requirements.length, 0);
});

test('valida cadastro fiscal completo para emissao simulada', () => {
  const readiness = getFiscalReadiness(completeSettings);

  assert.equal(readiness.ready, true);
  assert.equal(readiness.mode, 'simulated');
  assert.deepEqual(readiness.missing, []);
});

test('aponta pendencias fiscais por campo', () => {
  const readiness = getFiscalReadiness({
    ...completeSettings,
    cnpj: '123',
    cityCode: '',
    certificatePath: '',
    certificatePassword: '',
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes('CNPJ do emitente'));
  assert.ok(readiness.missing.includes('Codigo IBGE do municipio'));
  assert.ok(readiness.missing.includes('Certificado A1 e senha'));
});

test('normaliza CRT de acordo com regime tributario', () => {
  assert.equal(normalizeCrt('mei'), '4');
  assert.equal(normalizeCrt('simples'), '1');
  assert.equal(normalizeCrt('normal'), '3');
  assert.equal(normalizeCrt('simples', '2'), '2');
});
