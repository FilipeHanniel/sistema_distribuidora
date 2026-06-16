const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildNfceXml, onlyDigits } = require('./fiscalXmlBuilder');
const { SefazGoProvider } = require('./sefazGoProvider');

const makeAccessKey = (settings, document, sale) => {
  const cnpj = onlyDigits(settings.cnpj).padStart(14, '0').slice(0, 14);
  const model = String(document.model || '65').padStart(2, '0');
  const serie = String(document.serie || '1').padStart(3, '0').slice(-3);
  const number = String(document.number || 1).padStart(9, '0').slice(-9);
  const date = new Date(sale.createdAt || Date.now());
  const aamm = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const code = crypto.createHash('sha1').update(`${sale.id}:${document.id}`).digest('hex').replace(/\D/g, '').padEnd(8, '0').slice(0, 8);
  const base = `52${aamm}${cnpj}${model}${serie}${number}1${code}`;
  return `${base}${calculateCheckDigit(base)}`;
};

const calculateCheckDigit = (base) => {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const mod = sum % 11;
  const digit = 11 - mod;
  return digit >= 10 ? 0 : digit;
};

const validateSettings = (settings) => {
  const errors = [];
  if (!settings?.enabled) errors.push({ code: 'F001', cStat: 'SIM-001', message: 'Modulo fiscal desativado.' });
  if (onlyDigits(settings?.cnpj).length !== 14) errors.push({ code: 'F002', cStat: 'SIM-207', message: 'CNPJ do emitente invalido ou ausente.' });
  if (!settings?.stateRegistration) errors.push({ code: 'F003', cStat: 'SIM-209', message: 'Inscricao estadual ausente.' });
  if (!settings?.legalName) errors.push({ code: 'F004', cStat: 'SIM-203', message: 'Razao social ausente.' });
  if (!['1', '2', '3', '4'].includes(String(settings?.crt || '').trim())) {
    errors.push({ code: 'F005', cStat: 'SIM-481', message: 'CRT do emitente invalido ou ausente.' });
  }
  if (!settings?.streetName || !settings?.streetNumber || !settings?.district) {
    errors.push({ code: 'F006', cStat: 'SIM-203', message: 'Endereco fiscal do emitente incompleto.' });
  }
  if (!settings?.cityName || onlyDigits(settings?.cityCode).length !== 7 || !String(settings?.state || '').match(/^[A-Z]{2}$/)) {
    errors.push({ code: 'F007', cStat: 'SIM-203', message: 'Municipio, codigo IBGE ou UF do emitente invalidos.' });
  }
  if (onlyDigits(settings?.zipCode).length !== 8) {
    errors.push({ code: 'F008', cStat: 'SIM-203', message: 'CEP do emitente invalido ou ausente.' });
  }
  if (!settings?.cscId || !settings?.csc) errors.push({ code: 'F009', cStat: 'SIM-395', message: 'CSC e ID CSC sao obrigatorios para NFC-e.' });
  if (!settings?.certificatePath || !settings?.certificatePassword) {
    errors.push({ code: 'F010', cStat: 'SIM-280', message: 'Certificado A1 e senha sao obrigatorios para homologacao/producao.' });
  } else {
    const certificatePath = path.isAbsolute(settings.certificatePath)
      ? settings.certificatePath
      : path.resolve(__dirname, '..', settings.certificatePath);
    if (!fs.existsSync(certificatePath)) {
      errors.push({ code: 'F011', cStat: 'SIM-281', message: 'Arquivo do certificado A1 nao encontrado no servidor.' });
    }
    if (settings.certificateValidTo && new Date(settings.certificateValidTo) <= new Date()) {
      errors.push({ code: 'F012', cStat: 'SIM-282', message: 'Certificado A1 expirado.' });
    }
  }
  return errors;
};

const validateProducts = (items, settings = {}) => {
  const errors = [];
  for (const item of items) {
    const name = item.name || item.productName || item.productId;
    if (!onlyDigits(item.ncm).match(/^\d{8}$/)) errors.push({ code: 'P001', cStat: 'SIM-778', message: `Produto "${name}" sem NCM valido de 8 digitos.` });
    if (!onlyDigits(item.cfop).match(/^\d{4}$/)) errors.push({ code: 'P002', cStat: 'SIM-521', message: `Produto "${name}" sem CFOP valido de 4 digitos.` });
    if (!item.fiscalUnit) errors.push({ code: 'P003', cStat: 'SIM-629', message: `Produto "${name}" sem unidade fiscal.` });
    if (!String(item.origin || '').match(/^[0-8]$/)) errors.push({ code: 'P004', cStat: 'SIM-508', message: `Produto "${name}" sem origem fiscal valida.` });
    if (settings.taxRegime === 'normal' && !item.cst) errors.push({ code: 'P005', cStat: 'SIM-528', message: `Produto "${name}" sem CST para regime normal.` });
    if (settings.taxRegime !== 'normal' && !item.csosn) errors.push({ code: 'P006', cStat: 'SIM-600', message: `Produto "${name}" sem CSOSN para MEI/Simples Nacional.` });
  }
  return errors;
};

const validateTotals = (sale, items) => {
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const saleTotal = Number(sale.totalAmount || 0);
  if (Math.abs(itemsTotal - saleTotal) > 0.01) {
    return [{
      code: 'T001',
      cStat: 'SIM-610',
      message: `Total da venda (${saleTotal.toFixed(2)}) difere da soma dos itens (${itemsTotal.toFixed(2)}).`,
    }];
  }
  return [];
};

class FakeSefazProvider {
  authorize({ settings, document, sale, items }) {
    const errors = [...validateSettings(settings), ...validateProducts(items, settings), ...validateTotals(sale, items)];
    if (errors.length) {
      return {
        status: 'rejected',
        cStat: errors[0].cStat || 'SIM-999',
        reason: `Rejeicao simulada: ${errors[0].message}`,
        validationMessages: errors,
      };
    }

    const accessKey = makeAccessKey(settings, document, sale);
    const protocol = `SIM${Date.now()}`;
    const qrCodeUrl = `https://homolog.sefaz.go.gov.br/nfce/qrcode?p=${accessKey}|2|${settings.environment}|${settings.cscId}`;
    const xml = buildNfceXml({ settings, document, sale, items, accessKey, protocol, qrCodeUrl });

    return {
      status: 'authorized',
      cStat: '100',
      reason: 'Autorizado o uso da NFC-e (simulado).',
      accessKey,
      protocol,
      qrCodeUrl,
      xml,
      validationMessages: [],
    };
  }
}

const getFiscalProvider = (mode) => {
  if (mode === 'simulated') return new FakeSefazProvider();
  if (mode === 'sefaz_go') return new SefazGoProvider();
  return null;
};

module.exports = {
  getFiscalProvider,
  validateSettings,
  validateProducts,
  validateTotals,
};
