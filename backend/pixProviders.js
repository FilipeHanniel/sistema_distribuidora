const crypto = require('crypto');

const PROVIDERS = {
  fake: {
    label: 'Fake Provider',
    implemented: true,
    requires: [],
  },
  mercado_pago: {
    label: 'Mercado Pago',
    implemented: true,
    requires: ['accessToken'],
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

const getCredential = (credentials, key) => credentials?.[key] || '';

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
      payer: { email: credentials.payerEmail || 'cliente@example.com' },
      external_reference: referenceId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || 'Erro ao criar Pix no Mercado Pago.');
  }

  const tx = data.point_of_interaction?.transaction_data || {};
  return {
    providerTransactionId: String(data.id),
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
    throw new Error(data?.message || data?.error || 'Erro ao consultar Pix no Mercado Pago.');
  }

  return {
    status: normalizeStatus('mercado_pago', data.status),
    paidAt: data.date_approved || null,
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
  throw new Error('Provider Pix ainda nao implementado.');
}

function makeProviderReference() {
  return crypto.randomUUID();
}

module.exports = {
  PROVIDERS,
  getPixProvider,
  makeProviderReference,
  normalizeStatus,
};
