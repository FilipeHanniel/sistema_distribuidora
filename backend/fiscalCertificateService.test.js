const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  decodeCertificateBase64,
  inspectPfxCertificate,
  isManagedCertificatePath,
  removeManagedCertificate,
  storeFiscalCertificate,
} = require('./fiscalCertificateService');

const fakeCertificatePath = path.join(__dirname, 'certs', 'fake-a1.pfx');
const fakeCertificatePassword = 'fake-a1-123456';

test('rejeita conteudo que nao representa um arquivo em base64', () => {
  assert.throws(() => decodeCertificateBase64('nao-e-base64!!!'), /invalido/);
});

test('valida certificado A1 com chave privada e senha correta', () => {
  const metadata = inspectPfxCertificate(fakeCertificatePath, fakeCertificatePassword);
  assert.equal(metadata.hasPrivateKey, true);
  assert.match(metadata.subject, /Distribuidora Fake A1/);
  assert.ok(new Date(metadata.validTo) > new Date());
});

test('rejeita certificado A1 com senha incorreta', () => {
  assert.throws(
    () => inspectPfxCertificate(fakeCertificatePath, 'senha-incorreta'),
    /Verifique o arquivo e a senha/
  );
});

test('armazena certificado em area privada gerenciada e permite remove-lo', () => {
  const certificateBase64 = fs.readFileSync(fakeCertificatePath).toString('base64');
  const stored = storeFiscalCertificate({
    establishmentId: 'certificate-service-test',
    fileName: 'teste.pfx',
    certificateBase64,
    password: fakeCertificatePassword,
  });

  assert.equal(isManagedCertificatePath(stored.path), true);
  assert.equal(fs.existsSync(stored.path), true);
  assert.equal(stored.originalFileName, 'teste.pfx');
  assert.equal(removeManagedCertificate(stored.path), true);
  assert.equal(fs.existsSync(stored.path), false);
});
