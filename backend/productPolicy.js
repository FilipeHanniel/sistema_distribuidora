class ProductPolicyError extends Error {
  constructor(message, status = 400, code = 'invalid_product') {
    super(message);
    this.name = 'ProductPolicyError';
    this.status = status;
    this.code = code;
  }
}

const normalizeBarcode = value => {
  const barcode = String(value || '')
    .replace(/[\u0000-\u001f\u007f\s]+/g, '')
    .trim();
  if (barcode.length > 64) {
    throw new ProductPolicyError('O codigo de barras deve possuir no maximo 64 caracteres.');
  }
  return barcode;
};

const normalizeQuickProduct = payload => {
  const barcode = normalizeBarcode(payload?.barcode);
  const name = String(payload?.name || '').trim();
  const category = String(payload?.category || '').trim() || 'Geral';
  const costPrice = Number(payload?.costPrice || 0);
  const sellPrice = Number(payload?.sellPrice);
  const stock = Number(payload?.stock || 0);

  if (!barcode) throw new ProductPolicyError('Informe o codigo de barras lido.');
  if (!name) throw new ProductPolicyError('Informe o nome do produto.');
  if (name.length > 160) throw new ProductPolicyError('O nome do produto deve possuir no maximo 160 caracteres.');
  if (!Number.isFinite(costPrice) || costPrice < 0) throw new ProductPolicyError('O preco de custo deve ser valido.');
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) throw new ProductPolicyError('O preco de venda deve ser maior que zero.');
  if (!Number.isInteger(stock) || stock < 0) throw new ProductPolicyError('O estoque inicial deve ser um numero inteiro maior ou igual a zero.');

  return {
    barcode,
    name,
    category,
    costPrice,
    sellPrice,
    stock,
  };
};

module.exports = {
  ProductPolicyError,
  normalizeBarcode,
  normalizeQuickProduct,
};
