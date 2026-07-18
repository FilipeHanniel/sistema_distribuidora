const assert = require('node:assert/strict');
const test = require('node:test');
const {
  normalizeEstablishmentCode,
  normalizeUsername,
  validatePassword,
  validateUsername,
} = require('./tenantIdentity');

test('normaliza codigo de estabelecimento para login', () => {
  assert.equal(normalizeEstablishmentCode('  Mercado São João  '), 'mercado-sao-joao');
});

test('normaliza e valida login do usuario', () => {
  assert.equal(normalizeUsername(' Caixa.01 '), 'caixa.01');
  assert.equal(validateUsername('Caixa_01').valid, true);
  assert.equal(validateUsername('caixa com espaco').valid, false);
});

test('exige senha temporaria com ao menos oito caracteres', () => {
  assert.equal(validatePassword('1234567').valid, false);
  assert.equal(validatePassword('12345678').valid, false);
  assert.equal(validatePassword('senhaforte').valid, false);
  assert.equal(validatePassword('senha1234').valid, true);
});
