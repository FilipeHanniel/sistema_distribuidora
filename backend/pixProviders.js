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
      else parts.push([err.code, err.message, err.description].filter(Boolean).join(': '));
    }
  }
  if (Array.isArray(data.details)) {
    for (const detail of data.details) {
      if (typeof detail === 'string') parts.push(detail);
      else parts.push([detail.code, detail.message, detail.description].filter(Boolean).join(': '));
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

async function createMercadoPagoPixCharge({ amount, referenceId, credentials, description }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');
  const isTest = credentials.mpEnvironment !== 'production';
  const configuredEmail = getCredential(credentials, 'payerEmail');
  const payerEmail = isTest
    ? (configuredEmail.includes('@testuser.com') ? configuredEmail : 'test@testuser.com')
    : (configuredEmail || 'cliente@example.com');

  const response = await fetch('https://api.mercadopago.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': referenceId,
    },
    body: JSON.stringify({
      type: 'online',
      external_reference: referenceId,
      processing_mode: 'automatic',
      total_amount: Number(amount).toFixed(2),
      description: description || `Venda ${referenceId}`,
      payer: {
        email: payerEmail,
        first_name: isTest ? 'APRO' : (getCredential(credentials, 'payerFirstName') || 'Cliente'),
      },
      transactions: {
        payments: [
          {
            amount: Number(amount).toFixed(2),
            payment_method: {
              id: 'pix',
              type: 'bank_transfer',
            },
          },
        ],
      },
    }),
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
