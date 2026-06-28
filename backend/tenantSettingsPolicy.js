const DEFAULT_TENANT_SETTINGS = {
  lowStockThreshold: 5,
  receiptAutoCloseSeconds: 5,
  receiptFooter: '',
};

const normalizeInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const validateTenantSettings = (input = {}) => {
  const value = {
    name: String(input.name || '').trim(),
    ownerName: String(input.ownerName || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    phone: String(input.phone || '').trim(),
    lowStockThreshold: normalizeInteger(input.lowStockThreshold, DEFAULT_TENANT_SETTINGS.lowStockThreshold),
    receiptAutoCloseSeconds: normalizeInteger(input.receiptAutoCloseSeconds, DEFAULT_TENANT_SETTINGS.receiptAutoCloseSeconds),
    receiptFooter: String(input.receiptFooter || '').trim(),
  };
  const errors = [];

  if (value.name.length < 2 || value.name.length > 100) {
    errors.push('O nome comercial deve possuir entre 2 e 100 caracteres.');
  }
  if (value.ownerName.length > 100) errors.push('O nome do responsavel deve possuir no maximo 100 caracteres.');
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.push('Informe um e-mail valido.');
  if (value.phone.length > 30) errors.push('O telefone deve possuir no maximo 30 caracteres.');
  if (value.lowStockThreshold < 0 || value.lowStockThreshold > 9999) {
    errors.push('O limite de estoque baixo deve estar entre 0 e 9999.');
  }
  if (value.receiptAutoCloseSeconds !== 0 && (value.receiptAutoCloseSeconds < 3 || value.receiptAutoCloseSeconds > 30)) {
    errors.push('O fechamento do recibo deve ser manual ou ocorrer entre 3 e 30 segundos.');
  }
  if (value.receiptFooter.length > 180) errors.push('O rodape do recibo deve possuir no maximo 180 caracteres.');

  return { valid: errors.length === 0, errors, value };
};

module.exports = {
  DEFAULT_TENANT_SETTINGS,
  validateTenantSettings,
};
