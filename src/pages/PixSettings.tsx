import { useEffect, useState, type FormEvent } from 'react';
import { CreditCard, Plus, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Pencil, Building2, MonitorSmartphone } from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import Modal from '../components/Modal';
import type { PixAccount, PixProvider, PointSetupResponse } from '../types';
import './PixSettings.css';

type ProviderInfo = Record<string, { label: string; implemented: boolean; requires: string[]; supportsPix?: boolean; supportsPoint?: boolean }>;

const providerLabels: Record<string, string> = {
  fake: 'Fake Provider',
  mercado_pago_fake: 'Mercado Pago Fake',
  mercado_pago: 'Mercado Pago',
  asaas: 'Asaas',
  sicoob: 'Sicoob',
  itau: 'Itau',
  santander: 'Santander',
  bradesco: 'Bradesco',
};

const brazilianStates = [
  'Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal',
  'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul',
  'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí',
  'Rio Grande do Norte', 'Rio Grande do Sul', 'Rio de Janeiro', 'Rondônia',
  'Roraima', 'Santa Catarina', 'Sergipe', 'São Paulo', 'Tocantins',
];

const pointMccOptions = [
  { value: '5411', label: '5411 - Mercados e supermercados' },
  { value: '5499', label: '5499 - Outros comercios de alimentos' },
  { value: '5921', label: '5921 - Bebidas e adegas' },
  { value: '5399', label: '5399 - Comercio geral e variedades' },
  { value: '5999', label: '5999 - Outros comercios varejistas' },
  { value: '5812', label: '5812 - Restaurantes' },
  { value: '5814', label: '5814 - Lanchonetes e fast-food' },
];

const emptyPointForm = {
  userId: '',
  storeName: 'Loja principal',
  storeExternalId: '',
  streetName: '',
  streetNumber: '',
  cityName: 'Goiania',
  stateName: 'Goiás',
  latitude: '-16.6869',
  longitude: '-49.2648',
  reference: '',
  posName: 'Caixa principal',
  posExternalId: '',
  category: '5411',
};

const emptyForm = {
  name: '',
  provider: 'fake' as PixProvider,
  pixKey: '',
  accessToken: '',
  mpEnvironment: 'test',
  payerEmail: '',
  statementDescriptor: 'DISTRIBUIDORA',
  payerFirstName: '',
  payerLastName: '',
  payerIdentificationType: 'CPF',
  payerIdentificationNumber: '',
  payerPhoneAreaCode: '',
  payerPhoneNumber: '',
  payerZipCode: '',
  payerStreetName: '',
  payerStreetNumber: '',
  payerCity: '',
  payerState: '',
  payerNeighborhood: '',
  payerComplement: '',
  supportsPix: true,
  supportsPoint: false,
  terminalId: '',
  storeId: '',
  posId: '',
  defaultType: 'credit_card',
  defaultInstallments: '1',
  apiKey: '',
  active: true,
  isDefault: true,
};

