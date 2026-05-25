import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.SEFAZ_FAKE_PORT || 4001);
const HOST = process.env.SEFAZ_FAKE_HOST || '127.0.0.1';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.SEFAZ_FAKE_LOG_DIR || path.join(__dirname, 'logs');
const XML_DIR = path.join(LOG_DIR, 'xml');
const INDEX_FILE = path.join(LOG_DIR, 'requests.jsonl');

const ensureLogDirs = () => {
  fs.mkdirSync(XML_DIR, { recursive: true });
};

const safeTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

const getLastTag = (xml, tag) => {
  const matches = [...String(xml || '').matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))];
  return matches.length ? matches[matches.length - 1][1].trim() : '';
};

const endpointName = (url = '') => {
  if (url.includes('autorizacao')) return 'autorizacao';
  if (url.includes('consulta')) return 'consulta';
  if (url.includes('cancelamento')) return 'cancelamento';
  if (url.includes('inutilizacao')) return 'inutilizacao';
  return 'desconhecido';
};

const writeExchangeLog = ({ req, requestXml, responseXml, statusCode = 200 }) => {
  ensureLogDirs();
  const stamp = safeTimestamp();
  const endpoint = endpointName(req.url);
  const id = `${stamp}_${endpoint}_${crypto.randomBytes(3).toString('hex')}`;
  const requestFile = path.join(XML_DIR, `${id}_request.xml`);
  const responseFile = path.join(XML_DIR, `${id}_response.xml`);

  fs.writeFileSync(requestFile, requestXml || '', 'utf8');
  fs.writeFileSync(responseFile, responseXml || '', 'utf8');

  const entry = {
    id,
    createdAt: new Date().toISOString(),
    method: req.method,
    endpoint: req.url,
    statusCode,
    cStat: getLastTag(responseXml, 'cStat') || null,
    xMotivo: getLastTag(responseXml, 'xMotivo') || null,
    chNFe: getLastTag(responseXml, 'chNFe') || getLastTag(requestXml, 'chNFe') || null,
    requestXml: path.relative(LOG_DIR, requestFile).replace(/\\/g, '/'),
    responseXml: path.relative(LOG_DIR, responseFile).replace(/\\/g, '/'),
  };
  fs.appendFileSync(INDEX_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      req.destroy();
      reject(new Error('Payload muito grande.'));
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const getTag = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
};

const makeProtocol = () => `FAKE${Date.now()}`;
const makeReceipt = () => crypto.randomBytes(8).toString('hex').toUpperCase();

const soapResponse = (innerXml) => `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    ${innerXml}
  </soap:Body>
</soap:Envelope>`;

const authorizationResponse = (xml) => {
  const chave = getTag(xml, 'chNFe') || getTag(xml, 'infNFe').match(/Id="NFe(\d{44})"/)?.[1] || '';
  const ncm = getTag(xml, 'NCM');
  const cfop = getTag(xml, 'CFOP');

  if (xml.includes('<forceRejection>schema</forceRejection>')) {
    return soapResponse(`<retEnviNFe><cStat>215</cStat><xMotivo>Falha no schema XML simulada</xMotivo></retEnviNFe>`);
  }
  if (!ncm || !/^\d{8}$/.test(ncm)) {
    return soapResponse(`<retEnviNFe><cStat>778</cStat><xMotivo>Informado NCM inexistente ou invalido</xMotivo></retEnviNFe>`);
  }
  if (!cfop || !/^\d{4}$/.test(cfop)) {
    return soapResponse(`<retEnviNFe><cStat>521</cStat><xMotivo>CFOP invalido para NFC-e</xMotivo></retEnviNFe>`);
  }

  const receipt = makeReceipt();
  const protocol = makeProtocol();
  return soapResponse(`
    <retEnviNFe versao="4.00">
      <tpAmb>2</tpAmb>
      <verAplic>SEFAZ-FAKE-GO</verAplic>
      <cStat>104</cStat>
      <xMotivo>Lote processado</xMotivo>
      <cUF>52</cUF>
      <dhRecbto>${new Date().toISOString()}</dhRecbto>
      <infRec><nRec>${receipt}</nRec><tMed>1</tMed></infRec>
      <protNFe>
        <infProt>
          <tpAmb>2</tpAmb>
          <verAplic>SEFAZ-FAKE-GO</verAplic>
          <chNFe>${chave || '00000000000000000000000000000000000000000000'}</chNFe>
          <dhRecbto>${new Date().toISOString()}</dhRecbto>
          <nProt>${protocol}</nProt>
          <digVal>FAKE</digVal>
          <cStat>100</cStat>
          <xMotivo>Autorizado o uso da NFC-e</xMotivo>
        </infProt>
      </protNFe>
    </retEnviNFe>
  `);
};

const consultationResponse = (xml) => {
  const chave = getTag(xml, 'chNFe') || '00000000000000000000000000000000000000000000';
  return soapResponse(`
    <retConsSitNFe versao="4.00">
      <tpAmb>2</tpAmb>
      <verAplic>SEFAZ-FAKE-GO</verAplic>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NFC-e</xMotivo>
      <cUF>52</cUF>
      <protNFe>
        <infProt>
          <chNFe>${chave}</chNFe>
          <nProt>${makeProtocol()}</nProt>
          <cStat>100</cStat>
          <xMotivo>Autorizado o uso da NFC-e</xMotivo>
        </infProt>
      </protNFe>
    </retConsSitNFe>
  `);
};

const simpleEventResponse = (name, cStat, reason) => soapResponse(`
  <${name} versao="4.00">
    <tpAmb>2</tpAmb>
    <verAplic>SEFAZ-FAKE-GO</verAplic>
    <cStat>${cStat}</cStat>
    <xMotivo>${reason}</xMotivo>
  </${name}>
`);

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'sefaz-fake-go', port: PORT }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Metodo nao permitido.');
      return;
    }

    const body = await readBody(req);
    let response;
    if (req.url === '/nfce/autorizacao') response = authorizationResponse(body);
    else if (req.url === '/nfce/consulta') response = consultationResponse(body);
    else if (req.url === '/nfce/cancelamento') response = simpleEventResponse('retEnvEvento', 135, 'Evento registrado e vinculado a NFC-e');
    else if (req.url === '/nfce/inutilizacao') response = simpleEventResponse('retInutNFe', 102, 'Inutilizacao de numero homologada');
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Endpoint SEFAZ fake nao encontrado.');
      return;
    }

    writeExchangeLog({ req, requestXml: body, responseXml: response, statusCode: 200 });
    res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
    res.end(response);
  } catch (err) {
    const response = soapResponse(`<retErro><cStat>999</cStat><xMotivo>${err.message}</xMotivo></retErro>`);
    try {
      writeExchangeLog({ req, requestXml: '', responseXml: response, statusCode: 500 });
    } catch {}
    res.writeHead(500, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
    res.end(response);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SEFAZ Fake GO rodando em http://${HOST}:${PORT}`);
  console.log('Endpoints: /health, /nfce/autorizacao, /nfce/consulta, /nfce/cancelamento, /nfce/inutilizacao');
});
