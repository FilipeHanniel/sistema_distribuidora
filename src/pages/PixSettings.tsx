import { useEffect, useState, type FormEvent } from 'react';
import { CreditCard, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import Modal from '../components/Modal';
import type { PixAccount, PixProvider } from '../types';
import './PixSettings.css';

type ProviderInfo = Record<string, { label: string; implemented: boolean; requires: string[] }>;

const providerLabels: Record<string, string> = {
  fake: 'Fake Provider',
  mercado_pago: 'Mercado Pago',
  asaas: 'Asaas',
  sicoob: 'Sicoob',
  itau: 'Itau',
  santander: 'Santander',
  bradesco: 'Bradesco',
};

const emptyForm = {
  name: '',
  provider: 'fake' as PixProvider,
  pixKey: '',
  accessToken: '',
  payerEmail: '',
  apiKey: '',
  isDefault: true,
};

export default function PixSettings() {
  const [accounts, setAccounts] = useState<PixAccount[]>([]);
  const [providers, setProviders] = useState<ProviderInfo>({});
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const loadData = async () => {
    setLoading(true);
    try {
      const [accountsData, providersData] = await Promise.all([
        apiRequest<PixAccount[]>('/pix/accounts'),
        apiRequest<ProviderInfo>('/pix/providers'),
      ]);
      setAccounts(accountsData);
      setProviders(providersData);
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao carregar contas Pix.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const buildCredentials = () => {
    if (form.provider === 'mercado_pago') return { accessToken: form.accessToken, payerEmail: form.payerEmail };
    if (form.provider === 'asaas') return { apiKey: form.apiKey };
    return {};
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/pix/accounts', {
        method: 'POST',
        body: {
          name: form.name,
          provider: form.provider,
          pixKey: form.pixKey,
          credentials: buildCredentials(),
          isDefault: form.isDefault,
        },
      });
      setIsOpen(false);
      setForm({ ...emptyForm });
      loadData();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao salvar conta Pix.'));
    }
  };

  const removeAccount = async (account: PixAccount) => {
    if (!confirm(`Remover a conta Pix "${account.name}"?`)) return;
    try {
      await apiRequest(`/pix/accounts/${account.id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao remover conta Pix.'));
    }
  };

  const provider = providers[form.provider];

  return (
    <div className="page-container pix-settings-page">
      <div className="pix-settings-header">
        <div>
          <h1><CreditCard size={24} /> Contas Pix</h1>
          <p>Configure as contas recebedoras usadas pelo PDV para gerar QR Code e confirmar pagamentos.</p>
        </div>
        <div className="pix-settings-actions">
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Atualizar</button>
          <button className="btn btn-primary" onClick={() => setIsOpen(true)}><Plus size={16} /> Nova Conta Pix</button>
        </div>
      </div>

      {loading ? (
        <div className="pix-empty">Carregando...</div>
      ) : accounts.length === 0 ? (
        <div className="pix-empty">
          <CreditCard size={38} />
          <p>Nenhuma conta Pix configurada.</p>
          <button className="btn btn-primary" onClick={() => setIsOpen(true)}><Plus size={16} /> Criar primeira conta</button>
        </div>
      ) : (
        <div className="pix-account-grid">
          {accounts.map(account => {
            const info = providers[account.provider];
            return (
              <div className="pix-account-card" key={account.id}>
                <div className="pix-account-top">
                  <div>
                    <h3>{account.name}</h3>
                    <span>{info?.label || providerLabels[account.provider] || account.provider}</span>
                  </div>
                  {account.isDefault ? <span className="pix-default"><CheckCircle2 size={13} /> Padrao</span> : null}
                </div>
                <div className="pix-account-meta">
                  <span>Chave Pix</span>
                  <strong>{account.pixKey || 'Gerenciada pelo provider'}</strong>
                </div>
                <div className="pix-account-status">
                  {info?.implemented ? (
                    <span className="ready"><CheckCircle2 size={14} /> Provider pronto</span>
                  ) : (
                    <span className="planned"><AlertTriangle size={14} /> Provider planejado</span>
                  )}
                  <span>{account.active ? 'Ativa' : 'Inativa'}</span>
                </div>
                <button className="btn btn-danger btn-sm" onClick={() => removeAccount(account)}><Trash2 size={14} /> Remover</button>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Nova Conta Pix">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Nome interno *</label>
            <input className="form-control" required value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Mercado Pago principal" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Provider *</label>
              <select className="form-control" value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value as PixProvider }))}>
                {Object.entries(providers).map(([key, info]) => (
                  <option key={key} value={key}>{info.label}{info.implemented ? '' : ' (em breve)'}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Chave Pix</label>
              <input className="form-control" value={form.pixKey} onChange={e => setForm(p => ({ ...p, pixKey: e.target.value }))} placeholder="CPF, CNPJ, e-mail, telefone ou aleatoria" />
            </div>
          </div>

          {form.provider === 'mercado_pago' && (
            <>
              <div className="form-group">
                <label>Access Token Mercado Pago *</label>
                <input className="form-control" required value={form.accessToken} onChange={e => setForm(p => ({ ...p, accessToken: e.target.value }))} placeholder="APP_USR-..." />
              </div>
              <div className="form-group">
                <label>E-mail do pagador padrao</label>
                <input className="form-control" type="email" value={form.payerEmail} onChange={e => setForm(p => ({ ...p, payerEmail: e.target.value }))} placeholder="cliente@example.com" />
              </div>
            </>
          )}

          {form.provider === 'asaas' && (
            <div className="form-group">
              <label>API Key Asaas</label>
              <input className="form-control" value={form.apiKey} onChange={e => setForm(p => ({ ...p, apiKey: e.target.value }))} placeholder="$aact_..." />
            </div>
          )}

          {!provider?.implemented && (
            <div className="pix-provider-note">
              Este provider ja pode ser cadastrado para planejamento, mas a cobranca automatica sera liberada quando o adaptador for implementado.
            </div>
          )}

          <label className="pix-checkbox">
            <input type="checkbox" checked={form.isDefault} onChange={e => setForm(p => ({ ...p, isDefault: e.target.checked }))} />
            Usar como conta padrao do PDV
          </label>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setIsOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Salvar Conta</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
