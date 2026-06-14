const MERCADO_PAGO_API = 'https://api.mercadopago.com';
const DEFAULT_POINT_MCC = '5411';

const BRAZILIAN_STATES = [
  'Acre',
  'Alagoas',
  'Amapá',
  'Amazonas',
  'Bahia',
  'Ceará',
  'Distrito Federal',
  'Espírito Santo',
  'Goiás',
  'Maranhão',
  'Mato Grosso',
  'Mato Grosso do Sul',
  'Minas Gerais',
  'Pará',
  'Paraíba',
  'Paraná',
  'Pernambuco',
  'Piauí',
  'Rio Grande do Norte',
  'Rio Grande do Sul',
  'Rio de Janeiro',
  'Rondônia',
  'Roraima',
  'Santa Catarina',
  'Sergipe',
  'São Paulo',
  'Tocantins',
];

const stringifyProviderError = (data, fallback) => {
  if (data?.code === 'pos_unknown_mcc' || data?.error === 'pos_unknown_mcc') {
    return 'O Mercado Pago nao reconheceu a categoria comercial selecionada. Escolha outra categoria MCC para o caixa.';
  }
  if (!data) return fallback;
  const parts = [data.message, data.error, data.code].filter(Boolean);
  for (const item of [...(data.errors || []), ...(data.cause || [])]) {
    if (typeof item === 'string') parts.push(item);
    else parts.push([item.code, item.message, item.description].filter(Boolean).join(': '));
  }
  return parts.filter(Boolean).join(' | ') || fallback;
};

const normalizeExternalId = (value, fallback, maxLength) => {
  const normalized = String(value || fallback || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, maxLength);
  if (!normalized) throw new Error('Identificador externo invalido.');
  return normalized;
};

const normalizeCoordinate = (value, label, min, max) => {
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw new Error(`${label} invalida.`);
  }
  return coordinate;
};

const validateStoreInput = (store = {}) => {
  const required = [
    ['storeName', store.name],
    ['streetName', store.streetName],
    ['streetNumber', store.streetNumber],
    ['cityName', store.cityName],
    ['stateName', store.stateName],
  ];
  const missing = required.filter(([, value]) => !String(value || '').trim()).map(([field]) => field);
  if (missing.length) throw new Error(`Preencha os dados obrigatorios da loja: ${missing.join(', ')}.`);
  if (!BRAZILIAN_STATES.includes(store.stateName)) {
    throw new Error('Selecione um estado valido para a loja.');
  }
  return {
    name: String(store.name).trim(),
    externalId: normalizeExternalId(store.externalId, 'LOJA', 60),
    location: {
      street_number: String(store.streetNumber).trim(),
      street_name: String(store.streetName).trim(),
      city_name: String(store.cityName).trim(),
      state_name: store.stateName,
      latitude: normalizeCoordinate(store.latitude, 'Latitude', -90, 90),
      longitude: normalizeCoordinate(store.longitude, 'Longitude', -180, 180),
      reference: String(store.reference || '').trim(),
    },
  };
};

const validatePosInput = (pos = {}) => {
  if (!String(pos.name || '').trim()) throw new Error('Informe o nome do caixa.');
  const categoryText = String(pos.category || DEFAULT_POINT_MCC).trim();
  if (!/^\d+$/.test(categoryText) || Number(categoryText) <= 0) throw new Error('Informe uma categoria MCC numerica valida.');
  return {
    name: String(pos.name).trim(),
    externalId: normalizeExternalId(pos.externalId, 'POS', 40),
    category: Number(categoryText),
  };
};

async function requestMercadoPago(path, accessToken, options = {}) {
  if (!String(accessToken || '').trim()) throw new Error('Access Token do Mercado Pago nao configurado.');
  const response = await fetch(`${MERCADO_PAGO_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro na comunicacao com o Mercado Pago.'));
    error.providerStatus = response.status;
    error.providerPayload = data;
    throw error;
  }
  return data;
}

async function getMercadoPagoUser(accessToken) {
  const data = await requestMercadoPago('/users/me', accessToken);
  if (!data.id) throw new Error('O Mercado Pago nao retornou o User ID da conta.');
  return {
    id: String(data.id),
    nickname: data.nickname || '',
    email: data.email || '',
  };
}

async function createPointStore({ accessToken, userId, store }) {
  const normalized = validateStoreInput(store);
  const data = await requestMercadoPago(`/users/${encodeURIComponent(userId)}/stores`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: normalized.name,
      external_id: normalized.externalId,
      location: normalized.location,
    }),
  });
  return {
    id: String(data.id),
    externalId: data.external_id || normalized.externalId,
    payload: data,
  };
}

async function createPointPos({ accessToken, storeId, storeExternalId, pos }) {
  const normalized = validatePosInput(pos);
  const data = await requestMercadoPago('/pos', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: normalized.name,
      store_id: String(storeId),
      external_store_id: storeExternalId || undefined,
      external_id: normalized.externalId,
      category: normalized.category,
    }),
  });
  return {
    id: String(data.id),
    externalId: data.external_id || normalized.externalId,
    payload: data,
  };
}

async function listPointTerminals({ accessToken, storeId, posId }) {
  const params = new URLSearchParams({ limit: '50', offset: '0' });
  if (storeId) params.set('store_id', String(storeId));
  if (posId) params.set('pos_id', String(posId));
  const data = await requestMercadoPago(`/terminals/v1/list?${params.toString()}`, accessToken);
  return (data.data?.terminals || []).map(terminal => ({
    id: String(terminal.id),
    posId: terminal.pos_id ? String(terminal.pos_id) : '',
    storeId: terminal.store_id ? String(terminal.store_id) : '',
    externalPosId: terminal.external_pos_id || '',
    operatingMode: terminal.operating_mode || 'UNDEFINED',
  }));
}

async function activatePointTerminal({ accessToken, terminalId }) {
  const id = String(terminalId || '').trim();
  if (!id) throw new Error('Terminal Point invalido.');
  const data = await requestMercadoPago('/terminals/v1/setup', accessToken, {
    method: 'PATCH',
    body: JSON.stringify({
      terminals: [{ id, operating_mode: 'PDV' }],
    }),
  });
  return data;
}

module.exports = {
  BRAZILIAN_STATES,
  DEFAULT_POINT_MCC,
  activatePointTerminal,
  createPointPos,
  createPointStore,
  getMercadoPagoUser,
  listPointTerminals,
  normalizeExternalId,
  validatePosInput,
  validateStoreInput,
};