export default function PixSettings() {
  const [accounts, setAccounts] = useState<PixAccount[]>([]);
  const [providers, setProviders] = useState<ProviderInfo>({});
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<PixAccount | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [pointOpen, setPointOpen] = useState(false);
  const [pointAccount, setPointAccount] = useState<PixAccount | null>(null);
  const [pointSetup, setPointSetup] = useState<PointSetupResponse | null>(null);
  const [pointForm, setPointForm] = useState({ ...emptyPointForm });
  const [pointLoading, setPointLoading] = useState(false);
  const [pointAction, setPointAction] = useState('');
  const [pointError, setPointError] = useState('');

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
      alert(getApiErrorMessage(err, 'Erro ao carregar contas de recebimento.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const syncPointResponse = (response: PointSetupResponse) => {
    setPointSetup(response);
    setPointAccount(response.account);
    setAccounts(current => current.map(account => account.id === response.account.id ? response.account : account));
  };

  const openPointSetup = async (account: PixAccount) => {
    setPointAccount(account);
    setPointSetup(null);
    setPointError('');
    setPointForm({
      ...emptyPointForm,
      userId: account.mpUserId || '',
      storeName: account.name || emptyPointForm.storeName,
      streetName: account.payerStreetName || '',
      streetNumber: account.payerStreetNumber || '',
      cityName: account.payerCity || emptyPointForm.cityName,
    });
    setPointOpen(true);
    setPointLoading(true);
    try {
      syncPointResponse(await apiRequest<PointSetupResponse>(`/pix/accounts/${account.id}/point/setup`));
    } catch (err) {
      setPointError(getApiErrorMessage(err, 'Erro ao consultar configuracao Point.'));
    } finally {
      setPointLoading(false);
    }
  };

  const createPointStorePos = async (e: FormEvent) => {
    e.preventDefault();
    if (!pointAccount) return;
    setPointAction('store-pos');
    setPointError('');
    try {
      const response = await apiRequest<PointSetupResponse>(`/pix/accounts/${pointAccount.id}/point/store-pos`, {
        method: 'POST',
        body: {
          userId: pointForm.userId,
          store: {
            name: pointForm.storeName,
            externalId: pointForm.storeExternalId,
            streetName: pointForm.streetName,
            streetNumber: pointForm.streetNumber,
            cityName: pointForm.cityName,
            stateName: pointForm.stateName,
            latitude: pointForm.latitude,
            longitude: pointForm.longitude,
            reference: pointForm.reference,
          },
          pos: {
            name: pointForm.posName,
            externalId: pointForm.posExternalId,
            category: pointForm.category,
          },
        },
      });
      syncPointResponse(response);
    } catch (err) {
      setPointError(getApiErrorMessage(err, 'Erro ao criar loja e caixa no Mercado Pago.'));
    } finally {
      setPointAction('');
    }
  };

  const refreshPointTerminals = async () => {
    if (!pointAccount) return;
    setPointAction('terminals');
    setPointError('');
    try {
      syncPointResponse(await apiRequest<PointSetupResponse>(`/pix/accounts/${pointAccount.id}/point/terminals`));
    } catch (err) {
      setPointError(getApiErrorMessage(err, 'Erro ao buscar terminais vinculados.'));
    } finally {
      setPointAction('');
    }
  };

  const activatePoint = async (terminalId: string) => {
    if (!pointAccount) return;
    setPointAction(terminalId);
    setPointError('');
    try {
      syncPointResponse(await apiRequest<PointSetupResponse>(
        `/pix/accounts/${pointAccount.id}/point/terminals/${encodeURIComponent(terminalId)}/activate`,
        { method: 'POST' }
      ));
    } catch (err) {
      setPointError(getApiErrorMessage(err, 'Erro ao ativar o modo PDV.'));
    } finally {
      setPointAction('');
    }
  };

  const buildCredentials = () => {
    const capabilities = {
      supportsPix: form.supportsPix,
      supportsPoint: form.supportsPoint,
    };
    if (form.provider === 'mercado_pago') {
      const credentials: Record<string, string | boolean> = {
        ...capabilities,
        mpEnvironment: form.mpEnvironment,
        payerEmail: form.payerEmail.trim(),
        statementDescriptor: form.statementDescriptor.trim(),
        payerFirstName: form.payerFirstName.trim(),
        payerLastName: form.payerLastName.trim(),
        payerIdentificationType: form.payerIdentificationType.trim(),
        payerIdentificationNumber: form.payerIdentificationNumber.trim(),
        payerPhoneAreaCode: form.payerPhoneAreaCode.trim(),
        payerPhoneNumber: form.payerPhoneNumber.trim(),
        payerZipCode: form.payerZipCode.trim(),
        payerStreetName: form.payerStreetName.trim(),
        payerStreetNumber: form.payerStreetNumber.trim(),
        payerCity: form.payerCity.trim(),
        payerState: form.payerState.trim(),
        payerNeighborhood: form.payerNeighborhood.trim(),
        payerComplement: form.payerComplement.trim(),
        terminalId: form.terminalId.trim(),
        storeId: form.storeId.trim(),
        posId: form.posId.trim(),
        defaultType: form.defaultType,
        defaultInstallments: form.defaultInstallments,
      };
      if (form.accessToken.trim()) credentials.accessToken = form.accessToken.trim();
      return credentials;
    }
    if (form.provider === 'asaas') return { apiKey: form.apiKey };
    return capabilities;
  };

  const openCreate = () => {
    setEditingAccount(null);
    setForm({ ...emptyForm });
    setIsOpen(true);
  };

  const openEdit = (account: PixAccount) => {
    setEditingAccount(account);
    setForm({
      ...emptyForm,
      name: account.name,
      provider: account.provider,
      pixKey: account.pixKey || '',
      mpEnvironment: account.mpEnvironment || 'test',
      payerEmail: account.payerEmail || '',
      statementDescriptor: account.statementDescriptor || 'DISTRIBUIDORA',
      payerFirstName: account.payerFirstName || '',
      payerLastName: account.payerLastName || '',
      payerIdentificationType: account.payerIdentificationType || 'CPF',
      payerIdentificationNumber: account.payerIdentificationNumber || '',
      payerPhoneAreaCode: account.payerPhoneAreaCode || '',
      payerPhoneNumber: account.payerPhoneNumber || '',
      payerZipCode: account.payerZipCode || '',
      payerStreetName: account.payerStreetName || '',
      payerStreetNumber: account.payerStreetNumber || '',
      payerCity: account.payerCity || '',
      payerState: account.payerState || '',
      payerNeighborhood: account.payerNeighborhood || '',
      payerComplement: account.payerComplement || '',
      supportsPix: account.supportsPix !== false,
      supportsPoint: Boolean(account.supportsPoint),
      terminalId: account.terminalId || '',
      storeId: account.storeId || '',
      posId: account.posId || '',
      defaultType: account.defaultType || 'credit_card',
      defaultInstallments: String(account.defaultInstallments || 1),
      active: Boolean(account.active),
      isDefault: Boolean(account.isDefault),
    });
    setIsOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (form.provider === 'mercado_pago' && !editingAccount && !form.accessToken.trim()) {
        alert('Informe o Access Token do Mercado Pago.');
        return;
      }
      await apiRequest(editingAccount ? `/pix/accounts/${editingAccount.id}` : '/pix/accounts', {
        method: editingAccount ? 'PUT' : 'POST',
        body: {
          name: form.name,
          provider: form.provider,
          pixKey: form.pixKey,
          credentials: buildCredentials(),
          active: form.active,
          isDefault: form.isDefault,
        },
      });
      setIsOpen(false);
      setEditingAccount(null);
      setForm({ ...emptyForm });
      loadData();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao salvar conta de recebimento.'));
    }
  };

  const removeAccount = async (account: PixAccount) => {
    if (!confirm(`Remover ou desativar a conta "${account.name}"?`)) return;
    try {
      await apiRequest(`/pix/accounts/${account.id}`, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert(getApiErrorMessage(err, 'Erro ao remover conta de recebimento.'));
    }
  };

  const provider = providers[form.provider];
  const visibleAccounts = showInactive ? accounts : accounts.filter(account => account.active);
  const inactiveCount = accounts.filter(account => !account.active).length;
  const pointConfigured = Boolean(pointSetup?.account.storeId && pointSetup?.account.posId);

  return (
    <div className="page-container pix-settings-page">
      <div className="pix-settings-header">
        <div>
          <h1><CreditCard size={24} /> Recebimentos</h1>
          <p>Configure contas recebedoras usadas pelo PDV para Pix online e terminais de cartao.</p>
        </div>
        <div className="pix-settings-actions">
          {inactiveCount > 0 && (
            <button className="btn btn-secondary" onClick={() => setShowInactive(v => !v)}>
              {showInactive ? 'Ocultar inativas' : `Ver inativas (${inactiveCount})`}
            </button>
          )}
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Atualizar</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nova Conta</button>
        </div>
      </div>

      {loading ? (
        <div className="pix-empty">Carregando...</div>
      ) : accounts.length === 0 ? (
        <div className="pix-empty">
          <CreditCard size={38} />
          <p>Nenhuma conta de recebimento configurada.</p>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Criar primeira conta</button>
        </div>
      ) : visibleAccounts.length === 0 ? (
        <div className="pix-empty">
          <CreditCard size={38} />
          <p>Nenhuma conta ativa. Use o botão de inativas para consultar o histórico.</p>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Nova conta ativa</button>
        </div>
      ) : (
        <div className="pix-account-grid">
          {visibleAccounts.map(account => {
            const info = providers[account.provider];
            return (
              <div className={`pix-account-card ${account.active ? '' : 'inactive'}`} key={account.id}>
                <div className="pix-account-top">
                  <div>
                    <h3>{account.name}</h3>
                    <span>{info?.label || providerLabels[account.provider] || account.provider}</span>
                  </div>
                  {account.isDefault ? <span className="pix-default"><CheckCircle2 size={13} /> Padrao</span> : null}
                </div>
                <div className="pix-account-meta">
                  <span>Recursos</span>
                  <strong>
                    {[
                      account.supportsPix !== false ? 'Pix' : null,
                      account.supportsPoint ? `Point${account.terminalId ? ` (${account.terminalId})` : ''}` : null,
                    ].filter(Boolean).join(' + ') || 'Sem recurso ativo'}
                  </strong>
                  {account.pixKey ? <small>Chave Pix: {account.pixKey}</small> : null}
                </div>
                <div className="pix-account-status">
                  {info?.implemented ? (
                    <span className="ready"><CheckCircle2 size={14} /> Provider pronto</span>
                  ) : (
                    <span className="planned"><AlertTriangle size={14} /> Provider planejado</span>
                  )}
                  <span>{account.active ? 'Ativa' : 'Inativa'}</span>
                </div>
                {account.provider === 'mercado_pago' && account.supportsPoint ? (
                  <div className={`point-readiness ${account.terminalId ? 'ready' : ''}`}>
                    <MonitorSmartphone size={15} />
                    {account.terminalId
                      ? 'Point pronto para vendas'
                      : account.storeId && account.posId
                        ? 'Aguardando associacao da maquininha'
                        : 'Loja e caixa ainda nao configurados'}
                  </div>
                ) : null}
                <div className="pix-account-actions">
                  {account.provider === 'mercado_pago' && account.supportsPoint && account.active ? (
                    <button className="btn btn-primary btn-sm" onClick={() => openPointSetup(account)}>
                      <Building2 size={14} /> Configurar Point
                    </button>
                  ) : null}
                  <button className="btn btn-secondary btn-sm" onClick={() => openEdit(account)}><Pencil size={14} /> Editar</button>
                  <button className="btn btn-danger btn-sm" onClick={() => removeAccount(account)}><Trash2 size={14} /> Remover</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={editingAccount ? 'Editar conta de recebimento' : 'Nova conta de recebimento'}>
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

          {['fake', 'mercado_pago_fake', 'mercado_pago'].includes(form.provider) && (
            <div className="pix-capability-row">
              <label className="pix-checkbox compact">
                <input type="checkbox" checked={form.supportsPix} onChange={e => setForm(p => ({ ...p, supportsPix: e.target.checked }))} />
                Usar para Pix online
              </label>
              <label className="pix-checkbox compact">
                <input type="checkbox" checked={form.supportsPoint} onChange={e => setForm(p => ({ ...p, supportsPoint: e.target.checked }))} />
                Usar terminal/cartao
              </label>
            </div>
          )}

          {form.provider === 'mercado_pago' && (
            <>
              <div className="form-group">
                <label>{editingAccount ? 'Novo Access Token Mercado Pago' : 'Access Token Mercado Pago *'}</label>
                <input className="form-control" required={!editingAccount} value={form.accessToken} onChange={e => setForm(p => ({ ...p, accessToken: e.target.value }))} placeholder={editingAccount ? 'Deixe em branco para manter o token salvo' : 'TEST-...'} />
              </div>
              <div className="form-group">
                <label>Ambiente Mercado Pago</label>
                <select className="form-control" value={form.mpEnvironment} onChange={e => setForm(p => ({ ...p, mpEnvironment: e.target.value }))}>
                  <option value="test">Teste</option>
                  <option value="production">Producao</option>
                </select>
              </div>
              <div className="form-group">
                <label>E-mail do pagador padrao</label>
                <input className="form-control" type="email" value={form.payerEmail} onChange={e => setForm(p => ({ ...p, payerEmail: e.target.value }))} placeholder="Use o e-mail do comprador de teste no ambiente de teste" />
              </div>
              <div className="pix-provider-note">
                Em teste, o Mercado Pago exige e-mail com @testuser.com. Se deixar vazio, o sistema usa test@testuser.com automaticamente.
              </div>
              <div className="form-group">
                <label>Nome para extrato / descritor</label>
                <input className="form-control" maxLength={22} value={form.statementDescriptor} onChange={e => setForm(p => ({ ...p, statementDescriptor: e.target.value }))} placeholder="Ex: DISTRIBUIDORA" />
              </div>
              <div className="pix-provider-note">
                Dados opcionais para melhorar aprovacoes no Mercado Pago. Em Pix de teste, o nome APRO continua sendo usado automaticamente para simular pagamento aprovado.
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nome do comprador</label>
                  <input className="form-control" value={form.payerFirstName} onChange={e => setForm(p => ({ ...p, payerFirstName: e.target.value }))} placeholder="Cliente" />
                </div>
                <div className="form-group">
                  <label>Sobrenome do comprador</label>
                  <input className="form-control" value={form.payerLastName} onChange={e => setForm(p => ({ ...p, payerLastName: e.target.value }))} placeholder="PDV" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de documento do pagador</label>
                  <select className="form-control" value={form.payerIdentificationType} onChange={e => setForm(p => ({ ...p, payerIdentificationType: e.target.value }))}>
                    <option value="CPF">CPF</option>
                    <option value="CNPJ">CNPJ</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Numero do documento do pagador</label>
                  <input className="form-control" inputMode="numeric" value={form.payerIdentificationNumber} onChange={e => setForm(p => ({ ...p, payerIdentificationNumber: e.target.value }))} placeholder="Opcional; somente numeros" />
                </div>
              </div>
              <div className="pix-provider-note">
                O documento e opcional. Se o numero ficar vazio, nenhuma identificacao sera enviada ao Mercado Pago.
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>DDD</label>
                  <input className="form-control" value={form.payerPhoneAreaCode} onChange={e => setForm(p => ({ ...p, payerPhoneAreaCode: e.target.value }))} placeholder="62" />
                </div>
                <div className="form-group">
                  <label>Telefone</label>
                  <input className="form-control" value={form.payerPhoneNumber} onChange={e => setForm(p => ({ ...p, payerPhoneNumber: e.target.value }))} placeholder="999999999" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>CEP</label>
                  <input className="form-control" value={form.payerZipCode} onChange={e => setForm(p => ({ ...p, payerZipCode: e.target.value }))} placeholder="74000000" />
                </div>
                <div className="form-group">
                  <label>Cidade</label>
                  <input className="form-control" value={form.payerCity} onChange={e => setForm(p => ({ ...p, payerCity: e.target.value }))} placeholder="Goiania" />
                </div>
                <div className="form-group">
                  <label>Estado</label>
                  <input className="form-control" maxLength={2} value={form.payerState} onChange={e => setForm(p => ({ ...p, payerState: e.target.value.toUpperCase() }))} placeholder="GO" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Rua</label>
                  <input className="form-control" value={form.payerStreetName} onChange={e => setForm(p => ({ ...p, payerStreetName: e.target.value }))} placeholder="Av. Principal" />
                </div>
                <div className="form-group">
                  <label>Numero</label>
                  <input className="form-control" value={form.payerStreetNumber} onChange={e => setForm(p => ({ ...p, payerStreetNumber: e.target.value }))} placeholder="100" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Bairro</label>
                  <input className="form-control" value={form.payerNeighborhood} onChange={e => setForm(p => ({ ...p, payerNeighborhood: e.target.value }))} placeholder="Centro" />
                </div>
                <div className="form-group">
                  <label>Complemento</label>
                  <input className="form-control" value={form.payerComplement} onChange={e => setForm(p => ({ ...p, payerComplement: e.target.value }))} placeholder="Opcional" />
                </div>
              </div>
              {form.supportsPoint && (
                <>
                  <div className="pix-provider-note">
                    Depois de salvar a conta, use Configurar Point para criar a loja e o caixa no Mercado Pago, associar a maquininha e ativar o modo PDV.
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Tipo padrao</label>
                      <select className="form-control" value={form.defaultType} onChange={e => setForm(p => ({ ...p, defaultType: e.target.value }))}>
                        <option value="credit_card">Credito</option>
                        <option value="debit_card">Debito</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Parcelas padrao</label>
                      <input className="form-control" type="number" min="1" max="12" value={form.defaultInstallments} onChange={e => setForm(p => ({ ...p, defaultInstallments: e.target.value }))} />
                    </div>
                  </div>
                </>
              )}
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

          {editingAccount && (
            <label className="pix-checkbox">
              <input type="checkbox" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} />
              Conta ativa
            </label>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setIsOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Salvar Conta</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={pointOpen} onClose={() => setPointOpen(false)} title="Configurar Mercado Pago Point" size="wide">
        {pointLoading ? (
          <div className="point-loading"><RefreshCw size={20} /> Consultando configuracao...</div>
        ) : (
          <div className="point-assistant">
            {pointError ? <div className="point-error"><AlertTriangle size={17} /> {pointError}</div> : null}

            <div className="point-step">
              <div className="point-step-number">1</div>
              <div>
                <h4>Loja e caixa Mercado Pago</h4>
                <p>Crie a estrutura que identifica este ponto de venda dentro da conta recebedora.</p>
              </div>
              {pointConfigured ? <CheckCircle2 className="point-step-check" size={20} /> : null}
            </div>

            {!pointConfigured ? (
              <form onSubmit={createPointStorePos} className="point-setup-form">
                {!pointSetup?.account.storeId ? (
                  <>
                    <h5>Dados da loja fisica</h5>
                    <div className="form-group">
                      <label>User ID da conta recebedora *</label>
                      <input className="form-control" required inputMode="numeric" value={pointForm.userId} onChange={e => setPointForm(p => ({ ...p, userId: e.target.value }))} placeholder="Disponivel nas credenciais da integracao" />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Nome da loja *</label>
                        <input className="form-control" required value={pointForm.storeName} onChange={e => setPointForm(p => ({ ...p, storeName: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>ID externo da loja</label>
                        <input className="form-control" maxLength={60} value={pointForm.storeExternalId} onChange={e => setPointForm(p => ({ ...p, storeExternalId: e.target.value }))} placeholder="Gerado automaticamente" />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Rua *</label>
                        <input className="form-control" required value={pointForm.streetName} onChange={e => setPointForm(p => ({ ...p, streetName: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>Numero *</label>
                        <input className="form-control" required value={pointForm.streetNumber} onChange={e => setPointForm(p => ({ ...p, streetNumber: e.target.value }))} />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Cidade *</label>
                        <input className="form-control" required value={pointForm.cityName} onChange={e => setPointForm(p => ({ ...p, cityName: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>Estado *</label>
                        <select className="form-control" required value={pointForm.stateName} onChange={e => setPointForm(p => ({ ...p, stateName: e.target.value }))}>
                          {brazilianStates.map(state => <option value={state} key={state}>{state}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Latitude *</label>
                        <input className="form-control" required inputMode="decimal" value={pointForm.latitude} onChange={e => setPointForm(p => ({ ...p, latitude: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>Longitude *</label>
                        <input className="form-control" required inputMode="decimal" value={pointForm.longitude} onChange={e => setPointForm(p => ({ ...p, longitude: e.target.value }))} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Referencia</label>
                      <input className="form-control" value={pointForm.reference} onChange={e => setPointForm(p => ({ ...p, reference: e.target.value }))} placeholder="Ex: proximo a avenida principal" />
                    </div>
                  </>
                ) : (
                  <div className="point-resource-row">
                    <span>Loja criada</span>
                    <strong>{pointSetup.account.storeId}</strong>
                  </div>
                )}

                {!pointSetup?.account.posId ? (
                  <>
                    <h5>Dados do caixa</h5>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Nome do caixa *</label>
                        <input className="form-control" required value={pointForm.posName} onChange={e => setPointForm(p => ({ ...p, posName: e.target.value }))} />
                      </div>
                      <div className="form-group">
                        <label>ID externo do caixa</label>
                        <input className="form-control" maxLength={40} value={pointForm.posExternalId} onChange={e => setPointForm(p => ({ ...p, posExternalId: e.target.value }))} placeholder="Gerado automaticamente" />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Categoria MCC *</label>
                      <select className="form-control" required value={pointForm.category} onChange={e => setPointForm(p => ({ ...p, category: e.target.value }))}>
                        {pointMccOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>
                  </>
                ) : null}

                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={Boolean(pointAction)}>
                    {pointAction === 'store-pos' ? 'Criando...' : 'Criar loja e caixa'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="point-resource-grid">
                <div className="point-resource-row"><span>Loja</span><strong>{pointSetup?.account.storeId}</strong></div>
                <div className="point-resource-row"><span>Caixa</span><strong>{pointSetup?.account.posId}</strong></div>
              </div>
            )}

            {pointConfigured ? (
              <>
                <div className="point-step">
                  <div className="point-step-number">2</div>
                  <div>
                    <h4>Associar a maquininha</h4>
                    <p>Ligue o Point, escaneie o QR exibido usando o aplicativo Mercado Pago da conta recebedora e selecione esta loja e este caixa.</p>
                  </div>
                  {pointSetup?.terminals.length ? <CheckCircle2 className="point-step-check" size={20} /> : null}
                </div>

                <div className="point-terminal-toolbar">
                  <span>Depois de concluir na maquininha, atualize a busca.</span>
                  <button className="btn btn-secondary" onClick={refreshPointTerminals} disabled={Boolean(pointAction)}>
                    <RefreshCw size={15} /> {pointAction === 'terminals' ? 'Buscando...' : 'Buscar terminais'}
                  </button>
                </div>

                <div className="point-step">
                  <div className="point-step-number">3</div>
                  <div>
                    <h4>Ativar modo PDV</h4>
                    <p>Ative o terminal vinculado e reinicie a maquininha ao concluir.</p>
                  </div>
                  {pointSetup?.account.terminalId ? <CheckCircle2 className="point-step-check" size={20} /> : null}
                </div>

                {pointSetup?.terminals.length ? (
                  <div className="point-terminal-list">
                    {pointSetup.terminals.map(terminal => {
                      const ready = terminal.operatingMode === 'PDV' && pointSetup.account.terminalId === terminal.id;
                      return (
                        <div className="point-terminal-row" key={terminal.id}>
                          <MonitorSmartphone size={20} />
                          <div>
                            <strong>{terminal.id}</strong>
                            <span>Modo: {terminal.operatingMode || 'UNDEFINED'}</span>
                          </div>
                          {ready ? (
                            <span className="point-terminal-ready"><CheckCircle2 size={15} /> Pronto</span>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => activatePoint(terminal.id)} disabled={Boolean(pointAction)}>
                              {pointAction === terminal.id ? 'Ativando...' : 'Ativar PDV'}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="point-empty-terminal">Nenhuma maquininha associada a este caixa foi encontrada.</div>
                )}
              </>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
