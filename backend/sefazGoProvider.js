const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { buildNfceXml } = require('./fiscalXmlBuilder');
const { signXmlWithPfx } = require('./fiscalXmlSigner');
const { validateFiscalXml } = require('./fiscalXmlValidator');

const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const getTag = (xml, tag) => {
  const match = String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
};

const getAttribute = (xml, attr) => {
  const match = String(xml || '').match(new RegExp(`${attr}="([^"]+)"`, 'i'));
  return match ? match[1] : '';
};

const postXml = (url, xml) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  const payload = Buffer.from(xml, 'utf8');

  const req = client.request({
    method: 'POST',
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      'Content-Length': payload.length,
    },
    timeout: 15000,
  }, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`SEFAZ respondeu HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        return;
      }
      resolve(body);
    });
  });

  req.on('timeout', () => {
    req.destroy(new Error('Timeout ao comunicar com a SEFAZ.'));
  });
  req.on('error', reject);
  req.write(payload);
  req.end();
});

const makeSoapEnvelope = (innerXml) => `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    ${innerXml}
  </soap:Body>
</soap:Envelope>`;

const makeAccessKeyFromDocument = (settings, document, sale) => {
  const cnpj = onlyDigits(settings.cnpj).padStart(14, '0').slice(0, 14);
  const date = new Date(sale.createdAt || Date.now());
  const aamm = `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const serie = String(document.serie || '1').padStart(3, '0').slice(-3);
  const number = String(document.number || 1).padStart(9, '0').slice(-9);
  const code = String(Date.now()).slice(-8).padStart(8, '0');
  const base = `52${aamm}${cnpj}65${serie}${number}1${code}`;
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const digit = 11 - (sum % 11);
  return `${base}${digit >= 10 ? 0 : digit}`;
};

class SefazGoProvider {
  constructor({ baseUrl } = {}) {
    this.baseUrl = (baseUrl || process.env.SEFAZ_GO_BASE_URL || 'http://127.0.0.1:4001').replace(/\/$/, '');
  }

  async authorize({ settings, document, sale, items }) {
    const certificate = this.loadCertificate(settings);
    const accessKey = document.accessKey || makeAccessKeyFromDocument(settings, document, sale);
    const protocolSeed = `PEND${Date.now()}`;
    const qrCodeUrl = `${this.baseUrl}/nfce/consulta?chNFe=${accessKey}`;
    const unsignedXml = buildNfceXml({
      settings,
      document,
      sale,
      items,
      accessKey,
      protocol: protocolSeed,
      qrCodeUrl,
    });

    const signedXml = signXmlWithPfx({
      xml: unsignedXml,
      certificatePath: certificate.path,
      password: certificate.password,
    }).xml;
    const xmlValidation = validateFiscalXml(signedXml);
    if (!xmlValidation.valid) {
      return {
        status: 'rejected',
        cStat: xmlValidation.errors[0].cStat || 'SIM-XSD',
        reason: `Rejeicao tecnica do XML: ${xmlValidation.errors[0].message}`,
        accessKey,
        protocol: '',
        qrCodeUrl,
        xml: signedXml,
        validationMessages: xmlValidation.errors,
      };
    }
    const responseXml = await postXml(`${this.baseUrl}/nfce/autorizacao`, makeSoapEnvelope(signedXml));
    return this.parseAuthorizationResponse({ responseXml, signedXml, accessKey, qrCodeUrl });
  }

  loadCertificate(settings) {
    const certPath = settings.certificatePath;
    const password = settings.certificatePassword || '';
    if (!certPath) throw new Error('Certificado A1 nao configurado.');

    const resolvedPath = path.isAbsolute(certPath)
      ? certPath
      : path.resolve(__dirname, '..', certPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Certificado A1 nao encontrado em: ${resolvedPath}`);
    }

    return {
      path: resolvedPath,
      password,
    };
  }

  parseAuthorizationResponse({ responseXml, signedXml, accessKey, qrCodeUrl }) {
    const cStats = [...String(responseXml || '').matchAll(/<cStat[^>]*>([\s\S]*?)<\/cStat>/gi)].map(match => match[1].trim());
    const reasons = [...String(responseXml || '').matchAll(/<xMotivo[^>]*>([\s\S]*?)<\/xMotivo>/gi)].map(match => match[1].trim());
    const cStat = cStats.includes('100') ? '100' : (cStats[0] || '999');
    const reason = cStats.includes('100')
      ? (reasons[cStats.indexOf('100')] || 'Autorizado o uso da NFC-e')
      : (reasons[0] || 'Resposta SEFAZ sem motivo.');
    const protocol = getTag(responseXml, 'nProt') || '';
    const returnedKey = getTag(responseXml, 'chNFe') || accessKey;
    const authorized = cStat === '100' || responseXml.includes('<cStat>100</cStat>');

    return {
      status: authorized ? 'authorized' : 'rejected',
      cStat,
      reason,
      accessKey: returnedKey,
      protocol,
      qrCodeUrl,
      xml: authorized ? this.attachProtocol(signedXml, responseXml) : signedXml,
      validationMessages: authorized ? [] : [{ code: `SEFAZ-${cStat}`, cStat, message: reason }],
      rawResponse: responseXml,
    };
  }

  attachProtocol(xml, responseXml) {
    const protocolXml = getTag(responseXml, 'protNFe');
    if (!protocolXml) return xml;
    return xml.replace('</nfeProc>', `<protNFe>${protocolXml}</protNFe></nfeProc>`);
  }

  async consult(accessKey) {
    const responseXml = await postXml(
      `${this.baseUrl}/nfce/consulta`,
      makeSoapEnvelope(`<consSitNFe><chNFe>${accessKey}</chNFe></consSitNFe>`)
    );
    return {
      cStat: getTag(responseXml, 'cStat') || '999',
      reason: getTag(responseXml, 'xMotivo') || 'Resposta SEFAZ sem motivo.',
      protocol: getTag(responseXml, 'nProt') || '',
      accessKey: getTag(responseXml, 'chNFe') || accessKey,
      rawResponse: responseXml,
    };
  }
}

module.exports = {
  SefazGoProvider,
  getTag,
  getAttribute,
};
