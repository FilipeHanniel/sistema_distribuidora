const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const XMLDSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N_ALGORITHM = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
const SIGNATURE_ALGORITHM = `${XMLDSIG_NS}rsa-sha1`;
const DIGEST_ALGORITHM = `${XMLDSIG_NS}sha1`;
const ENVELOPED_ALGORITHM = `${XMLDSIG_NS}enveloped-signature`;
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';

const normalizeXml = (xml) => String(xml || '')
  .replace(/^\uFEFF/, '')
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .trim();

const extractPemBlock = (output, labelPattern) => {
  const regex = new RegExp(`-----BEGIN ${labelPattern}-----[\\s\\S]+?-----END ${labelPattern}-----`);
  return String(output || '').match(regex)?.[0] || '';
};

const resolveCertificatePath = (certificatePath) => {
  if (!certificatePath) throw new Error('Certificado A1 nao configurado.');
  return path.isAbsolute(certificatePath)
    ? certificatePath
    : path.resolve(__dirname, '..', certificatePath);
};

const runPowerShellJson = (script) => {
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: script.trim(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Falha ao acessar certificado A1. ${(result.stderr || result.stdout).trim()}`);
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error('Nao foi possivel interpretar a resposta da assinatura A1.');
  }
};

const powerShellLiteral = (value) => Buffer.from(String(value || ''), 'utf8').toString('base64');

const getCertificateBase64WithPowerShell = (certificatePath, password) => {
  const script = `
$ErrorActionPreference = 'Stop'
$certPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${powerShellLiteral(certificatePath)}'))
$plainPassword = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${powerShellLiteral(password)}'))
$securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath, $securePassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
if (-not $cert.HasPrivateKey) { throw 'Certificado sem chave privada.' }
[PSCustomObject]@{certificate=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))} | ConvertTo-Json -Compress
`;
  return runPowerShellJson(script).certificate;
};

const signDataWithPowerShell = ({ certificatePath, password, data }) => {
  const script = `
$ErrorActionPreference = 'Stop'
$certPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${powerShellLiteral(certificatePath)}'))
$plainPassword = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${powerShellLiteral(password)}'))
$data = [Convert]::FromBase64String('${Buffer.from(data, 'utf8').toString('base64')}')
$securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath, $securePassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
$rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPrivateKey($cert)
if ($null -eq $rsa) { throw 'Chave privada RSA nao encontrada.' }
$sig = $rsa.SignData($data, [System.Security.Cryptography.HashAlgorithmName]::SHA1, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
[PSCustomObject]@{signature=[Convert]::ToBase64String($sig);certificate=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))} | ConvertTo-Json -Compress
`;
  return runPowerShellJson(script);
};

const runOpenSslPkcs12 = (certificatePath, password, args) => {
  const result = spawnSync('openssl', ['pkcs12', '-in', certificatePath, ...args, '-passin', 'stdin'], {
    input: `${password || ''}\n`,
    encoding: 'utf8',
    maxBuffer: 5 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Falha ao abrir certificado A1 com OpenSSL. ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
};

const getCertificateBase64WithOpenSsl = (certificatePath, password) => {
  const pem = extractPemBlock(
    runOpenSslPkcs12(certificatePath, password, ['-clcerts', '-nokeys']),
    'CERTIFICATE'
  );
  if (!pem) throw new Error('Nao foi possivel extrair o certificado X.509 do A1.');
  return pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, '');
};

const signDataWithOpenSsl = ({ certificatePath, password, data }) => {
  const privateKeyPem = extractPemBlock(
    runOpenSslPkcs12(certificatePath, password, ['-nocerts', '-nodes']),
    '(?:RSA )?PRIVATE KEY'
  );
  if (!privateKeyPem) throw new Error('Nao foi possivel extrair a chave privada do certificado A1.');
  return {
    signature: crypto.sign('RSA-SHA1', Buffer.from(data, 'utf8'), privateKeyPem).toString('base64'),
    certificate: getCertificateBase64WithOpenSsl(certificatePath, password),
  };
};

const parseAttributes = (rawAttributes = '') => {
  const attrs = [];
  const regex = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = regex.exec(rawAttributes))) {
    attrs.push({ name: match[1], value: match[2] });
  }
  return attrs;
};

const escapeAttribute = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/\t/g, '&#x9;')
  .replace(/\n/g, '&#xA;')
  .replace(/\r/g, '&#xD;');

const serializeAttributes = (attrs) => attrs
  .sort((a, b) => {
    const aNs = a.name.startsWith('xmlns') ? 0 : 1;
    const bNs = b.name.startsWith('xmlns') ? 0 : 1;
    if (aNs !== bNs) return aNs - bNs;
    return a.name.localeCompare(b.name);
  })
  .map(attr => `${attr.name}="${escapeAttribute(attr.value)}"`)
  .join(' ');

const canonicalizeKnownElement = (xml, elementName, namespace = '') => {
  const normalized = normalizeXml(xml);
  const opening = normalized.match(new RegExp(`^<${elementName}\\s*([^>]*)>`));
  if (!opening) throw new Error(`Elemento ${elementName} nao encontrado para canonicalizacao.`);

  const attrs = parseAttributes(opening[1]);
  if (namespace && !attrs.some(attr => attr.name === 'xmlns')) {
    attrs.push({ name: 'xmlns', value: namespace });
  }

  const serializedAttrs = serializeAttributes(attrs);
  return normalized.replace(
    opening[0],
    serializedAttrs ? `<${elementName} ${serializedAttrs}>` : `<${elementName}>`
  );
};

const extractInfNFe = (xml) => {
  const match = normalizeXml(xml).match(/<infNFe\b[\s\S]*?<\/infNFe>/);
  if (!match) throw new Error('Elemento infNFe nao encontrado no XML.');
  return match[0];
};

const extractInfNFeId = (infNFeXml) => {
  const id = String(infNFeXml || '').match(/\bId="([^"]+)"/)?.[1];
  if (!id) throw new Error('Atributo Id do infNFe nao encontrado.');
  return id;
};

const digestInfNFe = (infNFeXml) => {
  const canonicalInfNFe = canonicalizeKnownElement(infNFeXml, 'infNFe', NFE_NS);
  return crypto.createHash('sha1').update(canonicalInfNFe, 'utf8').digest('base64');
};

const buildSignedInfo = ({ referenceUri, digestValue }) => canonicalizeKnownElement([
  `<SignedInfo xmlns="${XMLDSIG_NS}">`,
  `  <CanonicalizationMethod Algorithm="${C14N_ALGORITHM}"></CanonicalizationMethod>`,
  `  <SignatureMethod Algorithm="${SIGNATURE_ALGORITHM}"></SignatureMethod>`,
  `  <Reference URI="${referenceUri}">`,
  '    <Transforms>',
  `      <Transform Algorithm="${ENVELOPED_ALGORITHM}"></Transform>`,
  `      <Transform Algorithm="${C14N_ALGORITHM}"></Transform>`,
  '    </Transforms>',
  `    <DigestMethod Algorithm="${DIGEST_ALGORITHM}"></DigestMethod>`,
  `    <DigestValue>${digestValue}</DigestValue>`,
  '  </Reference>',
  '</SignedInfo>',
].join('\n'), 'SignedInfo', XMLDSIG_NS);

const buildSignatureXml = ({ signedInfo, signatureValue, certificateBase64 }) => [
  `<Signature xmlns="${XMLDSIG_NS}">`,
  signedInfo,
  `  <SignatureValue>${signatureValue}</SignatureValue>`,
  '  <KeyInfo>',
  '    <X509Data>',
  `      <X509Certificate>${certificateBase64.replace(/\s/g, '')}</X509Certificate>`,
  '    </X509Data>',
  '  </KeyInfo>',
  '</Signature>',
].join('\n');

const insertSignatureIntoNFe = (xml, signatureXml) => {
  if (String(xml).includes('<Signature xmlns=')) {
    throw new Error('XML NFC-e ja possui assinatura digital.');
  }
  if (!String(xml).includes('</NFe>')) throw new Error('Elemento NFe nao encontrado para inserir assinatura.');
  return String(xml).replace('</NFe>', `${signatureXml}\n  </NFe>`);
};

const signXmlWithPfx = ({ xml, certificatePath, password }) => {
  const resolvedPath = resolveCertificatePath(certificatePath);
  if (!fs.existsSync(resolvedPath)) throw new Error(`Certificado A1 nao encontrado em: ${resolvedPath}`);
  const infNFeXml = extractInfNFe(xml);
  const infNFeId = extractInfNFeId(infNFeXml);
  const digestValue = digestInfNFe(infNFeXml);
  const signedInfo = buildSignedInfo({ referenceUri: `#${infNFeId}`, digestValue });
  const material = process.platform === 'win32'
    ? signDataWithPowerShell({ certificatePath: resolvedPath, password, data: signedInfo })
    : signDataWithOpenSsl({ certificatePath: resolvedPath, password, data: signedInfo });
  const signatureXml = buildSignatureXml({
    signedInfo,
    signatureValue: material.signature,
    certificateBase64: material.certificate,
  });

  return {
    xml: insertSignatureIntoNFe(xml, signatureXml),
    infNFeId,
    digestValue,
    signatureValue: material.signature,
    certificateBase64: material.certificate,
  };
};

