import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock3, CreditCard,
  Link2, QrCode, RefreshCw, Search, WalletCards, XCircle,
} from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import type { PaymentTransactionRecord, PaymentTransactionSummary } from '../types';
import './PaymentTransactions.css';

const emptySummary: PaymentTransactionSummary = {
  totalCount: 0,
  totalAmount: 0,
  paidCount: 0,
  paidAmount: 0,
  pendingCount: 0,
  errorCount: 0,
  attentionCount: 0,
};

const statusLabels: Record<string, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  cancelled: 'Cancelado',
  expired: 'Expirado',
  processing: 'Finalizando',
  error: 'Erro',
};

const issueLabels: Record<string, string> = {
  provider_error: 'Erro registrado na comunicacao com o provedor',
  paid_without_sale: 'Pagamento confirmado sem venda vinculada',
  finalization_in_progress: 'Finalizacao da venda em andamento',
  expired_pending: 'Cobranca vencida ainda marcada como pendente',
};

const providerLabels: Record<string, string> = {
  mercado_pago: 'Mercado Pago',
  mercado_pago_fake: 'Mercado Pago Fake',
  fake: 'Fake Provider',
};

const sourceLabels: Record<string, string> = {
  polling: 'Consulta automatica',
  provider: 'Confirmacao do provedor',
  simulated: 'Simulado',
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (value?: string | null) => value
  ? new Date(value).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  : 'Nao informado';

const initialStartDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
};

