const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const MAX_CERTIFICATE_BYTES = 512 * 1024;
const DEFAULT_STORAGE_ROOT = path.join(__dirname, 'private', 'fiscal-certificates');

const getStorageRoot = () => path.resolve(process.env.FISCAL_CERTIFICATES_DIR || DEFAULT_STORAGE_ROOT);

const ensureStorageRoot = (establishmentId) => {
  const root = getStorageRoot();
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(root, 0o700); } catch {}
  if (!establishmentId) return root;
  const tenantFolder = crypto.createHash('sha256').update(String(establishmentId)).digest('hex').slice(0, 32);
  const tenantRoot = path.join(root, tenantFolder);
  fs.mkdirSync(tenantRoot, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(tenantRoot, 0o700); } catch {}
  return tenantRoot;
};

const isManagedCertificatePath = (certificatePath) => {
  if (!certificatePath) return false;
  const root = getStorageRoot();
  const resolved = path.resolve(certificatePath);
  return resolved.startsWith(`${root}${path.sep}`);
};

const safeOriginalName = (fileName) => {
  const name = path.basename(String(fileName || '')).slice(0, 120);
  if (!name || !/\.(pfx|p12)$/i.test(name)) {
    throw new Error('Selecione um certificado A1 no formato .pfx ou .p12.');
  }
  return name;
};

const decodeCertificateBase64 = (value) => {
  const normalized = String(value || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '');
  if (!normalized || !/^[a-z0-9+/]+={0,2}$/i.test(normalized)) {
    throw new Error('Arquivo de certificado invalido.');
  }
  const certificate = Buffer.from(normalized, 'base64');
  if (!certificate.length) throw new Error('Arquivo de certificado vazio.');
  if (certificate.length > MAX_CERTIFICATE_BYTES) {
    throw new Error('O certificado excede o limite de 512 KB.');
  }
  return certificate;
};

const parsePowerShellCertificate = (certificatePath, password) => {
  const pathBase64 = Buffer.from(certificatePath, 'utf8').toString('base64');
  const passwordBase64 = Buffer.from(password, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$certPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${pathBase64}'))
$plainPassword = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${passwordBase64}'))
$securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($certPath, $securePassword, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)
if (-not $cert.HasPrivateKey) { throw 'Certificado sem chave privada.' }
[PSCustomObject]@{subject=$cert.Subject;issuer=$cert.Issuer;serialNumber=$cert.SerialNumber;thumbprint=$cert.Thumbprint;validFrom=$cert.NotBefore.ToUniversalTime().ToString('o');validTo=$cert.NotAfter.ToUniversalTime().ToString('o');hasPrivateKey=$cert.HasPrivateKey} | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: script.trim(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error('Nao foi possivel abrir o certificado. Verifique o arquivo e a senha.');
  }
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new Error('Nao foi possivel ler os metadados do certificado.');
  }
};

const extractPemCertificate = (output) => {
  const match = String(output || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
  return match?.[0] || '';
};

const parseOpenSslCertificate = (certificatePath, password) => {
  const passwordInput = `${password}\n`;
  const certificateResult = spawnSync(
    'openssl',
    ['pkcs12', '-in', certificatePath, '-clcerts', '-nokeys', '-passin', 'stdin'],
    { input: passwordInput, encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  if (certificateResult.status !== 0) {
    throw new Error('Nao foi possivel abrir o certificado. Verifique o arquivo e a senha.');
  }

  const privateKeyResult = spawnSync(
    'openssl',
    ['pkcs12', '-in', certificatePath, '-nocerts', '-nodes', '-passin', 'stdin'],
    { input: passwordInput, encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  if (privateKeyResult.status !== 0 || !String(privateKeyResult.stdout).includes('PRIVATE KEY')) {
    throw new Error('O certificado informado nao possui chave privada.');
  }

  const pem = extractPemCertificate(certificateResult.stdout);
  if (!pem) throw new Error('Nao foi possivel ler o certificado X.509 dentro do arquivo.');
  const certificate = new crypto.X509Certificate(pem);
  return {
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    thumbprint: certificate.fingerprint256.replaceAll(':', ''),
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
    hasPrivateKey: true,
  };
};

const inspectPfxCertificate = (certificatePath, password) => {
  if (!password) throw new Error('Informe a senha do certificado.');
  const metadata = process.platform === 'win32'
    ? parsePowerShellCertificate(certificatePath, password)
    : parseOpenSslCertificate(certificatePath, password);
  const validFrom = new Date(metadata.validFrom);
  const validTo = new Date(metadata.validTo);
  const now = new Date();

  if (!Number.isFinite(validFrom.getTime()) || !Number.isFinite(validTo.getTime())) {
    throw new Error('O certificado nao possui um periodo de validade reconhecido.');
  }
  if (validFrom > now) throw new Error('O certificado ainda nao esta valido.');
  if (validTo <= now) throw new Error('O certificado esta expirado.');

  return {
    ...metadata,
    validFrom: validFrom.toISOString(),
    validTo: validTo.toISOString(),
  };
};

const storeFiscalCertificate = ({ establishmentId, fileName, certificateBase64, password }) => {
  if (!establishmentId) throw new Error('Estabelecimento nao identificado.');
  const originalFileName = safeOriginalName(fileName);
  const certificate = decodeCertificateBase64(certificateBase64);
  const root = ensureStorageRoot(establishmentId);
  const temporaryPath = path.join(root, `.upload-${uuidv4()}.pfx`);
  const finalPath = path.join(root, `${uuidv4()}.pfx`);

  fs.writeFileSync(temporaryPath, certificate, { mode: 0o600, flag: 'wx' });
  try {
    const metadata = inspectPfxCertificate(temporaryPath, password);
    fs.renameSync(temporaryPath, finalPath);
    try { fs.chmodSync(finalPath, 0o600); } catch {}
    return {
      path: finalPath,
      originalFileName,
      fileFingerprint: crypto.createHash('sha256').update(certificate).digest('hex'),
      ...metadata,
    };
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
};

const removeManagedCertificate = (certificatePath) => {
  if (!isManagedCertificatePath(certificatePath)) return false;
  try {
    fs.unlinkSync(path.resolve(certificatePath));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

module.exports = {
  MAX_CERTIFICATE_BYTES,
  decodeCertificateBase64,
  getStorageRoot,
  inspectPfxCertificate,
  isManagedCertificatePath,
  removeManagedCertificate,
  storeFiscalCertificate,
};
