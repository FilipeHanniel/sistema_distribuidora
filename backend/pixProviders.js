const crypto = require('crypto');

const PROVIDERS = {
  fake: {
    label: 'Fake Provider',
    implemented: true,
    requires: [],
    supportsPix: true,
    supportsPoint: true,
  },
  mercado_pago_fake: {
    label: 'Mercado Pago Fake',
    implemented: true,
    requires: [],
    supportsPix: true,
    supportsPoint: true,
  },
  mercado_pago: {
    label: 'Mercado Pago',
    implemented: true,
    requires: ['accessToken'],
    supportsPix: true,
    supportsPoint: true,
  },
  asaas: {
    label: 'Asaas',
    implemented: false,
    requires: ['apiKey'],
  },
  sicoob: { label: 'Sicoob', implemented: false, requires: ['clientId', 'clientSecret', 'certificate'] },
  itau: { label: 'Itau', implemented: false, requires: ['clientId', 'clientSecret', 'certificate'] },
  santander: { label: 'Santander', implemented: false, requires: ['clientId', 'clientSecret', 'certificate'] },
  bradesco: { label: 'Bradesco', implemented: false, requires: ['clientId', 'clientSecret', 'certificate'] },
};

const normalizeStatus = (provider, status) => {
  const raw = String(status || '').toLowerCase();
  if (provider === 'mercado_pago') {
    if (raw === 'approved' || raw === 'accredited') return 'paid';
    if (raw === 'cancelled' || raw === 'rejected') return 'cancelled';
    if (raw === 'expired') return 'expired';
    return 'pending';
  }
  if (['paid', 'approved', 'confirmed'].includes(raw)) return 'paid';
  if (['cancelled', 'canceled', 'rejected'].includes(raw)) return 'cancelled';
  if (raw === 'expired') return 'expired';
  return 'pending';
};

const getCredential = (credentials, key) => String(credentials?.[key] || '').trim();

const stringifyProviderError = (data, fallback) => {
  if (!data) return fallback;
  const parts = [
    data.message,
    data.error,
    data.cause,
    data.code,
  ].filter(Boolean);
  if (Array.isArray(data.errors)) {
    for (const err of data.errors) {
      if (typeof err === 'string') parts.push(err);
      else parts.push([err.code, err.message, err.description, err.details ? JSON.stringify(err.details) : null].filter(Boolean).join(': '));
    }
  }
  if (Array.isArray(data.details)) {
    for (const detail of data.details) {
      if (typeof detail === 'string') parts.push(detail);
      else parts.push([detail.code, detail.message, detail.description, detail.details ? JSON.stringify(detail.details) : null].filter(Boolean).join(': '));
    }
  }
  return parts.filter(Boolean).join(' | ') || fallback;
};

const normalizePointStatus = (provider, status, payments = []) => {
  const raw = String(status || '').toLowerCase();
  const paymentStatus = String(payments?.[0]?.status || '').toLowerCase();
  if (['processed', 'paid', 'approved', 'accredited'].includes(raw) || ['processed', 'paid', 'approved', 'accredited'].includes(paymentStatus)) return 'paid';
  if (['canceled', 'cancelled', 'failed', 'rejected'].includes(raw) || ['canceled', 'cancelled', 'failed', 'rejected'].includes(paymentStatus)) return 'cancelled';
  if (raw === 'expired' || paymentStatus === 'expired') return 'expired';
  return 'pending';
};

const readJsonPayload = (value) => {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
};

const getProviderPaymentId = (payload) => payload?.transactions?.payments?.[0]?.id || payload?.id || null;

const compactObject = (value) => {
  if (Array.isArray(value)) {
    const items = value.map(compactObject).filter(item => item !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, compactObject(item)])
      .filter(([, item]) => item !== undefined && item !== null && item !== '');
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }
  return value;
};

const onlyDigits = (value) => String(value || '').replace(/\D/g, '');

const sanitizeText = (value, fallback, maxLength = 120) => {
  const text = String(value || fallback || '').trim();
  return text.slice(0, maxLength);
};

