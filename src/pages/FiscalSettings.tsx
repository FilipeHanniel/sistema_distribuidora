import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileKey2, FileText, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import type { FiscalDocument, FiscalSettings as FiscalSettingsType } from '../types';
import './FiscalSettings.css';

type FiscalResponse = {
  settings: FiscalSettingsType;
  readiness: FiscalReadiness;
};

type FiscalReadinessRequirement = {
  key: string;
  group: string;
  label: string;
  message: string;
  status: 'ok' | 'missing';
};

type FiscalReadiness = {
  ready: boolean;
  canIssue?: boolean;
  mode?: 'internal_control' | 'simulated' | 'sefaz_go';
  summary?: string;
  missing: string[];
  warnings?: string[];
  requirements?: FiscalReadinessRequirement[];
};

const emptySettings: FiscalSettingsType = {
  establishmentId: '',
  enabled: 0,
  providerMode: 'simulated',
  environment: 'homologation',
  documentModel: '65',
  serie: '1',
  nextNumber: 1,
  cnpj: '',
  stateRegistration: '',
  legalName: '',
  tradeName: '',
  taxRegime: 'simples',
  crt: '1',
  streetName: '',
  streetNumber: '',
  district: '',
  cityName: 'Goiania',
  cityCode: '5208707',
  state: 'GO',
  zipCode: '',
  complement: '',
  cscId: '',
  hasCsc: false,
  hasCertificatePassword: false,
  certificate: {
    configured: false,
    managed: false,
    fileName: '',
    fingerprint: '',
    subject: '',
    issuer: '',
    serialNumber: '',
    validFrom: null,
    validTo: null,
    uploadedAt: null,
    expired: false,
  },
  autoIssueOnPayment: 0,
  autoPrintOnAuthorization: 0,
};

const statusLabels: Record<string, string> = {
  pending_configuration: 'Configuracao pendente',
  pending_authorization: 'Aguardando autorizacao',
  authorized: 'Autorizada',
  rejected: 'Rejeitada',
  cancelled: 'Cancelada',
};

const formatAccessKey = (key?: string) => key ? key.replace(/(.{4})/g, '$1 ').trim() : '';

type FiscalValidationMessage = {
  code: string;
  message: string;
};

function parseValidationMessages(value?: string): FiscalValidationMessage[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const result = String(reader.result || '');
    resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
  };
  reader.onerror = () => reject(new Error('Nao foi possivel ler o certificado selecionado.'));
  reader.readAsDataURL(file);
});

const formatCertificateDate = (value?: string | null) => (
  value ? new Date(value).toLocaleString('pt-BR') : 'Nao informado'
);

const defaultCrtForTaxRegime = (taxRegime: FiscalSettingsType['taxRegime']): FiscalSettingsType['crt'] => {
  if (taxRegime === 'normal') return '3';
  if (taxRegime === 'mei') return '4';
  return '1';
};

