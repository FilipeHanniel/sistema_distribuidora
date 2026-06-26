const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifySignedXml } = require('./fiscalXmlSigner');

const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const DEFAULT_SCHEMA_ENV = 'NFCE_XSD_PATH';

const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const getTag = (xml, tag) => {
  const match = String(xml || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? match[1].trim() : '';
};

const getAllTags = (xml, tag) => [...String(xml || '').matchAll(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'))]
  .map(match => match[0]);

const getAttribute = (xml, attr) => String(xml || '').match(new RegExp(`\\b${attr}="([^"]+)"`, 'i'))?.[1] || '';

const makeMessage = (code, message, cStat = 'SIM-XSD') => ({ code, cStat, message });

const decimal = (value) => {
  if (!String(value || '').match(/^\d+(\.\d{2,10})?$/)) return null;
  return Number(value);
};

const sameMoney = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.01;

const calculateAccessKeyDigit = (base) => {
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const digit = 11 - (sum % 11);
  return digit >= 10 ? '0' : String(digit);
};

const validateWellFormedXml = (xml) => {
  const errors = [];
  const source = String(xml || '').trim();
  if (!source) return [makeMessage('XVAL001', 'XML fiscal vazio.')];

  const withoutDeclarations = source
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  const stack = [];
  const tagRegex = /<\/?([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?>/g;
  let match;
  while ((match = tagRegex.exec(withoutDeclarations))) {
    const full = match[0];
    const name = match[1];
    if (full.startsWith('<?') || full.startsWith('<!') || full.endsWith('/>')) continue;
    if (full.startsWith('</')) {
      const last = stack.pop();
      if (last !== name) {
        errors.push(makeMessage('XVAL002', `XML malformado: fechamento de ${name} nao corresponde a ${last || 'nenhum elemento aberto'}.`));
        break;
      }
    } else {
      stack.push(name);
    }
  }
  if (!errors.length && stack.length) {
    errors.push(makeMessage('XVAL003', `XML malformado: elemento ${stack[stack.length - 1]} nao foi fechado.`));
  }
  return errors;
};

const validateAccessKey = (xml, errors) => {
  const infNFe = String(xml || '').match(/<infNFe\b[\s\S]*?<\/infNFe>/)?.[0] || '';
  if (!infNFe) {
    errors.push(makeMessage('XVAL010', 'Elemento infNFe nao encontrado.'));
    return '';
  }
  const id = getAttribute(infNFe, 'Id');
  const accessKey = id.startsWith('NFe') ? id.slice(3) : '';
  if (!accessKey.match(/^\d{44}$/)) {
    errors.push(makeMessage('XVAL011', 'Atributo Id do infNFe deve conter NFe seguido da chave de acesso com 44 digitos.'));
    return accessKey;
  }
  const expectedDigit = calculateAccessKeyDigit(accessKey.slice(0, 43));
  if (accessKey.slice(-1) !== expectedDigit) {
    errors.push(makeMessage('XVAL012', 'Digito verificador da chave de acesso nao confere.'));
  }
  if (getTag(xml, 'cDV') && getTag(xml, 'cDV') !== accessKey.slice(-1)) {
    errors.push(makeMessage('XVAL013', 'Tag cDV nao confere com o digito da chave de acesso.'));
  }
  return accessKey;
};

const validateHeader = (xml, errors) => {
  if (!String(xml).includes(`<nfeProc versao="4.00" xmlns="${NFE_NS}">`)) {
    errors.push(makeMessage('XVAL020', 'Raiz nfeProc versao 4.00 com namespace oficial da NF-e nao encontrada.'));
  }
  if (getTag(xml, 'mod') !== '65') errors.push(makeMessage('XVAL021', 'Modelo do documento deve ser NFC-e 65.'));
  if (getTag(xml, 'cUF') !== '52') errors.push(makeMessage('XVAL022', 'cUF deve ser 52 para Goias.'));
  if (!getTag(xml, 'cMunFG').match(/^\d{7}$/)) errors.push(makeMessage('XVAL023', 'cMunFG deve conter codigo IBGE de 7 digitos.'));
  if (!['1', '2'].includes(getTag(xml, 'tpAmb'))) errors.push(makeMessage('XVAL024', 'tpAmb deve ser 1 producao ou 2 homologacao.'));
  if (getTag(xml, 'tpImp') !== '4') errors.push(makeMessage('XVAL025', 'tpImp deve ser 4 para DANFE NFC-e.'));
  if (getTag(xml, 'tpEmis') !== '1') errors.push(makeMessage('XVAL026', 'tpEmis deve ser 1 para emissao normal.'));
  if (getTag(xml, 'finNFe') !== '1') errors.push(makeMessage('XVAL027', 'finNFe deve ser 1 para NF-e normal.'));
  if (!getTag(xml, 'verProc')) errors.push(makeMessage('XVAL028', 'verProc deve ser informado.'));
};

const validateEmitter = (xml, errors) => {
  if (!getTag(xml, 'CNPJ').match(/^\d{14}$/)) errors.push(makeMessage('XVAL040', 'CNPJ do emitente deve conter 14 digitos.'));
  if (!getTag(xml, 'xNome')) errors.push(makeMessage('XVAL041', 'Razao social do emitente deve ser informada.'));
  if (!getTag(xml, 'xLgr') || !getTag(xml, 'nro') || !getTag(xml, 'xBairro')) {
    errors.push(makeMessage('XVAL042', 'Endereco do emitente incompleto.'));
  }
  if (!getTag(xml, 'cMun').match(/^\d{7}$/)) errors.push(makeMessage('XVAL043', 'Codigo IBGE do municipio do emitente invalido.'));
  if (!getTag(xml, 'UF').match(/^[A-Z]{2}$/)) errors.push(makeMessage('XVAL044', 'UF do emitente invalida.'));
  if (getTag(xml, 'CEP') && !getTag(xml, 'CEP').match(/^\d{8}$/)) errors.push(makeMessage('XVAL045', 'CEP do emitente deve conter 8 digitos.'));
  if (!getTag(xml, 'IE').match(/^\d{2,14}$/)) errors.push(makeMessage('XVAL046', 'Inscricao estadual do emitente invalida.'));
  if (!['1', '2', '3', '4'].includes(getTag(xml, 'CRT'))) errors.push(makeMessage('XVAL047', 'CRT do emitente invalido.'));
};

const validateItems = (xml, errors) => {
  const items = getAllTags(xml, 'det');
  if (!items.length) {
    errors.push(makeMessage('XVAL050', 'NFC-e deve possuir ao menos um item.'));
    return 0;
  }

  let totalProducts = 0;
  items.forEach((detXml, index) => {
    const nItem = Number(getAttribute(detXml, 'nItem'));
    const label = `Item ${index + 1}`;
    if (nItem !== index + 1) errors.push(makeMessage('XVAL051', `${label}: nItem deve ser sequencial.`));
    if (!getTag(detXml, 'cProd')) errors.push(makeMessage('XVAL052', `${label}: cProd obrigatorio.`));
    if (!getTag(detXml, 'xProd')) errors.push(makeMessage('XVAL053', `${label}: xProd obrigatorio.`));
    if (!getTag(detXml, 'NCM').match(/^\d{8}$/)) errors.push(makeMessage('XVAL054', `${label}: NCM deve conter 8 digitos.`));
    if (!getTag(detXml, 'CFOP').match(/^\d{4}$/)) errors.push(makeMessage('XVAL055', `${label}: CFOP deve conter 4 digitos.`));
    if (!getTag(detXml, 'uCom')) errors.push(makeMessage('XVAL056', `${label}: unidade comercial obrigatoria.`));
    const qCom = decimal(getTag(detXml, 'qCom'));
    const vUnCom = decimal(getTag(detXml, 'vUnCom'));
    const vProd = decimal(getTag(detXml, 'vProd'));
    if (!qCom || qCom <= 0) errors.push(makeMessage('XVAL057', `${label}: qCom deve ser maior que zero.`));
    if (vUnCom === null || vUnCom < 0) errors.push(makeMessage('XVAL058', `${label}: vUnCom invalido.`));
    if (vProd === null || vProd < 0) errors.push(makeMessage('XVAL059', `${label}: vProd invalido.`));
    if (qCom && vUnCom !== null && vProd !== null && !sameMoney(qCom * vUnCom, vProd)) {
      errors.push(makeMessage('XVAL060', `${label}: vProd nao confere com qCom x vUnCom.`));
    }
    if (!String(detXml).includes('<ICMS>')) errors.push(makeMessage('XVAL061', `${label}: grupo ICMS obrigatorio.`));
    if (!String(detXml).includes('<PIS>')) errors.push(makeMessage('XVAL062', `${label}: grupo PIS obrigatorio.`));
    if (!String(detXml).includes('<COFINS>')) errors.push(makeMessage('XVAL063', `${label}: grupo COFINS obrigatorio.`));
    totalProducts += Number(vProd || 0);
  });
  return totalProducts;
};

const validateTotals = (xml, errors, itemsTotal) => {
  const totalXml = String(xml || '').match(/<ICMSTot\b[\s\S]*?<\/ICMSTot>/)?.[0] || '';
  if (!totalXml) {
    errors.push(makeMessage('XVAL070', 'Grupo ICMSTot obrigatorio.'));
    return;
  }
  const declaredProducts = decimal(getTag(totalXml, 'vProd'));
  const declaredInvoice = decimal(getTag(totalXml, 'vNF'));
  if (declaredProducts === null) errors.push(makeMessage('XVAL071', 'Total vProd invalido.'));
  if (declaredInvoice === null) errors.push(makeMessage('XVAL072', 'Total vNF invalido.'));
  if (declaredProducts !== null && !sameMoney(declaredProducts, itemsTotal)) {
    errors.push(makeMessage('XVAL073', 'Total vProd nao confere com a soma dos itens.'));
  }
  const payments = getAllTags(xml, 'detPag');
  if (!payments.length) errors.push(makeMessage('XVAL074', 'Grupo de pagamento detPag obrigatorio.'));
  const paidTotal = payments.reduce((sum, paymentXml) => sum + Number(decimal(getTag(paymentXml, 'vPag')) || 0), 0);
  if (declaredInvoice !== null && !sameMoney(paidTotal, declaredInvoice)) {
    errors.push(makeMessage('XVAL075', 'Total pago nao confere com vNF.'));
  }
};

const validateSignature = (xml, errors) => {
  if (!String(xml || '').includes('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">')) {
    errors.push(makeMessage('XVAL080', 'Assinatura XMLDSig nao encontrada.'));
    return;
  }
  if (!verifySignedXml(xml)) {
    errors.push(makeMessage('XVAL081', 'Assinatura XMLDSig invalida ou DigestValue divergente.'));
  }
};

const validateProtocol = (xml, errors) => {
  if (!String(xml || '').includes('<protNFe')) return;
  if (!getTag(xml, 'chNFe').match(/^\d{44}$/)) errors.push(makeMessage('XVAL090', 'Protocolo sem chNFe valida.'));
  if (!getTag(xml, 'cStat')) errors.push(makeMessage('XVAL091', 'Protocolo sem cStat.'));
  if (!getTag(xml, 'xMotivo')) errors.push(makeMessage('XVAL092', 'Protocolo sem xMotivo.'));
};

const validateFiscalXmlStructure = (xml) => {
  const errors = validateWellFormedXml(xml);
  if (errors.length) return errors;
  validateAccessKey(xml, errors);
  validateHeader(xml, errors);
  validateEmitter(xml, errors);
  const itemsTotal = validateItems(xml, errors);
  validateTotals(xml, errors, itemsTotal);
  validateSignature(xml, errors);
  validateProtocol(xml, errors);
  return errors;
};

const resolveSchemaPath = (schemaPath) => {
  const configured = schemaPath || process.env[DEFAULT_SCHEMA_ENV] || '';
  if (!configured) return '';
  return path.isAbsolute(configured) ? configured : path.resolve(__dirname, '..', configured);
};

const runPowerShellSchemaValidation = (xmlPath, schemaPath) => {
  const encode = value => Buffer.from(String(value || ''), 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$xmlPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(xmlPath)}'))
$schemaPath = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(schemaPath)}'))
$schemas = New-Object System.Xml.Schema.XmlSchemaSet
$schemas.Add('${NFE_NS}', $schemaPath) | Out-Null
$settings = New-Object System.Xml.XmlReaderSettings
$settings.ValidationType = [System.Xml.ValidationType]::Schema
$settings.Schemas = $schemas
$messages = New-Object System.Collections.Generic.List[string]
$settings.add_ValidationEventHandler({ param($sender, $eventArgs) $messages.Add($eventArgs.Message) })
$reader = [System.Xml.XmlReader]::Create($xmlPath, $settings)
while ($reader.Read()) { }
$reader.Close()
[PSCustomObject]@{valid=($messages.Count -eq 0);errors=$messages.ToArray()} | ConvertTo-Json -Compress
`;
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: script.trim(),
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
  return JSON.parse(result.stdout.trim());
};

const runXmllintSchemaValidation = (xmlPath, schemaPath) => {
  const result = spawnSync('xmllint', ['--noout', '--schema', schemaPath, xmlPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    valid: result.status === 0,
    errors: result.status === 0 ? [] : String(result.stderr || result.stdout || '').split(/\r?\n/).filter(Boolean),
  };
};

const validateXmlWithSchema = (xml, schemaPath) => {
  const resolvedSchema = resolveSchemaPath(schemaPath);
  if (!resolvedSchema || !fs.existsSync(resolvedSchema)) {
    return {
      available: false,
      errors: [makeMessage('XSD001', `Schema XSD da NFC-e nao encontrado. Configure ${DEFAULT_SCHEMA_ENV}.`)],
    };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfce-xsd-'));
  const xmlPath = path.join(tempDir, 'documento.xml');
  fs.writeFileSync(xmlPath, String(xml || ''), 'utf8');
  try {
    const result = process.platform === 'win32'
      ? runPowerShellSchemaValidation(xmlPath, resolvedSchema)
      : runXmllintSchemaValidation(xmlPath, resolvedSchema);
    return {
      available: true,
      errors: (result.errors || []).map((message, index) => makeMessage(`XSD${String(index + 2).padStart(3, '0')}`, `Schema XSD: ${message}`)),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const validateFiscalXml = (xml, options = {}) => {
  const errors = validateFiscalXmlStructure(xml);
  const warnings = [];
  const schemaPath = resolveSchemaPath(options.schemaPath);
  const requireSchema = options.requireSchema ?? String(process.env.FISCAL_XSD_STRICT || '').toLowerCase() === 'true';

  if (!errors.length && (schemaPath || requireSchema)) {
    const schemaValidation = validateXmlWithSchema(xml, schemaPath);
    if (!schemaValidation.available && !requireSchema) {
      warnings.push('Validacao XSD oficial nao executada porque NFCE_XSD_PATH nao foi configurado.');
    } else {
      errors.push(...schemaValidation.errors);
    }
  } else if (!schemaPath) {
    warnings.push('Validacao estrutural executada. Para validar por XSD oficial, configure NFCE_XSD_PATH.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

module.exports = {
  DEFAULT_SCHEMA_ENV,
  validateFiscalXml,
  validateFiscalXmlStructure,
  validateXmlWithSchema,
};
