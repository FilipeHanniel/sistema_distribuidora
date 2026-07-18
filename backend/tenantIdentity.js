const normalizeEstablishmentCode = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

const normalizeUsername = (value) => String(value || '').trim().toLowerCase();

const validateUsername = (value) => {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 50) {
    return { valid: false, username, error: 'O login deve possuir entre 3 e 50 caracteres.' };
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return { valid: false, username, error: 'Use apenas letras, numeros, ponto, hifen ou sublinhado no login.' };
  }
  return { valid: true, username, error: null };
};

const validatePassword = (value) => {
  const password = String(value || '');
  if (password.length < 8) {
    return { valid: false, password, error: 'A senha deve possuir pelo menos 8 caracteres.' };
  }
  if (password.length > 128) {
    return { valid: false, password, error: 'A senha deve possuir no maximo 128 caracteres.' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { valid: false, password, error: 'A senha deve conter letras e numeros.' };
  }
  return { valid: true, password, error: null };
};

module.exports = {
  normalizeEstablishmentCode,
  normalizeUsername,
  validatePassword,
  validateUsername,
};
