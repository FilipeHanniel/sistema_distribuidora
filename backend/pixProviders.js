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
  const configuredEmail = getCredential(credentials, 'payerEmail');
  const payerEmail = configuredEmail || 'cliente@example.com';

  const response = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': referenceId,
    },
    body: JSON.stringify({
      transaction_amount: Number(amount),
      description: description || `Venda ${referenceId}`,
      payment_method_id: 'pix',
      payer: { email: payerEmail },
      external_reference: referenceId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao criar Pix no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  const tx = data.point_of_interaction?.transaction_data || {};
  return {
    providerTransactionId: String(data.id),
    providerPaymentId: String(data.id),
    status: normalizeStatus('mercado_pago', data.status),
    qrCode: tx.qr_code || '',
    qrCodeBase64: tx.qr_code_base64 || '',
    ticketUrl: tx.ticket_url || '',
    payload: data,
    expiresAt: data.date_of_expiration || null,
  };
}

async function getMercadoPagoPixStatus({ transaction, credentials }) {
  const accessToken = getCredential(credentials, 'accessToken');
  if (!accessToken) throw new Error('Access token do Mercado Pago nao configurado.');

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${transaction.providerTransactionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(stringifyProviderError(data, 'Erro ao consultar Pix no Mercado Pago.'));
    error.providerPayload = data;
    error.providerStatus = response.status;
    throw error;
  }

  return {
    status: normalizeStatus('mercado_pago', data.status),
    paidAt: data.date_approved || null,
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

function getPixProvider(provider) {
  if (provider === 'fake') {
    return { createCharge: createFakePixCharge, getStatus: getFakePixStatus };
  }
  if (provider === 'mercado_pago') {
    return { createCharge: createMercadoPagoPixCharge, getStatus: getMercadoPagoPixStatus };
  }
  if (provider === 'mercado_pago_fake') {
    return { createCharge: createFakePixCharge, getStatus: getFakePixStatus };
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
