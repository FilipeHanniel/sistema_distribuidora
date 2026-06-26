const fs = require('fs');
const path = require('path');

const onlyDigits = (value = '') => String(value || '').replace(/\D/g, '');

const defaultCrtForTaxRegime = (taxRegime = 'simples') => {
  if (taxRegime === 'normal') return '3';
  if (taxRegime === 'mei') return '4';
  return '1';
};

const normalizeCrt = (taxRegime, crt) => {
  const value = String(crt || '').trim();
  if (['1', '2', '3', '4'].includes(value)) return value;
  return defaultCrtForTaxRegime(taxRegime);
};

const addRequirement = (requirements, condition, requirement) => {
  requirements.push({
    ...requirement,
    status: condition ? 'ok' : 'missing',
  });
};

const resolveCertificatePath = (certificatePath) => {
  if (!certificatePath) return '';
  return path.isAbsolute(certificatePath)
    ? certificatePath
    : path.resolve(__dirname, '..', certificatePath);
};

const getFiscalReadiness = (settings = {}) => {
  const enabled = Boolean(settings?.enabled);
  const mode = !enabled
    ? 'internal_control'
    : settings.providerMode === 'sefaz_go'
      ? 'sefaz_go'
      : 'simulated';
  const taxRegime = settings?.taxRegime || 'simples';
  const crt = normalizeCrt(taxRegime, settings?.crt);
  const cnpjDigits = onlyDigits(settings?.cnpj);
  const ieDigits = onlyDigits(settings?.stateRegistration);
  const zipDigits = onlyDigits(settings?.zipCode);
  const cityCodeDigits = onlyDigits(settings?.cityCode);
  const state = String(settings?.state || '').trim().toUpperCase();
  const certificatePath = settings?.certificatePath || '';
  const resolvedCertificatePath = resolveCertificatePath(certificatePath);

  const requirements = [];

  if (!enabled) {
    return {
      ready: false,
      canIssue: false,
      mode,
      summary: 'Controle interno ativo. A emissao fiscal esta desativada para este estabelecimento.',
      missing: [],
      warnings: [],
      requirements: [],
    };
  }

  addRequirement(requirements, cnpjDigits.length === 14, {
    key: 'cnpj',
    group: 'Emitente',
    label: 'CNPJ do emitente',
    message: 'Informe um CNPJ com 14 digitos.',
  });
  addRequirement(requirements, Boolean(String(settings?.legalName || '').trim()), {
    key: 'legalName',
    group: 'Emitente',
    label: 'Razao social',
    message: 'Informe a razao social conforme cadastro fiscal.',
  });
  addRequirement(requirements, Boolean(ieDigits), {
    key: 'stateRegistration',
    group: 'Emitente',
    label: 'Inscricao estadual',
    message: 'Informe a IE do contribuinte credenciado para NFC-e.',
  });
  addRequirement(requirements, Boolean(taxRegime), {
    key: 'taxRegime',
    group: 'Regime tributario',
    label: 'Regime tributario',
    message: 'Escolha MEI, Simples Nacional ou Regime Normal.',
  });
  addRequirement(requirements, ['1', '2', '3', '4'].includes(crt), {
    key: 'crt',
    group: 'Regime tributario',
    label: 'CRT',
    message: 'Informe o Codigo de Regime Tributario usado no XML.',
  });

  addRequirement(requirements, Boolean(String(settings?.streetName || '').trim()), {
    key: 'streetName',
    group: 'Endereco fiscal',
    label: 'Logradouro',
    message: 'Informe a rua/avenida do emitente.',
  });
  addRequirement(requirements, Boolean(String(settings?.streetNumber || '').trim()), {
    key: 'streetNumber',
    group: 'Endereco fiscal',
    label: 'Numero',
    message: 'Informe o numero do endereco fiscal.',
  });
  addRequirement(requirements, Boolean(String(settings?.district || '').trim()), {
    key: 'district',
    group: 'Endereco fiscal',
    label: 'Bairro',
    message: 'Informe o bairro do estabelecimento.',
  });
  addRequirement(requirements, Boolean(String(settings?.cityName || '').trim()), {
    key: 'cityName',
    group: 'Endereco fiscal',
    label: 'Municipio',
    message: 'Informe o municipio do emitente.',
  });
  addRequirement(requirements, cityCodeDigits.length === 7, {
    key: 'cityCode',
    group: 'Endereco fiscal',
    label: 'Codigo IBGE do municipio',
    message: 'Informe o codigo IBGE de 7 digitos. Goiania: 5208707.',
  });
  addRequirement(requirements, /^[A-Z]{2}$/.test(state), {
    key: 'state',
    group: 'Endereco fiscal',
    label: 'UF',
    message: 'Informe a UF com duas letras, como GO.',
  });
  addRequirement(requirements, zipDigits.length === 8, {
    key: 'zipCode',
    group: 'Endereco fiscal',
    label: 'CEP',
    message: 'Informe o CEP com 8 digitos.',
  });

  addRequirement(requirements, Boolean(String(settings?.serie || '').trim()), {
    key: 'serie',
    group: 'NFC-e',
    label: 'Serie NFC-e',
    message: 'Informe a serie de emissao da NFC-e.',
  });
  addRequirement(requirements, Number(settings?.nextNumber || 0) > 0, {
    key: 'nextNumber',
    group: 'NFC-e',
    label: 'Proxima numeracao',
    message: 'Informe o proximo numero de NFC-e.',
  });
  addRequirement(requirements, Boolean(String(settings?.cscId || '').trim()), {
    key: 'cscId',
    group: 'NFC-e',
    label: 'ID CSC',
    message: 'Informe o ID CSC fornecido pela SEFAZ.',
  });
  addRequirement(requirements, Boolean(settings?.csc), {
    key: 'csc',
    group: 'NFC-e',
    label: 'CSC',
    message: 'Informe o Codigo de Seguranca do Contribuinte.',
  });

  addRequirement(requirements, Boolean(certificatePath && settings?.certificatePassword), {
    key: 'certificate',
    group: 'Certificado',
    label: 'Certificado A1 e senha',
    message: 'Envie um certificado A1 valido pelo painel fiscal.',
  });
  if (certificatePath) {
    addRequirement(requirements, fs.existsSync(resolvedCertificatePath), {
      key: 'certificateFile',
      group: 'Certificado',
      label: 'Arquivo A1 no armazenamento privado',
      message: 'O arquivo do certificado nao foi encontrado no servidor.',
    });
  }
  if (settings?.certificateValidTo) {
    addRequirement(requirements, new Date(settings.certificateValidTo) > new Date(), {
      key: 'certificateValidity',
      group: 'Certificado',
      label: 'Validade do certificado A1',
      message: 'O certificado A1 esta expirado.',
    });
  }

  const missingRequirements = requirements.filter(item => item.status !== 'ok');
  const warnings = [];
  if (taxRegime === 'mei' && crt !== '4') {
    warnings.push('MEI normalmente deve usar CRT 4. Confirme com a contabilidade antes de emitir.');
  }
  if (mode === 'sefaz_go') {
    warnings.push('SEFAZ GO real ainda depende de credenciamento, schemas oficiais configurados e webservices de homologacao.');
  }

  return {
    ready: missingRequirements.length === 0,
    canIssue: missingRequirements.length === 0,
    mode,
    summary: missingRequirements.length === 0
      ? 'Cadastro fiscal completo para continuar a etapa tecnica de emissao.'
      : `Cadastro fiscal incompleto: ${missingRequirements.length} item(ns) pendente(s).`,
    missing: missingRequirements.map(item => item.label),
    warnings,
    requirements,
  };
};

module.exports = {
  defaultCrtForTaxRegime,
  getFiscalReadiness,
  normalizeCrt,
  onlyDigits,
};
