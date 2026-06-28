import { useEffect, useState, type FormEvent } from 'react';
import { Building2, CheckCircle2, Clipboard, Mail, PackageSearch, Phone, ReceiptText, Save, Timer, UserRound } from 'lucide-react';
import { getApiErrorMessage } from '../lib/api';
import { DEFAULT_UI_SETTINGS, useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore } from '../store/useAuthStore';
import type { TenantSettings } from '../types';
import './EstablishmentSettings.css';

const emptySettings: TenantSettings = {
  establishmentId: '',
  name: '',
  loginCode: '',
  ownerName: '',
  email: '',
  phone: '',
  ...DEFAULT_UI_SETTINGS,
};

export default function EstablishmentSettings() {
  const { settings, loading, fetchSettings, saveSettings } = useSettingsStore();
  const updateEstablishmentName = useAuthStore(state => state.updateEstablishmentName);
  const [form, setForm] = useState<TenantSettings>(emptySettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!settings) fetchSettings().catch(() => undefined);
  }, [settings, fetchSettings]);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const updateField = <K extends keyof TenantSettings>(field: K, value: TenantSettings[K]) => {
    setForm(current => ({ ...current, [field]: value }));
    setSuccess(false);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);
    try {
      const saved = await saveSettings(form);
      setForm(saved);
      updateEstablishmentName(saved.name);
      setSuccess(true);
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Nao foi possivel salvar as configuracoes.'));
    } finally {
      setSaving(false);
    }
  };

  const copyLoginCode = async () => {
    await navigator.clipboard.writeText(form.loginCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  if (loading && !settings) {
    return <div className="page-container settings-loading">Carregando configuracoes...</div>;
  }

  return (
    <div className="page-container establishment-settings-page">
      <div className="settings-page-header">
        <div>
          <h1>Configuracoes do Estabelecimento</h1>
          <p>Dados comerciais e preferencias usadas no estoque, PDV e comprovantes.</p>
        </div>
        <button className="btn btn-primary" type="submit" form="establishment-settings-form" disabled={saving}>
          <Save size={17} /> {saving ? 'Salvando...' : 'Salvar alteracoes'}
        </button>
      </div>

      {error && <div className="settings-message error">{error}</div>}
      {success && <div className="settings-message success"><CheckCircle2 size={17} /> Configuracoes atualizadas.</div>}

      <form id="establishment-settings-form" onSubmit={handleSubmit}>
        <section className="settings-section">
          <div className="settings-section-heading">
            <Building2 size={20} />
            <div><h2>Identidade comercial</h2><p>Informacoes exibidas dentro do sistema e nos comprovantes.</p></div>
          </div>
          <div className="settings-fields two-columns">
            <label className="settings-field">
              <span>Nome comercial</span>
              <div className="settings-input-icon"><Building2 size={16} /><input required value={form.name} onChange={e => updateField('name', e.target.value)} /></div>
            </label>
            <label className="settings-field">
              <span>Responsavel</span>
              <div className="settings-input-icon"><UserRound size={16} /><input value={form.ownerName || ''} onChange={e => updateField('ownerName', e.target.value)} /></div>
            </label>
            <label className="settings-field">
              <span>E-mail</span>
              <div className="settings-input-icon"><Mail size={16} /><input type="email" value={form.email || ''} onChange={e => updateField('email', e.target.value)} /></div>
            </label>
            <label className="settings-field">
              <span>Telefone</span>
              <div className="settings-input-icon"><Phone size={16} /><input value={form.phone || ''} onChange={e => updateField('phone', e.target.value)} /></div>
            </label>
            <div className="settings-field settings-field-wide">
              <span>Codigo de acesso</span>
              <div className="settings-copy-row">
                <code>{form.loginCode}</code>
                <button type="button" onClick={copyLoginCode} title="Copiar codigo" aria-label="Copiar codigo do estabelecimento">
                  {copied ? <CheckCircle2 size={17} /> : <Clipboard size={17} />}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <PackageSearch size={20} />
            <div><h2>Estoque</h2><p>Padrao unico para alertas, indicadores e destaque no PDV.</p></div>
          </div>
          <div className="settings-fields two-columns compact-grid">
            <label className="settings-field">
              <span>Alertar quando o estoque for igual ou menor que</span>
              <input type="number" min={0} max={9999} required value={form.lowStockThreshold}
                onChange={e => updateField('lowStockThreshold', Number(e.target.value))} />
            </label>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading">
            <ReceiptText size={20} />
            <div><h2>Comprovante na tela</h2><p>Comportamento do recibo exibido depois da venda.</p></div>
          </div>
          <div className="settings-fields two-columns">
            <label className="settings-field">
              <span>Fechamento automatico</span>
              <div className="settings-input-icon">
                <Timer size={16} />
                <select value={form.receiptAutoCloseSeconds} onChange={e => updateField('receiptAutoCloseSeconds', Number(e.target.value))}>
                  <option value={0}>Manual</option>
                  <option value={5}>5 segundos</option>
                  <option value={10}>10 segundos</option>
                  <option value={15}>15 segundos</option>
                  <option value={30}>30 segundos</option>
                </select>
              </div>
            </label>
            <label className="settings-field settings-field-wide">
              <span>Rodape do comprovante</span>
              <textarea maxLength={180} rows={3} value={form.receiptFooter || ''}
                onChange={e => updateField('receiptFooter', e.target.value)} placeholder="Ex: Obrigado pela preferencia." />
              <small>{(form.receiptFooter || '').length}/180</small>
            </label>
          </div>
        </section>
      </form>
    </div>
  );
}