export default function FiscalSettings() {
  const [form, setForm] = useState(emptySettings);
  const [csc, setCsc] = useState('');
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateInputKey, setCertificateInputKey] = useState(0);
  const [certificatePassword, setCertificatePassword] = useState('');
  const [readiness, setReadiness] = useState<FiscalResponse['readiness']>({ ready: false, missing: [] });
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCertificate, setUploadingCertificate] = useState(false);
  const [removingCertificate, setRemovingCertificate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | FiscalDocument['status']>('all');

  const loadData = async () => {
    setLoading(true);
    try {
      const [settingsData, documentsData] = await Promise.all([
        apiRequest<FiscalResponse>('/fiscal/settings'),
        apiRequest<FiscalDocument[]>('/fiscal/documents'),
      ]);
      setForm(settingsData.settings);
      setReadiness(settingsData.readiness);
      setDocuments(documentsData);
      setCsc('');
      setCertificateFile(null);
      setCertificateInputKey(value => value + 1);
      setCertificatePassword('');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao carregar modulo fiscal.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        enabled: Boolean(form.enabled),
        autoIssueOnPayment: Boolean(form.autoIssueOnPayment),
        autoPrintOnAuthorization: Boolean(form.autoPrintOnAuthorization),
      };
      if (csc) payload.csc = csc;
      const updated = await apiRequest<FiscalResponse>('/fiscal/settings', {
        method: 'PUT',
        body: payload,
      });
      setForm(updated.settings);
      setReadiness(updated.readiness);
      setCsc('');
      alert('Configuracao fiscal salva.');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao salvar configuracao fiscal.'));
    } finally {
      setSaving(false);
    }
  };

  const uploadCertificate = async () => {
    if (!certificateFile) {
      alert('Selecione um arquivo .pfx ou .p12.');
      return;
    }
    if (!certificatePassword) {
      alert('Informe a senha do certificado.');
      return;
    }
    if (certificateFile.size > 512 * 1024) {
      alert('O certificado excede o limite de 512 KB.');
      return;
    }

    setUploadingCertificate(true);
    try {
      const certificateBase64 = await readFileAsBase64(certificateFile);
      const updated = await apiRequest<FiscalResponse>('/fiscal/certificate', {
        method: 'POST',
        body: {
          fileName: certificateFile.name,
          certificateBase64,
          password: certificatePassword,
        },
      });
      setForm(updated.settings);
      setReadiness(updated.readiness);
      setCertificateFile(null);
      setCertificateInputKey(value => value + 1);
      setCertificatePassword('');
      alert('Certificado A1 validado e armazenado com seguranca.');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao enviar certificado A1.'));
    } finally {
      setUploadingCertificate(false);
    }
  };

  const removeCertificate = async () => {
    if (!confirm('Remover o certificado A1 deste estabelecimento? A emissao fiscal ficara indisponivel ate um novo envio.')) return;
    setRemovingCertificate(true);
    try {
      const updated = await apiRequest<FiscalResponse>('/fiscal/certificate', { method: 'DELETE' });
      setForm(updated.settings);
      setReadiness(updated.readiness);
      setCertificateFile(null);
      setCertificateInputKey(value => value + 1);
      setCertificatePassword('');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao remover certificado A1.'));
    } finally {
      setRemovingCertificate(false);
    }
  };

  const issueDocument = async (document: FiscalDocument) => {
    try {
      await apiRequest(`/fiscal/documents/${document.id}/issue`, { method: 'POST' });
      await loadData();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao emitir documento fiscal simulado.'));
    }
  };

  const update = <K extends keyof FiscalSettingsType>(key: K, value: FiscalSettingsType[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const updateTaxRegime = (taxRegime: FiscalSettingsType['taxRegime']) => {
    setForm(prev => ({ ...prev, taxRegime, crt: defaultCrtForTaxRegime(taxRegime) }));
  };

  const filteredDocuments = statusFilter === 'all'
    ? documents
    : documents.filter(doc => doc.status === statusFilter);

  const statusCounters = documents.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.status] = (acc[doc.status] || 0) + 1;
    return acc;
  }, {});

  const fiscalEnabled = readiness.mode
    ? readiness.mode !== 'internal_control'
    : Boolean(form.enabled);
  const readinessGroups = (readiness.requirements || []).reduce<Record<string, FiscalReadinessRequirement[]>>((acc, item) => {
    acc[item.group] = [...(acc[item.group] || []), item];
    return acc;
  }, {});

  return (
    <div className="page-container fiscal-page">
      <div className="fiscal-header">
        <div>
          <h1><FileText size={24} /> Fiscal NFC-e</h1>
          <p>Prepare a emissao automatica de NFC-e modelo 65 para vendas com pagamento integrado.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Atualizar</button>
      </div>

      <div className={`fiscal-status ${!fiscalEnabled ? 'disabled' : readiness.ready ? 'ready' : 'pending'}`}>
        {!fiscalEnabled ? <FileText size={18} /> : readiness.ready ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        <div>
          <strong>
            {!fiscalEnabled
              ? 'Modulo fiscal desativado para este estabelecimento'
              : readiness.ready ? 'Cadastro pronto para a proxima etapa tecnica' : 'Ainda faltam dados fiscais'}
          </strong>
          <span>
            {!fiscalEnabled
              ? 'O sistema seguira funcionando apenas com estoque, vendas e comprovantes internos.'
              : readiness.ready
              ? 'Agora falta ligar o motor de XML assinado e autorizacao SEFAZ.'
              : readiness.summary || readiness.missing.join(', ') || 'Revise as configuracoes.'}
          </span>
        </div>
      </div>

      {fiscalEnabled && (
        <div className="fiscal-readiness-grid">
          {Object.entries(readinessGroups).map(([group, items]) => {
            const groupReady = items.every(item => item.status === 'ok');
            return (
              <div className={`fiscal-readiness-card ${groupReady ? 'ready' : 'pending'}`} key={group}>
                <div className="fiscal-readiness-title">
                  {groupReady ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                  <strong>{group}</strong>
                </div>
                {items.map(item => (
                  <div className={`fiscal-readiness-item ${item.status}`} key={item.key}>
                    <span>{item.label}</span>
                    <small>{item.status === 'ok' ? 'OK' : item.message}</small>
                  </div>
                ))}
              </div>
            );
          })}
          {readiness.warnings?.map(warning => (
            <div className="fiscal-readiness-warning" key={warning}>
              <AlertTriangle size={16} />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="fiscal-empty">Carregando...</div>
      ) : (
        <div className="fiscal-grid">
          <form className="fiscal-panel" onSubmit={handleSubmit}>
            <div className="fiscal-section-title">
              <ShieldCheck size={18} />
              <span>Dados do emitente</span>
            </div>

            <label className="fiscal-toggle">
              <input type="checkbox" checked={Boolean(form.enabled)} onChange={e => update('enabled', e.target.checked ? 1 : 0)} />
              Ativar modulo fiscal neste estabelecimento
            </label>

            <div className="form-row">
              <div className="form-group">
                <label>Modo fiscal</label>
                <select className="form-control" value={form.providerMode} onChange={e => update('providerMode', e.target.value as FiscalSettingsType['providerMode'])}>
                  <option value="simulated">Simulado interno</option>
                  <option value="sefaz_go">SEFAZ GO real</option>
                </select>
              </div>
              <div className="form-group">
                <label>Ambiente</label>
                <select className="form-control" value={form.environment} onChange={e => update('environment', e.target.value as FiscalSettingsType['environment'])}>
                  <option value="homologation">Homologacao</option>
                  <option value="production">Producao</option>
                </select>
              </div>
              <div className="form-group">
                <label>Regime tributario</label>
                <select className="form-control" value={form.taxRegime} onChange={e => updateTaxRegime(e.target.value as FiscalSettingsType['taxRegime'])}>
                  <option value="mei">MEI</option>
                  <option value="simples">Simples Nacional</option>
                  <option value="normal">Regime normal</option>
                </select>
              </div>
              <div className="form-group">
                <label>CRT</label>
                <select className="form-control" value={form.crt} onChange={e => update('crt', e.target.value as FiscalSettingsType['crt'])}>
                  <option value="1">1 - Simples Nacional</option>
                  <option value="2">2 - Simples excesso sublimite</option>
                  <option value="3">3 - Regime normal</option>
                  <option value="4">4 - MEI</option>
                </select>
              </div>
            </div>

            <div className="fiscal-note">
              No modo simulado, o backend valida os cadastros e autoriza/rejeita localmente. No modo SEFAZ GO real, a estrutura fica pronta, mas o envio oficial ainda depende do motor de XML assinado e webservices.
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>CNPJ *</label>
                <input className="form-control" value={form.cnpj} onChange={e => update('cnpj', e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="form-group">
                <label>Inscricao estadual *</label>
                <input className="form-control" value={form.stateRegistration} onChange={e => update('stateRegistration', e.target.value)} />
              </div>
            </div>

            <div className="form-group">
              <label>Razao social *</label>
              <input className="form-control" value={form.legalName} onChange={e => update('legalName', e.target.value)} />
            </div>

            <div className="form-group">
              <label>Nome fantasia</label>
              <input className="form-control" value={form.tradeName} onChange={e => update('tradeName', e.target.value)} />
            </div>

            <div className="fiscal-section-title">
              <ShieldCheck size={18} />
              <span>Endereco fiscal do emitente</span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Logradouro *</label>
                <input className="form-control" value={form.streetName} onChange={e => update('streetName', e.target.value)} placeholder="Rua, avenida, rodovia..." />
              </div>
              <div className="form-group">
                <label>Numero *</label>
                <input className="form-control" value={form.streetNumber} onChange={e => update('streetNumber', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Bairro *</label>
                <input className="form-control" value={form.district} onChange={e => update('district', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Complemento</label>
                <input className="form-control" value={form.complement} onChange={e => update('complement', e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Municipio *</label>
                <input className="form-control" value={form.cityName} onChange={e => update('cityName', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Codigo IBGE *</label>
                <input className="form-control" inputMode="numeric" value={form.cityCode} onChange={e => update('cityCode', e.target.value)} placeholder="Goiania: 5208707" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>UF *</label>
                <input className="form-control" maxLength={2} value={form.state} onChange={e => update('state', e.target.value.toUpperCase())} placeholder="GO" />
              </div>
              <div className="form-group">
                <label>CEP *</label>
                <input className="form-control" inputMode="numeric" value={form.zipCode} onChange={e => update('zipCode', e.target.value)} placeholder="00000000" />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Serie NFC-e</label>
                <input className="form-control" value={form.serie} onChange={e => update('serie', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Proximo numero</label>
                <input className="form-control" type="number" min="1" value={form.nextNumber} onChange={e => update('nextNumber', Number(e.target.value))} />
              </div>
            </div>

            <div className="fiscal-section-title">
              <ShieldCheck size={18} />
              <span>Credenciais SEFAZ/GO</span>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>ID CSC *</label>
                <input className="form-control" value={form.cscId} onChange={e => update('cscId', e.target.value)} placeholder="Ex: 1" />
              </div>
              <div className="form-group">
                <label>CSC {form.hasCsc ? '(ja cadastrado)' : '*'}</label>
                <input className="form-control" type="password" value={csc} onChange={e => setCsc(e.target.value)} placeholder={form.hasCsc ? 'Preencha apenas para trocar' : 'Codigo de seguranca'} />
              </div>
            </div>

            <div className={`fiscal-certificate ${form.certificate.configured ? 'configured' : ''}`}>
              <div className="fiscal-certificate-heading">
                <div>
                  <FileKey2 size={18} />
                  <div>
                    <strong>Certificado digital A1</strong>
                    <span>
                      {form.certificate.configured
                        ? form.certificate.fileName
                        : 'Nenhum certificado cadastrado'}
                    </span>
                  </div>
                </div>
                {form.certificate.configured && (
                  <button type="button" className="btn btn-danger btn-sm" disabled={removingCertificate} onClick={removeCertificate}>
                    <Trash2 size={14} /> {removingCertificate ? 'Removendo...' : 'Remover'}
                  </button>
                )}
              </div>

              {form.certificate.configured && (
                <div className="fiscal-certificate-details">
                  <span>Valido de <strong>{formatCertificateDate(form.certificate.validFrom)}</strong></span>
                  <span>Valido ate <strong>{formatCertificateDate(form.certificate.validTo)}</strong></span>
                  {form.certificate.subject && <span>Emitido para <strong>{form.certificate.subject}</strong></span>}
                  {form.certificate.fingerprint && <span>Identificador <strong>{form.certificate.fingerprint.slice(0, 16)}...</strong></span>}
                  {!form.certificate.managed && <span className="legacy">Certificado legado: envie novamente para migrar ao armazenamento seguro.</span>}
                </div>
              )}

              <div className="fiscal-certificate-upload">
                <div className="form-group">
                  <label>{form.certificate.configured ? 'Substituir arquivo A1' : 'Arquivo A1 *'}</label>
                  <input
                    key={certificateInputKey}
                    className="form-control"
                    type="file"
                    accept=".pfx,.p12,application/x-pkcs12"
                    onChange={e => setCertificateFile(e.target.files?.[0] || null)}
                  />
                </div>
                <div className="form-group">
                  <label>Senha do arquivo *</label>
                  <input
                    className="form-control"
                    type="password"
                    value={certificatePassword}
                    onChange={e => setCertificatePassword(e.target.value)}
                    placeholder="Senha do arquivo .pfx ou .p12"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={uploadingCertificate || !certificateFile || !certificatePassword}
                  onClick={uploadCertificate}
                >
                  <Upload size={15} /> {uploadingCertificate ? 'Validando...' : form.certificate.configured ? 'Validar e substituir' : 'Validar e enviar'}
                </button>
                <small>Em producao, o arquivo e a senha sao enviados ao backend por HTTPS. Limite: 512 KB.</small>
              </div>
            </div>

            <label className="fiscal-toggle">
              <input type="checkbox" checked={Boolean(form.autoIssueOnPayment)} onChange={e => update('autoIssueOnPayment', e.target.checked ? 1 : 0)} />
              Emitir automaticamente apos pagamento confirmado
            </label>
            <label className="fiscal-toggle">
              <input type="checkbox" checked={Boolean(form.autoPrintOnAuthorization)} onChange={e => update('autoPrintOnAuthorization', e.target.checked ? 1 : 0)} />
              Imprimir automaticamente apos autorizacao
            </label>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar Fiscal'}</button>
            </div>
          </form>

          <div className="fiscal-panel">
            <div className="fiscal-section-title">
              <FileText size={18} />
              <span>Fila fiscal</span>
            </div>

            <div className="fiscal-queue-tabs">
              {[
                ['all', 'Todos', documents.length],
                ['pending_configuration', 'Pendentes', statusCounters.pending_configuration || 0],
                ['pending_authorization', 'Autorizar', statusCounters.pending_authorization || 0],
                ['rejected', 'Rejeitados', statusCounters.rejected || 0],
                ['authorized', 'Autorizados', statusCounters.authorized || 0],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className={statusFilter === key ? 'active' : ''}
                  onClick={() => setStatusFilter(key as typeof statusFilter)}
                >
                  <span>{label}</span>
                  <strong>{count}</strong>
                </button>
              ))}
            </div>

            {!fiscalEnabled ? (
              <div className="fiscal-empty compact">A fila fiscal fica disponivel quando o modulo fiscal estiver ativo.</div>
            ) : filteredDocuments.length === 0 ? (
              <div className="fiscal-empty compact">Nenhum documento neste filtro.</div>
            ) : (
              <div className="fiscal-doc-list">
                {filteredDocuments.map(doc => {
                  const messages = parseValidationMessages(doc.validationMessages);
                  return (
                    <div className={`fiscal-doc-item ${doc.status}`} key={doc.id}>
                      <div>
                        <strong>Venda {doc.saleId.slice(0, 8)}</strong>
                        <span>{statusLabels[doc.status] || doc.status}</span>
                      </div>
                      <div>
                        <strong>{Number(doc.totalAmount || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                        <span>{new Date(doc.saleCreatedAt || doc.createdAt).toLocaleString('pt-BR')}</span>
                      </div>
                      {doc.error && <small>{doc.error}</small>}
                      {(doc.cStat || doc.accessKey || doc.protocol) && (
                        <div className="fiscal-return-box">
                          {doc.cStat && <span>cStat: <strong>{doc.cStat}</strong></span>}
                          {doc.protocol && <span>Protocolo: <strong>{doc.protocol}</strong></span>}
                          {doc.accessKey && <span>Chave: <strong>{formatAccessKey(doc.accessKey)}</strong></span>}
                        </div>
                      )}
                      {messages.length > 0 && (
                        <div className="fiscal-validation-list">
                          <strong>Corrija antes de emitir:</strong>
                          {messages.map((msg, index) => (
                            <span key={`${msg.code}-${index}`}>{msg.code}: {msg.message}</span>
                          ))}
                        </div>
                      )}
                      {doc.status !== 'authorized' && (
                        <button className="btn btn-secondary btn-sm" onClick={() => issueDocument(doc)}>
                          Emitir simulado
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