export default function PaymentTransactions() {
  const [transactions, setTransactions] = useState<PaymentTransactionRecord[]>([]);
  const [summary, setSummary] = useState<PaymentTransactionSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    paymentMethod: '',
    provider: '',
    startDate: initialStartDate(),
    endDate: new Date().toISOString().slice(0, 10),
  });

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const data = await apiRequest<{
        transactions: PaymentTransactionRecord[];
        summary: PaymentTransactionSummary;
      }>(`/payments/transactions?${params.toString()}`);
      setTransactions(data.transactions);
      setSummary(data.summary);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel carregar as transacoes.'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(loadTransactions, 250);
    return () => window.clearTimeout(timer);
  }, [loadTransactions]);

  const reconcile = async (transaction: PaymentTransactionRecord) => {
    setRefreshingId(transaction.id);
    setError('');
    try {
      await apiRequest(`/payments/transactions/${transaction.id}/reconcile`, { method: 'POST' });
      await loadTransactions();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel conciliar a transacao.'));
      await loadTransactions();
    } finally {
      setRefreshingId(null);
    }
  };

  const canReconcile = (transaction: PaymentTransactionRecord) =>
    transaction.status === 'pending'
    || transaction.status === 'processing'
    || (transaction.status === 'paid' && !transaction.saleId);

  const clearFilters = () => setFilters({
    search: '',
    status: '',
    paymentMethod: '',
    provider: '',
    startDate: '',
    endDate: '',
  });

  return (
    <div className="page-container transactions-page">
      <div className="transactions-header">
        <div>
          <h1><WalletCards size={24} /> Transacoes e conciliacao</h1>
          <p>Acompanhe cobrancas, confirme vinculos com vendas e investigue falhas de pagamento.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadTransactions} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} /> Atualizar
        </button>
      </div>

      <div className="transaction-metrics">
        <div className="transaction-metric">
          <span>Total consultado</span>
          <strong>{summary.totalCount}</strong>
          <small>{formatCurrency(summary.totalAmount)}</small>
        </div>
        <div className="transaction-metric success">
          <span>Pagamentos confirmados</span>
          <strong>{summary.paidCount}</strong>
          <small>{formatCurrency(summary.paidAmount)}</small>
        </div>
        <div className="transaction-metric pending">
          <span>Aguardando confirmacao</span>
          <strong>{summary.pendingCount}</strong>
          <small>Cobrancas pendentes</small>
        </div>
        <div className="transaction-metric attention">
          <span>Exigem atencao</span>
          <strong>{summary.attentionCount}</strong>
          <small>{summary.errorCount} com erro registrado</small>
        </div>
      </div>

      <div className="transaction-filters">
        <div className="transaction-search">
          <Search size={16} />
          <input
            value={filters.search}
            onChange={event => setFilters(current => ({ ...current, search: event.target.value }))}
            placeholder="Buscar ID, venda, conta ou erro"
          />
        </div>
        <select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))}>
          <option value="">Todos os status</option>
          <option value="attention">Exigem atencao</option>
          <option value="pending">Pendentes</option>
          <option value="paid">Pagos</option>
          <option value="processing">Finalizando</option>
          <option value="cancelled">Cancelados</option>
          <option value="expired">Expirados</option>
          <option value="error">Erros de criacao</option>
        </select>
        <select value={filters.paymentMethod} onChange={event => setFilters(current => ({ ...current, paymentMethod: event.target.value }))}>
          <option value="">Pix e cartao</option>
          <option value="pix">Pix</option>
          <option value="card">Cartao</option>
        </select>
        <select value={filters.provider} onChange={event => setFilters(current => ({ ...current, provider: event.target.value }))}>
          <option value="">Todos os provedores</option>
          <option value="mercado_pago">Mercado Pago</option>
          <option value="mercado_pago_fake">Mercado Pago Fake</option>
          <option value="fake">Fake Provider</option>
        </select>
        <input type="date" value={filters.startDate} onChange={event => setFilters(current => ({ ...current, startDate: event.target.value }))} />
        <input type="date" value={filters.endDate} onChange={event => setFilters(current => ({ ...current, endDate: event.target.value }))} />
        <button className="transaction-clear" onClick={clearFilters}>Limpar</button>
      </div>

      {error && <div className="transaction-error"><AlertTriangle size={17} /> {error}</div>}

      <div className="transaction-list">
        {loading ? (
          <div className="transaction-empty"><RefreshCw size={24} className="spin" /> Carregando transacoes...</div>
        ) : transactions.length === 0 ? (
          <div className="transaction-empty"><WalletCards size={36} /> Nenhuma transacao encontrada neste filtro.</div>
        ) : transactions.map(transaction => {
          const expanded = expandedId === transaction.id;
          return (
            <div className={`transaction-row ${transaction.issue ? 'has-issue' : ''}`} key={transaction.id}>
              <div className="transaction-row-main">
                <div className={`transaction-method ${transaction.paymentMethod}`}>
                  {transaction.paymentMethod === 'pix' ? <QrCode size={18} /> : <CreditCard size={18} />}
                </div>
                <div className="transaction-primary">
                  <strong>{providerLabels[transaction.provider] || transaction.provider}</strong>
                  <span>{transaction.accountName || 'Conta nao informada'} · {formatDate(transaction.createdAt)}</span>
                </div>
                <div className="transaction-reference">
                  <span>Transacao local</span>
                  <strong>{transaction.id}</strong>
                </div>
                <div className="transaction-reference">
                  <span>Venda vinculada</span>
                  <strong>{transaction.saleId || 'Ainda nao vinculada'}</strong>
                </div>
                <div className="transaction-value">
                  <span className={`transaction-status ${transaction.status}`}>{statusLabels[transaction.status] || transaction.status}</span>
                  <strong>{formatCurrency(transaction.amount)}</strong>
                </div>
                <button
                  className="transaction-expand"
                  onClick={() => setExpandedId(expanded ? null : transaction.id)}
                  title={expanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                >
                  {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
              </div>

              {transaction.issue && (
                <div className="transaction-issue">
                  <AlertTriangle size={15} />
                  <span>{issueLabels[transaction.issue]}</span>
                </div>
              )}

              {expanded && (
                <div className="transaction-detail">
                  <div className="transaction-detail-grid">
                    <div><span>ID do provedor</span><strong>{transaction.providerTransactionId || 'Nao criado'}</strong></div>
                    <div><span>Payment ID</span><strong>{transaction.providerPaymentId || 'Nao informado'}</strong></div>
                    <div><span>Referencia externa</span><strong>{transaction.externalReference || 'Nao informada'}</strong></div>
                    <div><span>Canal de confirmacao</span><strong>{transaction.confirmationSource ? sourceLabels[transaction.confirmationSource] : 'Ainda nao confirmado'}</strong></div>
                    <div><span>Status no provedor</span><strong>{transaction.providerStatus || 'Nao informado'}</strong></div>
                    <div><span>Detalhe do provedor</span><strong>{transaction.providerStatusDetail || 'Nao informado'}</strong></div>
                    <div><span>Itens</span><strong>{transaction.itemCount}</strong></div>
                    <div><span>Confirmado em</span><strong>{formatDate(transaction.paidAt)}</strong></div>
                    <div><span>Ultima atualizacao</span><strong>{formatDate(transaction.updatedAt)}</strong></div>
                  </div>
                  {transaction.error && (
                    <div className="transaction-provider-error"><XCircle size={16} /><span>{transaction.error}</span></div>
                  )}
                  <div className="transaction-actions">
                    {transaction.saleId && <span className="transaction-linked"><Link2 size={15} /> Venda vinculada corretamente</span>}
                    {canReconcile(transaction) && (
                      <button className="btn btn-primary" onClick={() => reconcile(transaction)} disabled={refreshingId === transaction.id}>
                        <RefreshCw size={15} className={refreshingId === transaction.id ? 'spin' : ''} />
                        {transaction.status === 'pending' ? 'Consultar provedor' : 'Concluir vinculacao'}
                      </button>
                    )}
                    {!canReconcile(transaction) && !transaction.saleId && transaction.status === 'error' && (
                      <span className="transaction-terminal"><XCircle size={15} /> Inicie uma nova venda no PDV</span>
                    )}
                    {transaction.status === 'pending' && <span className="transaction-pending-note"><Clock3 size={15} /> Aguardando confirmacao</span>}
                    {transaction.status === 'paid' && transaction.saleId && <span className="transaction-paid-note"><CheckCircle2 size={15} /> Conciliada</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