const formatAmount = (value) => Number(value || 0).toFixed(2);

const buildMercadoPagoItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  return items.map((item, index) => {
    const quantity = Math.max(1, Number.parseInt(String(item.quantity || 1), 10));
    const unitPrice = Number(item.unitPrice || item.sellPrice || item.totalPrice / quantity || 0);
    return compactObject({
      external_code: sanitizeText(item.productId || item.id || String(index + 1), String(index + 1), 30),
      title: sanitizeText(item.name, `Produto ${index + 1}`, 120),
      description: sanitizeText(item.name, `Produto ${index + 1}`, 255),
      category_id: sanitizeText(item.category || 'retail', 'retail', 40),
      quantity,
      unit_price: formatAmount(unitPrice),
    });
  });
};

const buildMercadoPagoAddress = (credentials) => compactObject({
  zip_code: onlyDigits(credentials.payerZipCode),
  street_name: getCredential(credentials, 'payerStreetName'),
  street_number: getCredential(credentials, 'payerStreetNumber'),
  city: getCredential(credentials, 'payerCity'),
  state: getCredential(credentials, 'payerState'),
  neighborhood: getCredential(credentials, 'payerNeighborhood'),
  complement: getCredential(credentials, 'payerComplement'),
});

async function fetchMercadoPagoJson(url, accessToken, fallbackMessage) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, fallbackMessage));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }
  return data;
}

