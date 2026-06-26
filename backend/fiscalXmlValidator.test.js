const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { buildNfceXml } = require('./fiscalXmlBuilder');
const { signXmlWithPfx } = require('./fiscalXmlSigner');
const {
  validateFiscalXml,
  validateFiscalXmlStructure,
  validateXmlWithSchema,
} = require('./fiscalXmlValidator');

const fakeCertificatePath = path.join(__dirname, 'certs', 'fake-a1.pfx');
const fakeCertificatePassword = 'fake-a1-123456';

const settings = {
  cnpj: '12345678000190',
  legalName: 'Distribuidora XML Ltda',
  tradeName: 'Distribuidora XML',
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
  id: 'doc-validacao',
  model: '65',
  serie: '1',
  number: 1,
};

const sale = {
  id: 'sale-validacao',
  totalAmount: 10,
  paymentMethod: 'pix',
  createdAt: '2026-06-26T10:00:00.000Z',
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

const makeSignedXml = () => {
  const xml = buildNfceXml({
    settings,
    document,
    sale,
    items,
    accessKey: '52260612345678000190650010000000011000000015',
    protocol: 'SIM123',
    qrCodeUrl: 'https://homolog.sefaz.go.gov.br/nfce/qrcode?p=teste',
  });
  return signXmlWithPfx({
    xml,
    certificatePath: fakeCertificatePath,
    password: fakeCertificatePassword,
  }).xml;
};

test('valida estrutura tecnica do XML NFC-e assinado', () => {
  const result = validateFiscalXml(makeSignedXml());

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(message => message.includes('NFCE_XSD_PATH')));
});

test('rejeita XML com assinatura divergente apos alteracao do conteudo', () => {
  const invalidXml = makeSignedXml().replace('<vNF>10.00</vNF>', '<vNF>11.00</vNF>');
  const errors = validateFiscalXmlStructure(invalidXml);

  assert.ok(errors.some(error => error.code === 'XVAL075'));
  assert.ok(errors.some(error => error.code === 'XVAL081'));
});

test('rejeita item sem NCM no padrao tecnico esperado', () => {
  const invalidXml = makeSignedXml().replace('<NCM>22021000</NCM>', '<NCM>2202</NCM>');
  const errors = validateFiscalXmlStructure(invalidXml);

  assert.ok(errors.some(error => error.code === 'XVAL054'));
});

test('valida XML contra schema XSD quando caminho oficial estiver configurado', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfce-schema-test-'));
  const schemaPath = path.join(tempDir, 'nfeProc_v4.00.xsd');
  fs.writeFileSync(schemaPath, `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"
  targetNamespace="http://www.portalfiscal.inf.br/nfe"
  xmlns="http://www.portalfiscal.inf.br/nfe"
  elementFormDefault="qualified">
  <xs:element name="nfeProc">
    <xs:complexType>
      <xs:sequence>
        <xs:any minOccurs="0" maxOccurs="unbounded" processContents="skip"/>
      </xs:sequence>
      <xs:attribute name="versao" use="required" fixed="4.00"/>
    </xs:complexType>
  </xs:element>
</xs:schema>`, 'utf8');

  try {
    const valid = validateXmlWithSchema(makeSignedXml(), schemaPath);
    assert.equal(valid.available, true);
    assert.deepEqual(valid.errors, []);

    const invalid = validateXmlWithSchema('<outro xmlns="http://www.portalfiscal.inf.br/nfe"></outro>', schemaPath);
    assert.equal(invalid.available, true);
    assert.ok(invalid.errors.length > 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