const getCertificateBase64FromPfx = ({ certificatePath, password }) => {
  const resolvedPath = resolveCertificatePath(certificatePath);
  return process.platform === 'win32'
    ? getCertificateBase64WithPowerShell(resolvedPath, password)
    : getCertificateBase64WithOpenSsl(resolvedPath, password);
};

const getXmlTagValue = (xml, tag) => String(xml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || '';

const verifySignedXml = (xml) => {
  const infNFeXml = extractInfNFe(xml);
  const digestValue = getXmlTagValue(xml, 'DigestValue');
  const signatureValue = getXmlTagValue(xml, 'SignatureValue');
  const certificateBase64 = getXmlTagValue(xml, 'X509Certificate');
  const signedInfoMatch = String(xml || '').match(/<SignedInfo\b[\s\S]*?<\/SignedInfo>/);
  if (!signedInfoMatch || !digestValue || !signatureValue || !certificateBase64) return false;
  const expectedDigest = digestInfNFe(infNFeXml);
  if (expectedDigest !== digestValue) return false;

  const signedInfo = canonicalizeKnownElement(signedInfoMatch[0], 'SignedInfo', XMLDSIG_NS);
  const certificatePem = [
    '-----BEGIN CERTIFICATE-----',
    certificateBase64.replace(/\s/g, '').match(/.{1,64}/g).join('\n'),
    '-----END CERTIFICATE-----',
  ].join('\n');
  return crypto.verify('RSA-SHA1', Buffer.from(signedInfo, 'utf8'), certificatePem, Buffer.from(signatureValue, 'base64'));
};

module.exports = {
  C14N_ALGORITHM,
  DIGEST_ALGORITHM,
  ENVELOPED_ALGORITHM,
  SIGNATURE_ALGORITHM,
  buildSignedInfo,
  canonicalizeKnownElement,
  digestInfNFe,
  extractInfNFe,
  extractInfNFeId,
  getCertificateBase64FromPfx,
  signXmlWithPfx,
  verifySignedXml,
};