async function createFakePixCharge({ amount, referenceId }) {
  const payload = `00020126580014br.gov.bcb.pix0136fake-${referenceId}520400005303986540${Number(amount).toFixed(2)}5802BR5925FAKE PROVIDER TESTE6009SAO PAULO62070503***6304FAKE`;
  return {
    providerTransactionId: referenceId,
    status: 'pending',
    qrCode: payload,
    qrCodeBase64: '',
    ticketUrl: '',
    payload: { fakeAutoApproveAfterSeconds: 5 },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

async function cancelFakePixCharge() {
  return {
    status: 'cancelled',
    payload: { cancelledAt: new Date().toISOString() },
  };
}

async function getFakePixStatus({ transaction }) {
  const ageMs = Date.now() - new Date(transaction.createdAt).getTime();
  return {
    status: ageMs >= 5000 ? 'paid' : 'pending',
    paidAt: ageMs >= 5000 ? new Date().toISOString() : null,
  };
}

async function createMercadoPagoPixCharge({ amount, referenceId, credentials, description, items = [], deviceId = '' }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');
  const isTest = credentials.mpEnvironment !== 'production';
  const configuredEmail = getCredential(credentials, 'payerEmail');
  const payerEmail = isTest
    ? (configuredEmail.includes('@testuser.com') ? configuredEmail : 'test@testuser.com')
    : (configuredEmail || 'cliente@example.com');
  const statementDescriptor = sanitizeText(credentials.statementDescriptor || credentials.storeName || 'DISTRIBUIDORA', 'DISTRIBUIDORA', 22);
  const payerAddress = buildMercadoPagoAddress(credentials);
  const payerIdentification = compactObject({
    type: getCredential(credentials, 'payerIdentificationType'),
    number: onlyDigits(credentials.payerIdentificationNumber),
  });
  const payerPhone = compactObject({
    area_code: onlyDigits(credentials.payerPhoneAreaCode),
    number: onlyDigits(credentials.payerPhoneNumber),
  });
  const orderItems = buildMercadoPagoItems(items);
  const additionalInfo = compactObject({
    'payer.registration_date': getCredential(credentials, 'payerRegistrationDate'),
    'payer.authentication_type': getCredential(credentials, 'payerAuthenticationType') || 'WEB',
    'payer.is_first_purchase_online': credentials.payerIsFirstPurchaseOnline === undefined ? undefined : Boolean(credentials.payerIsFirstPurchaseOnline),
    'shipment.local_pickup': credentials.shipmentLocalPickup === undefined ? true : Boolean(credentials.shipmentLocalPickup),
  });
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': referenceId,
  };
  const sessionId = String(deviceId || credentials.deviceId || '').trim();
  if (sessionId) headers['X-meli-session-id'] = sessionId;

  const response = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(compactObject({
      type: 'online',
      external_reference: referenceId,
      processing_mode: 'automatic',
      total_amount: formatAmount(amount),
      description: description || `Venda ${referenceId}`,
      payer: {
        email: payerEmail,
        first_name: isTest ? 'APRO' : (getCredential(credentials, 'payerFirstName') || 'Cliente'),
        last_name: getCredential(credentials, 'payerLastName') || 'PDV',
        identification: payerIdentification,
        phone: payerPhone,
        address: payerAddress,
      },
      items: orderItems,
      additional_info: additionalInfo,
      transactions: {
        payments: [
          {
            amount: formatAmount(amount),
            payment_method: {
              id: 'pix',
              type: 'bank_transfer',
              statement_descriptor: statementDescriptor,
            },
          },
        ],
      },
    })),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao criar Pix no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  const payment = data.transactions?.payments?.[0] || {};
  const method = payment.payment_method || {};
  return {
    providerTransactionId: String(data.id),
    providerPaymentId: payment.id ? String(payment.id) : null,
    externalReference: data.external_reference || referenceId,
    status: normalizePointStatus('mercado_pago', data.status, data.transactions?.payments || []),
    qrCode: method.qr_code || '',
    qrCodeBase64: method.qr_code_base64 || '',
    ticketUrl: method.ticket_url || '',
    payload: data,
    expiresAt: null,
  };
}

async function getMercadoPagoPixStatus({ transaction, credentials }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');

  const storedPayload = readJsonPayload(transaction.payload);
  const providerPayload = storedPayload.latestProviderPayload || storedPayload.providerPayload || {};
  const storedPaymentId = storedPayload.providerPaymentId || getProviderPaymentId(providerPayload);
  const externalReference = storedPayload.externalReference || providerPayload.external_reference || null;

  let data;
  try {
    data = await fetchMercadoPagoJson(
      `https://api.mercadopago.com/v1/orders/${transaction.providerTransactionId}`,
      accessToken,
      'Erro ao consultar Pix no Mercado Pago.'
    );
  } catch (orderError) {
    if (!storedPaymentId && !externalReference) throw orderError;
    if (storedPaymentId) {
      data = await fetchMercadoPagoJson(
        `https://api.mercadopago.com/v1/payments/${storedPaymentId}`,
        accessToken,
        'Erro ao consultar pagamento Pix no Mercado Pago.'
      );
    } else {
      const search = await fetchMercadoPagoJson(
        `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}`,
        accessToken,
        'Erro ao buscar pagamento Pix no Mercado Pago.'
      );
      data = search.results?.[0] || search;
    }
  }

  const payments = data.transactions?.payments || (data.id ? [data] : []);
  const providerPaymentId = getProviderPaymentId(data) || storedPaymentId;
  const status = data.transactions ? normalizePointStatus('mercado_pago', data.status, payments) : normalizeStatus('mercado_pago', data.status);
  const paidAt = status === 'paid' ? (data.date_approved || new Date().toISOString()) : null;

  return {
    status,
    paidAt,
    providerPaymentId,
    externalReference: data.external_reference || externalReference,
    payload: data,
  };
}

async function createFakePointOrder({ amount, referenceId }) {
  return {
    providerTransactionId: referenceId,
    providerPaymentId: `fake-pay-${referenceId}`,
    status: 'pending',
    payload: { terminalId: 'FAKE_POINT', fakeAutoApproveAfterSeconds: 5 },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

async function getFakePointStatus({ transaction }) {
  const ageMs = Date.now() - new Date(transaction.createdAt).getTime();
  return {
    status: ageMs >= 5000 ? 'paid' : 'pending',
    paidAt: ageMs >= 5000 ? new Date().toISOString() : null,
    payload: { fakeElapsedMs: ageMs },
  };
}

async function createMercadoPagoPointOrder({ amount, referenceId, credentials, description }) {
  const accessToken = getCredential(credentials, 'accessToken');
  const terminalId = getCredential(credentials, 'terminalId');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');
  if (!terminalId) throw new Error('Terminal ID do Mercado Pago Point nao configurado.');

  const response = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': referenceId,
    },
    body: JSON.stringify({
      type: 'point',
      external_reference: referenceId,
      expiration_time: credentials.expirationTime || 'PT15M',
      transactions: {
        payments: [{ amount: Number(amount).toFixed(2) }],
      },
      config: {
        point: {
          terminal_id: terminalId,
          print_on_terminal: credentials.printOnTerminal || 'no_ticket',
        },
        payment_method: {
          default_type: credentials.defaultType || 'credit_card',
          default_installments: Number(credentials.defaultInstallments || 1),
          installments_cost: credentials.installmentsCost || 'seller',
        },
      },
      description: description || `Venda PDV ${referenceId}`,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao criar order Point no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  const payments = data.transactions?.payments || [];
  return {
    providerTransactionId: String(data.id),
    providerPaymentId: payments[0]?.id ? String(payments[0].id) : null,
    status: normalizePointStatus('mercado_pago', data.status, payments),
    payload: data,
    expiresAt: null,
  };
}

async function getMercadoPagoPointStatus({ transaction, credentials }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');

  const response = await fetch(`https://api.mercadopago.com/v1/orders/${transaction.providerTransactionId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao consultar order Point no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  const payments = data.transactions?.payments || [];
  return {
    status: normalizePointStatus('mercado_pago', data.status, payments),
    paidAt: ['processed', 'paid'].includes(String(data.status || '').toLowerCase()) ? new Date().toISOString() : null,
    payload: data,
  };
}

async function cancelMercadoPagoPixCharge({ transaction, credentials }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');

  const storedPayload = readJsonPayload(transaction.payload);
  const providerPayload = storedPayload.latestProviderPayload || storedPayload.providerPayload || {};
  const paymentId = storedPayload.providerPaymentId || getProviderPaymentId(providerPayload);

  if (!transaction.providerTransactionId) {
    return {
      status: 'cancelled',
      payload: { localOnly: true, reason: 'Order Mercado Pago ainda sem id para cancelamento remoto.' },
    };
  }

  const response = await fetch(`https://api.mercadopago.com/v1/orders/${transaction.providerTransactionId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': `cancel-${transaction.id}`,
    },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao cancelar order Pix no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  const payments = data.transactions?.payments || [];
  return {
    status: normalizePointStatus('mercado_pago', data.status, payments),
    providerPaymentId: getProviderPaymentId(data) || paymentId,
    externalReference: data.external_reference || storedPayload.externalReference || providerPayload.external_reference || null,
    payload: data,
  };
}

function getPixProvider(provider) {
  if (provider === 'fake') {
    return { createCharge: createFakePixCharge, getStatus: getFakePixStatus, cancelCharge: cancelFakePixCharge };
  }
  if (provider === 'mercado_pago') {
    return { createCharge: createMercadoPagoPixCharge, getStatus: getMercadoPagoPixStatus, cancelCharge: cancelMercadoPagoPixCharge };
  }
  if (provider === 'mercado_pago_fake') {
    return { createCharge: createFakePixCharge, getStatus: getFakePixStatus, cancelCharge: cancelFakePixCharge };
  }
  throw new Error('Provider Pix ainda nao implementado.');
}

function getPointProvider(provider) {
  if (provider === 'fake') {
    return { createOrder: createFakePointOrder, getStatus: getFakePointStatus };
  }
  if (provider === 'mercado_pago') {
    return { createOrder: createMercadoPagoPointOrder, getStatus: getMercadoPagoPointStatus };
  }
  if (provider === 'mercado_pago_fake') {
    return { createOrder: createFakePointOrder, getStatus: getFakePointStatus };
  }
  throw new Error('Provider Point ainda nao implementado.');
}

function makeProviderReference() {
  return crypto.randomUUID();
}

module.exports = {
  PROVIDERS,
  getPixProvider,
  getPointProvider,
  makeProviderReference,
  normalizeStatus,
  normalizePointStatus,
};
