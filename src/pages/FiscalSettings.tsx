import { useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import type { FiscalDocument, FiscalSettings as FiscalSettingsType } from '../types';
import './FiscalSettings.css';

type FiscalResponse = {
  settings: FiscalSettingsType;
  readiness: { ready: boolean; missing: string[] };
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
  taxRegime: 'mei',
  cscId: '',
  hasCsc: false,
  certificatePath: '',
  hasCertificatePassword: false,
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

export default function FiscalSettings() {
  const [form, setForm] = useState(emptySettings);
  const [csc, setCsc] = useState('');
  const [certificatePassword, setCertificatePassword] = useState('');
  const [readiness, setReadiness] = useState<FiscalResponse['readiness']>({ ready: false, missing: [] });
  const [documents, setDocuments] = useState<FiscalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
      if (certificatePassword) payload.certificatePassword = certificatePassword;

      const updated = await apiRequest<FiscalResponse>('/fiscal/settings', {
        method: 'PUT',
        body: payload,
      });
      setForm(updated.settings);
      setReadiness(updated.readiness);
      setCsc('');
      setCertificatePassword('');
      alert('Configuracao fiscal salva.');
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao salvar configuracao fiscal.'));
    } finally {
      setSaving(false);
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

  const filteredDocuments = statusFilter === 'all'
    ? documents
    : documents.filter(doc => doc.status === statusFilter);

  const statusCounters = documents.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.status] = (acc[doc.status] || 0) + 1;
    return acc;
  }, {});

  const fiscalEnabled = Boolean(form.enabled);

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
              : readiness.missing.join(', ') || 'Revise as configuracoes.'}
          </span>
        </div>
      </div>

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
                <select className="form-control" value={form.taxRegime} onChange={e => update('taxRegime', e.target.value as FiscalSettingsType['taxRegime'])}>
                  <option value="mei">MEI</option>
                  <option value="simples">Simples Nacional</option>
                  <option value="normal">Regime normal</option>
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

            <div className="form-group">
              <label>Caminho do certificado A1 no servidor *</label>
              <input className="form-control" value={form.certificatePath} onChange={e => update('certificatePath', e.target.value)} placeholder="/var/www/sistema_distribuidora/certs/empresa.pfx" />
            </div>

            <div className="form-group">
              <label>Senha do certificado {form.hasCertificatePassword ? '(ja cadastrada)' : '*'}</label>
              <input className="form-control" type="password" value={certificatePassword} onChange={e => setCertificatePassword(e.target.value)} placeholder={form.hasCertificatePassword ? 'Preencha apenas para trocar' : 'Senha do arquivo .pfx'} />
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
