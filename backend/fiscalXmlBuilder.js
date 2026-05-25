const onlyDigits = (value = '') => String(value).replace(/\D/g, '');

const escapeXml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const money = (value = 0) => Number(value || 0).toFixed(2);

const paymentCode = (method) => {
  if (method === 'money') return '01';
  if (method === 'card') return '03';
  if (method === 'pix') return '17';
  return '99';
};

const buildNfceXml = ({ settings, document, sale, items, accessKey, protocol, qrCodeUrl }) => {
  const totalProducts = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
  const issueDate = new Date(sale.createdAt || Date.now()).toISOString();
  const serie = document.serie || '1';
  const number = document.number || 1;

  const itemXml = items.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unitPrice || 0);
    const totalPrice = Number(item.totalPrice || quantity * unitPrice);
    const taxTag = settings.taxRegime === 'normal'
      ? `<ICMS00><orig>${escapeXml(item.origin || '0')}</orig><CST>${escapeXml(item.cst || '00')}</CST><modBC>3</modBC><vBC>0.00</vBC><pICMS>${money(item.taxRate)}</pICMS><vICMS>0.00</vICMS></ICMS00>`
      : `<ICMSSN102><orig>${escapeXml(item.origin || '0')}</orig><CSOSN>${escapeXml(item.csosn || '102')}</CSOSN></ICMSSN102>`;

    return [
      `    <det nItem="${index + 1}">`,
      '      <prod>',
      `        <cProd>${escapeXml(item.productId)}</cProd>`,
      `        <cEAN>${escapeXml(item.barcode || 'SEM GTIN')}</cEAN>`,
      `        <xProd>${escapeXml(item.name)}</xProd>`,
      `        <NCM>${onlyDigits(item.ncm)}</NCM>`,
      `        <CFOP>${onlyDigits(item.cfop)}</CFOP>`,
      `        <uCom>${escapeXml(item.fiscalUnit || 'UN')}</uCom>`,
      `        <qCom>${quantity.toFixed(4)}</qCom>`,
      `        <vUnCom>${unitPrice.toFixed(10)}</vUnCom>`,
      `        <vProd>${money(totalPrice)}</vProd>`,
      `        <cEANTrib>${escapeXml(item.barcode || 'SEM GTIN')}</cEANTrib>`,
      `        <uTrib>${escapeXml(item.fiscalUnit || 'UN')}</uTrib>`,
      `        <qTrib>${quantity.toFixed(4)}</qTrib>`,
      `        <vUnTrib>${unitPrice.toFixed(10)}</vUnTrib>`,
      '        <indTot>1</indTot>',
      '      </prod>',
      '      <imposto>',
      `        <ICMS>${taxTag}</ICMS>`,
      '        <PIS><PISOutr><CST>99</CST><vBC>0.00</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISOutr></PIS>',
      '        <COFINS><COFINSOutr><CST>99</CST><vBC>0.00</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>',
      '      </imposto>',
      '    </det>',
    ].join('\n');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">',
    '  <NFe>',
    `  <infNFe Id="NFe${accessKey}" versao="4.00">`,
    '    <ide>',
    '      <cUF>52</cUF>',
    `      <cNF>${accessKey.slice(35, 43)}</cNF>`,
    '      <natOp>Venda de mercadoria</natOp>',
    '      <mod>65</mod>',
    `      <serie>${escapeXml(serie)}</serie>`,
    `      <nNF>${number}</nNF>`,
    `      <dhEmi>${issueDate}</dhEmi>`,
    '      <tpNF>1</tpNF>',
    '      <idDest>1</idDest>',
    '      <cMunFG>5208707</cMunFG>',
    '      <tpImp>4</tpImp>',
    '      <tpEmis>1</tpEmis>',
    `      <cDV>${accessKey.slice(-1)}</cDV>`,
    `      <tpAmb>${settings.environment === 'production' ? '1' : '2'}</tpAmb>`,
    '      <finNFe>1</finNFe>',
    '      <indFinal>1</indFinal>',
    '      <indPres>1</indPres>',
    '      <procEmi>0</procEmi>',
    '      <verProc>sistema-distribuidora-simulado</verProc>',
    '    </ide>',
    '    <emit>',
    `      <CNPJ>${onlyDigits(settings.cnpj)}</CNPJ>`,
    `      <xNome>${escapeXml(settings.legalName)}</xNome>`,
    `      <xFant>${escapeXml(settings.tradeName || settings.legalName)}</xFant>`,
    `      <IE>${onlyDigits(settings.stateRegistration)}</IE>`,
    `      <CRT>${settings.taxRegime === 'normal' ? '3' : '1'}</CRT>`,
    '    </emit>',
    itemXml,
    '    <total>',
    '      <ICMSTot>',
    '        <vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>',
    `        <vProd>${money(totalProducts)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>`,
    '        <vII>0.00</vII><vIPI>0.00</vIPI><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>',
    `        <vOutro>0.00</vOutro><vNF>${money(sale.totalAmount)}</vNF>`,
    '      </ICMSTot>',
    '    </total>',
    '    <transp><modFrete>9</modFrete></transp>',
    '    <pag>',
    '      <detPag>',
    '        <indPag>0</indPag>',
    `        <tPag>${paymentCode(sale.paymentMethod)}</tPag>`,
    `        <vPag>${money(sale.totalAmount)}</vPag>`,
    '      </detPag>',
    '    </pag>',
    `    <infAdic><infCpl>DOCUMENTO SIMULADO SEM VALOR FISCAL. QR Code: ${escapeXml(qrCodeUrl)}</infCpl></infAdic>`,
    '  </infNFe>',
    '  </NFe>',
    '  <protNFe versao="4.00">',
    '    <infProt>',
    `      <tpAmb>${settings.environment === 'production' ? '1' : '2'}</tpAmb>`,
    '      <verAplic>SIMULADOR</verAplic>',
    `      <chNFe>${accessKey}</chNFe>`,
    `      <dhRecbto>${new Date().toISOString()}</dhRecbto>`,
    `      <nProt>${protocol}</nProt>`,
    '      <digVal>SIMULADO</digVal>',
    '      <cStat>100</cStat>',
    '      <xMotivo>Autorizado o uso da NFC-e (simulado)</xMotivo>',
    '    </infProt>',
    '  </protNFe>',
    '</nfeProc>',
  ].join('\n');
};

module.exports = {
  buildNfceXml,
  onlyDigits,
};
