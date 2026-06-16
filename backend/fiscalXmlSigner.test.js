const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const { buildNfceXml } = require('./fiscalXmlBuilder');
const {
  DIGEST_ALGORITHM,
  SIGNATURE_ALGORITHM,
  signXmlWithPfx,
  verifySignedXml,
} = require('./fiscalXmlSigner');

const fakeCertificatePath = path.join(__dirname, 'certs', 'fake-a1.pfx');
const fakeCertificatePassword = 'fake-a1-123456';

const settings = {
  cnpj: '12345678000190',
  legalName: 'Distribuidora Fake A1 Ltda',
  tradeName: 'Distribuidora Fake',
  stateRegistration: '109876543',
  taxRegime: 'simples',
  crt: '1',
  streetName: 'Rua 001',
  streetNumber: '10',
  district: 'Centro',
  cityName: 'Goiania',
  cityCode: '5208707',
  state: 'GO',
  zipCode: '74000000',
  cscId: '1',
  environment: 'homologation',
};

const document = {
  id: 'doc-assinatura',
  model: '65',
  serie: '1',
  number: 1,
};

const sale = {
  id: 'sale-assinatura',
  totalAmount: 10,
  paymentMethod: 'pix',
  createdAt: '2026-06-16T10:00:00.000Z',
};

const items = [{
  productId: 'prod-1',
  name: 'Produto Fiscal Teste',
  barcode: '',
  ncm: '22021000',
  cfop: '5102',
  fiscalUnit: 'UN',
  origin: '0',
  csosn: '102',
  quantity: 1,
  unitPrice: 10,
  totalPrice: 10,
}];

test('assina XML NFC-e com certificado A1 usando XMLDSig', () => {
  const xml = buildNfceXml({
    settings,
    document,
    sale,
    items,
    accessKey: '52260612345678000190650010000000011000000010',
    protocol: 'SIM123',
    qrCodeUrl: 'https://homolog.sefaz.go.gov.br/nfce/qrcode?p=teste',
  });

  const signed = signXmlWithPfx({
    xml,
    certificatePath: fakeCertificatePath,
    password: fakeCertificatePassword,
  });

  assert.match(signed.xml, /<Signature xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/);
  assert.match(signed.xml, new RegExp(`<SignatureMethod Algorithm="${SIGNATURE_ALGORITHM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></SignatureMethod>`));
  assert.match(signed.xml, new RegExp(`<DigestMethod Algorithm="${DIGEST_ALGORITHM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></DigestMethod>`));
  assert.match(signed.xml, /<Reference URI="#NFe52260612345678000190650010000000011000000010">/);
  assert.match(signed.xml, /<X509Certificate>[A-Za-z0-9+/=]+<\/X509Certificate>/);
  assert.equal(verifySignedXml(signed.xml), true);
});

test('rejeita XML que ja possui assinatura digital', () => {
  const xml = '<NFe><infNFe Id="NFe1" versao="4.00"></infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"></Signature></NFe>';
  assert.throws(() => signXmlWithPfx({
    xml,
    certificatePath: fakeCertificatePath,
    password: fakeCertificatePassword,
  }), /ja possui assinatura/);
});
