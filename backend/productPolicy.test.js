const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeBarcode, normalizeQuickProduct } = require('./productPolicy');

test('normaliza caracteres enviados pelo leitor de codigo de barras', () => {
  assert.equal(normalizeBarcode(' 789 123\r\n'), '789123');
});

test('valida cadastro rapido com estoque inteiro e preco de venda positivo', () => {
  const product = normalizeQuickProduct({
    barcode: '7891234567890',
    name: 'Produto teste',
    costPrice: '2.50',
    sellPrice: '4.90',
    stock: '3',
  });
  assert.equal(product.stock, 3);
  assert.equal(product.sellPrice, 4.9);
  assert.equal(product.category, 'Geral');
  assert.throws(() => normalizeQuickProduct({ barcode: '1', name: 'Invalido', sellPrice: 0, stock: 1 }));
  assert.throws(() => normalizeQuickProduct({ barcode: '1', name: 'Invalido', sellPrice: 2, stock: 1.5 }));
});
