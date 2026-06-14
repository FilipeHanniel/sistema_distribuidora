const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeExternalId,
  validatePosInput,
  validateStoreInput,
} = require('./mercadoPagoPointService');

test('normaliza identificadores externos dentro dos limites do Mercado Pago', () => {
  assert.equal(normalizeExternalId('Loja principal Goiás', '', 60), 'LojaprincipalGoias');
  assert.equal(normalizeExternalId('POS-001', '', 40), 'POS-001');
  assert.equal(normalizeExternalId('A'.repeat(80), '', 40).length, 40);
});

test('valida e normaliza dados obrigatorios da loja Point', () => {
  assert.deepEqual(validateStoreInput({
    name: 'Loja principal',
    externalId: 'LOJA001',
    streetName: 'Rua 1',
    streetNumber: '10',
    cityName: 'Goiania',
    stateName: 'Goiás',
    latitude: '-16.6869',
    longitude: '-49.2648',
    reference: 'Centro',
  }), {
    name: 'Loja principal',
    externalId: 'LOJA001',
    location: {
      street_number: '10',
      street_name: 'Rua 1',
      city_name: 'Goiania',
      state_name: 'Goiás',
      latitude: -16.6869,
      longitude: -49.2648,
      reference: 'Centro',
    },
  });
});

test('rejeita estado e coordenadas invalidos', () => {
  assert.throws(() => validateStoreInput({
    name: 'Loja',
    streetName: 'Rua',
    streetNumber: '1',
    cityName: 'Goiania',
    stateName: 'GO',
    latitude: '-16',
    longitude: '-49',
  }), /estado valido/);
  assert.throws(() => validateStoreInput({
    name: 'Loja',
    streetName: 'Rua',
    streetNumber: '1',
    cityName: 'Goiania',
    stateName: 'Goiás',
    latitude: '999',
    longitude: '-49',
  }), /Latitude invalida/);
});

test('valida dados do caixa Point', () => {
  assert.deepEqual(validatePosInput({
    name: 'Caixa principal',
    externalId: 'POS001',
    category: '5411',
  }), {
    name: 'Caixa principal',
    externalId: 'POS001',
    category: 5411,
  });
});

test('rejeita categoria que nao representa um MCC de quatro digitos', () => {
  assert.throws(() => validatePosInput({
    name: 'Caixa principal',
    externalId: 'POS001',
    category: '621102',
  }), /4 digitos/);
});
