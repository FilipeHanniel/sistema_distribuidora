import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Building2, TrendingUp, ShieldCheck, ShieldX,
  Plus, Edit2, Trash2, RefreshCw, Mail, Phone, Calendar,
  Eye, Crown, AlertTriangle, CheckCircle2, DollarSign,
  CreditCard, Receipt, Banknote, X, Users, UserPlus,
  BarChart3, ArrowUpRight, ArrowDownRight, Store
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import type { Establishment } from '../types';
import Modal from '../components/Modal';
import './SuperAdmin.css';

const API = '/api';
const getHeaders = () => {
  const token = useAuthStore.getState().token;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
};

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const formatDate = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
};

const formatDateTime = (iso?: string) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const getDueDays = (iso?: string) => {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
};

const PLAN_LABELS: Record<string, string> = { basic: 'Básico', premium: 'Premium', enterprise: 'Enterprise' };
const STATUS_LABELS: Record<string, string> = { active: 'Ativo', overdue: 'Em Atraso', suspended: 'Suspenso' };

interface Stats {
  total: number; active: number; overdue: number; suspended: number;
  totalUsers: number; totalRevenue: number; monthRevenue: number;
  periodDays: number; periodRevenue: number; previousPeriodRevenue: number; revenueGrowthPct: number;
  newUsers: number; previousNewUsers: number; userGrowthPct: number;
  newEstablishments: number; previousNewEstablishments: number; establishmentGrowthPct: number;
  mrr: number; arpa: number;
  revenueSeries: MetricPoint[];
  newUsersSeries: MetricPoint[];
  usersByEstablishment: EstablishmentUserStat[];
  topRevenueEstablishments: EstablishmentRevenueStat[];
}

interface MetricPoint { label: string; value: number; }
interface EstablishmentUserStat { id: string; name: string; totalUsers: number; }
interface EstablishmentRevenueStat { id: string; name: string; revenue: number; }

interface EstUser { id: string; username: string; name: string; role: string; active: number; }

interface Payment {
  id: string; establishmentId: string; amount: number;
  dueDate?: string; paidAt?: string; notes?: string; createdAt: string;
}

interface ManagedEstablishment extends Establishment {
  monthlyAmount?: number;
  userCount?: number;
  salesCount?: number;
  lastPayment?: Pick<Payment, 'paidAt' | 'amount'>;
}

type Tab = 'platform' | 'establishments' | 'billing';
type PeriodDays = 30 | 90 | 365;
type Plan = Establishment['plan'];
type SubscriptionStatus = Establishment['subscriptionStatus'];

interface EstablishmentForm {
  name: string;
  ownerName: string;
  email: string;
  phone: string;
  plan: Plan;
  monthlyAmount: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionDueDate: string;
  notes: string;
  gestorUsername: string;
  gestorPassword: string;
  gestorName: string;
}

const emptyForm: EstablishmentForm = {
  name: '', ownerName: '', email: '', phone: '', plan: 'basic',
  monthlyAmount: '', subscriptionStatus: 'active', subscriptionDueDate: '', notes: '',
  gestorUsername: '', gestorPassword: '', gestorName: '',
};

export default function SuperAdmin() {
  const [tab, setTab] = useState<Tab>('platform');
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [establishments, setEstablishments] = useState<ManagedEstablishment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEst, setEditingEst] = useState<Establishment | null>(null);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);

  const [selectedEst, setSelectedEst] = useState<ManagedEstablishment | null>(null);
  const [estUsers, setEstUsers] = useState<EstUser[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // Forms
  const [formData, setFormData] = useState({ ...emptyForm });
  const [subData, setSubData] = useState<{ subscriptionStatus: SubscriptionStatus; subscriptionDueDate: string }>({
    subscriptionStatus: 'active',
    subscriptionDueDate: '',
  });
  const [payForm, setPayForm] = useState({ amount: '', notes: '' });
  const [payFormOpen, setPayFormOpen] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [estRes, statsRes] = await Promise.all([
        fetch(`${API}/admin/establishments`, { headers: getHeaders() }),
        fetch(`${API}/admin/stats?periodDays=${periodDays}`, { headers: getHeaders() }),
      ]);
      if (estRes.ok) setEstablishments(await estRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [periodDays]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---- Handlers ----
  const openCreate = () => {
    setEditingEst(null);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    setFormData({ ...emptyForm, subscriptionDueDate: nextMonth.toISOString().split('T')[0] });
    setIsFormOpen(true);
  };

  const openEdit = (est: ManagedEstablishment) => {
    setEditingEst(est);
    setFormData({
      name: est.name, ownerName: est.ownerName || '', email: est.email || '',
      phone: est.phone || '', plan: est.plan,
      monthlyAmount: est.monthlyAmount ? String(est.monthlyAmount) : '',
      subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
      notes: est.notes || '', gestorUsername: '', gestorPassword: '', gestorName: '',
    });
    setIsFormOpen(true);
  };

  const openSubModal = (est: ManagedEstablishment) => {
    setSelectedEst(est);
    setSubData({
      subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
    });
    setIsSubModalOpen(true);
  };

  const openUsersModal = async (est: ManagedEstablishment) => {
    setSelectedEst(est);
    setIsUsersModalOpen(true);
    const res = await fetch(`${API}/admin/establishments/${est.id}/users`, { headers: getHeaders() });
    if (res.ok) setEstUsers(await res.json());
  };

  const openBilling = async (est: ManagedEstablishment) => {
    setSelectedEst(est);
    setPayForm({ amount: est.monthlyAmount ? String(est.monthlyAmount) : '', notes: '' });
    setPayFormOpen(false);
    setIsBillingModalOpen(true);
    setPaymentLoading(true);
    const res = await fetch(`${API}/admin/establishments/${est.id}/payments`, { headers: getHeaders() });
    if (res.ok) setPayments(await res.json());
    setPaymentLoading(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const dueDateISO = formData.subscriptionDueDate ? new Date(formData.subscriptionDueDate).toISOString() : undefined;
    const endpoint = editingEst
      ? `${API}/admin/establishments/${editingEst.id}`
      : `${API}/admin/establishments`;
    const method = editingEst ? 'PUT' : 'POST';
    const res = await fetch(endpoint, {
      method, headers: getHeaders(),
      body: JSON.stringify({ ...formData, subscriptionDueDate: dueDateISO }),
    });
    if (res.ok) { setIsFormOpen(false); loadData(); }
    else { const d = await res.json(); alert(d.error); }
  };

  const handleSubSave = async () => {
    if (!selectedEst) return;
    const dueDateISO = subData.subscriptionDueDate ? new Date(subData.subscriptionDueDate).toISOString() : undefined;
    const res = await fetch(`${API}/admin/establishments/${selectedEst.id}/subscription`, {
      method: 'PATCH', headers: getHeaders(),
      body: JSON.stringify({ ...subData, subscriptionDueDate: dueDateISO }),
    });
    if (res.ok) { setIsSubModalOpen(false); loadData(); }
  };

  const handleDelete = async (est: ManagedEstablishment) => {
    if (!confirm(`Excluir "${est.name}"? Todos os usuários serão desativados.`)) return;
    const res = await fetch(`${API}/admin/establishments/${est.id}`, { method: 'DELETE', headers: getHeaders() });
    if (res.ok) loadData();
  };

  const handleRegisterPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedEst) return;
    const res = await fetch(`${API}/admin/establishments/${selectedEst.id}/payments`, {
      method: 'POST', headers: getHeaders(),
      body: JSON.stringify({ amount: parseFloat(payForm.amount), notes: payForm.notes }),
    });
    if (res.ok) {
      const data = await res.json();
      setPayFormOpen(false);
      // Recarregar pagamentos e dados
      const paymentsRes = await fetch(`${API}/admin/establishments/${selectedEst.id}/payments`, { headers: getHeaders() });
      if (paymentsRes.ok) setPayments(await paymentsRes.json());
      loadData();
      alert(data.message);
    } else {
      const d = await res.json(); alert(d.error);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Remover este registro de pagamento?')) return;
    const res = await fetch(`${API}/admin/payments/${paymentId}`, { method: 'DELETE', headers: getHeaders() });
    if (res.ok && selectedEst) {
      const paymentsRes = await fetch(`${API}/admin/establishments/${selectedEst.id}/payments`, { headers: getHeaders() });
      if (paymentsRes.ok) setPayments(await paymentsRes.json());
    }
  };

  // ---- UI helpers ----
  const renderDueBadge = (est: ManagedEstablishment) => {
    const days = getDueDays(est.subscriptionDueDate);
    if (days === null) return null;
    let cls = ''; let msg = '';
    if (days < 0) { cls = 'overdue'; msg = `Vencido há ${Math.abs(days)}d`; }
    else if (days === 0) { cls = 'warning'; msg = 'Vence hoje!'; }
    else if (days <= 7) { cls = 'warning'; msg = `Vence em ${days}d`; }
    else { msg = `Vence em ${days}d`; }
    return <span className={`due-badge ${cls}`}><Calendar size={11} />{msg}</span>;
  };

  const statCards = stats ? [
    { label: 'Estabelecimentos', value: stats.total, icon: <Building2 size={20} />, color: 'blue' },
    { label: 'Assinaturas Ativas', value: stats.active, icon: <CheckCircle2 size={20} />, color: 'green' },
    { label: 'Em Atraso', value: stats.overdue, icon: <AlertTriangle size={20} />, color: 'amber' },
    { label: 'Suspensos', value: stats.suspended, icon: <ShieldX size={20} />, color: 'red' },
    { label: 'Receita do Mês', value: formatCurrency(stats.monthRevenue), icon: <TrendingUp size={20} />, color: 'teal' },
    { label: 'Receita Total (assin.)', value: formatCurrency(stats.totalRevenue), icon: <DollarSign size={20} />, color: 'purple' },
  ] : [];

  const periodLabel = periodDays === 30 ? '30 dias' : periodDays === 90 ? '90 dias' : '12 meses';
  const revenueSeriesMax = Math.max(...(stats?.revenueSeries.map(p => p.value) || [0]), 1);
  const userSeriesMax = Math.max(...(stats?.newUsersSeries.map(p => p.value) || [0]), 1);

  const renderGrowth = (value: number) => {
    const positive = value >= 0;
    const Icon = positive ? ArrowUpRight : ArrowDownRight;
    return (
      <span className={`growth-pill ${positive ? 'positive' : 'negative'}`}>
        <Icon size={13} /> {Math.abs(value).toLocaleString('pt-BR')}%
      </span>
    );
  };

  const platformCards = stats ? [
    {
      label: `Faturamento (${periodLabel})`,
      value: formatCurrency(stats.periodRevenue),
      note: `${formatCurrency(stats.previousPeriodRevenue)} no periodo anterior`,
      icon: <DollarSign size={19} />,
      trend: stats.revenueGrowthPct,
    },
    {
      label: 'MRR ativo',
      value: formatCurrency(stats.mrr),
      note: `${stats.active} assinaturas ativas`,
      icon: <TrendingUp size={19} />,
    },
    {
      label: 'Usuarios totais',
      value: stats.totalUsers,
      note: `${stats.newUsers} novos em ${periodLabel}`,
      icon: <Users size={19} />,
      trend: stats.userGrowthPct,
    },
    {
      label: 'Novos estabelecimentos',
      value: stats.newEstablishments,
      note: `${stats.total} contas cadastradas no total`,
      icon: <Store size={19} />,
      trend: stats.establishmentGrowthPct,
    },
    {
      label: 'ARPA medio',
      value: formatCurrency(stats.arpa),
      note: 'Receita media por conta ativa',
      icon: <BarChart3 size={19} />,
    },
    {
      label: 'Risco operacional',
      value: stats.overdue + stats.suspended,
      note: `${stats.overdue} atrasadas, ${stats.suspended} suspensas`,
      icon: <AlertTriangle size={19} />,
    },
  ] : [];

  return (
    <div className="page-container superadmin-page">

      {/* Header */}
      <div className="sa-header">
        <div>
          <h1><Crown size={26} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Painel Super Admin</h1>
          <p className="subtitle">Gestão centralizada de estabelecimentos, assinaturas e cobranças</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={loadData}><RefreshCw size={16} /> Atualizar</button>
          <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Novo Estabelecimento</button>
        </div>
      </div>

      {/* Stats */}
      <div className="sa-stats">
        {statCards.map((s, i) => (
          <div key={i} className="sa-stat-card">
            <div className={`sa-stat-icon ${s.color}`}>{s.icon}</div>
            <div className="sa-stat-info">
              <span className="sa-stat-label">{s.label}</span>
              <span className="sa-stat-value">{s.value}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="sa-tabs">
        <button className={`sa-tab ${tab === 'platform' ? 'active' : ''}`} onClick={() => setTab('platform')}>
          <BarChart3 size={16} /> Plataforma
        </button>
        <button className={`sa-tab ${tab === 'establishments' ? 'active' : ''}`} onClick={() => setTab('establishments')}>
          <Building2 size={16} /> Estabelecimentos
        </button>
        <button className={`sa-tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>
          <CreditCard size={16} /> Cobranças
        </button>
      </div>

      {/* ===== TAB: PLATAFORMA ===== */}
      {tab === 'platform' && (
        loading ? (
          <div className="sa-empty"><RefreshCw size={32} style={{ opacity: 0.3 }} /><p>Carregando...</p></div>
        ) : stats && (
          <div className="platform-dashboard">
            <div className="platform-toolbar">
              <div>
                <h2>Estatisticas da plataforma</h2>
                <p>Indicadores comerciais, crescimento e saude da base.</p>
              </div>
              <div className="period-segment" aria-label="Periodo das estatisticas">
                {[30, 90, 365].map(days => (
                  <button
                    key={days}
                    className={periodDays === days ? 'active' : ''}
                    onClick={() => setPeriodDays(days as PeriodDays)}
                  >
                    {days === 365 ? '12m' : `${days}d`}
                  </button>
                ))}
              </div>
            </div>

            <div className="platform-kpis">
              {platformCards.map(card => (
                <div className="platform-kpi" key={card.label}>
                  <div className="platform-kpi-top">
                    <span className="platform-kpi-icon">{card.icon}</span>
                    {typeof card.trend === 'number' && renderGrowth(card.trend)}
                  </div>
                  <span className="platform-kpi-label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </div>
              ))}
            </div>

            <div className="platform-grid">
              <section className="platform-panel platform-panel-wide">
                <div className="platform-panel-header">
                  <div>
                    <h3>Faturamento por periodo</h3>
                    <p>Pagamentos recebidos agrupados por {periodDays === 365 ? 'mes' : 'dia'}.</p>
                  </div>
                  <span>{formatCurrency(stats.periodRevenue)}</span>
                </div>
                <div className="metric-bars">
                  {stats.revenueSeries.length === 0 ? (
                    <div className="platform-empty-row">Nenhum pagamento recebido neste periodo.</div>
                  ) : stats.revenueSeries.map(point => (
                    <div className="metric-bar-row" key={point.label}>
                      <span>{point.label}</span>
                      <div className="metric-bar-track">
                        <div className="metric-bar-fill revenue" style={{ width: `${Math.max(5, (point.value / revenueSeriesMax) * 100)}%` }} />
                      </div>
                      <strong>{formatCurrency(point.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="platform-panel">
                <div className="platform-panel-header">
                  <div>
                    <h3>Novos usuarios</h3>
                    <p>Entradas no periodo selecionado.</p>
                  </div>
                  <span>{stats.newUsers}</span>
                </div>
                <div className="metric-bars compact">
                  {stats.newUsersSeries.length === 0 ? (
                    <div className="platform-empty-row">Sem novos usuarios neste periodo.</div>
                  ) : stats.newUsersSeries.map(point => (
                    <div className="metric-bar-row" key={point.label}>
                      <span>{point.label}</span>
                      <div className="metric-bar-track">
                        <div className="metric-bar-fill users" style={{ width: `${Math.max(8, (point.value / userSeriesMax) * 100)}%` }} />
                      </div>
                      <strong>{point.value}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="platform-panel">
                <div className="platform-panel-header">
                  <div>
                    <h3>Usuarios por conta</h3>
                    <p>Maiores bases ativas.</p>
                  </div>
                  <UserPlus size={18} />
                </div>
                <div className="platform-list">
                  {stats.usersByEstablishment.map(item => (
                    <div className="platform-list-row" key={item.id}>
                      <span>{item.name}</span>
                      <strong>{item.totalUsers}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className="platform-panel">
                <div className="platform-panel-header">
                  <div>
                    <h3>Top faturamento</h3>
                    <p>Contas com mais pagamentos recebidos.</p>
                  </div>
                  <Receipt size={18} />
                </div>
                <div className="platform-list">
                  {stats.topRevenueEstablishments.map(item => (
                    <div className="platform-list-row" key={item.id}>
                      <span>{item.name}</span>
                      <strong>{formatCurrency(item.revenue)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )
      )}

      {/* ===== TAB: ESTABELECIMENTOS ===== */}
      {tab === 'establishments' && (
        loading ? (
          <div className="sa-empty"><RefreshCw size={32} style={{ opacity: 0.3 }} /><p>Carregando...</p></div>
        ) : establishments.length === 0 ? (
          <div className="sa-empty">
            <Building2 size={48} style={{ opacity: 0.3 }} />
            <p>Nenhum estabelecimento cadastrado.</p>
            <button className="btn btn-primary" onClick={openCreate}><Plus size={16} /> Criar primeiro</button>
          </div>
        ) : (
          <div className="est-grid">
            {establishments.map(est => {
              const days = getDueDays(est.subscriptionDueDate);
              const lastPay = est.lastPayment;
              return (
                <div key={est.id} className={`est-card ${est.subscriptionStatus === 'suspended' ? 'est-card--suspended' : ''}`}>
                  <div className="est-card-top">
                    <div className="est-avatar">{est.name[0].toUpperCase()}</div>
                    <div className="est-badges">
                      <span className={`badge badge-plan-${est.plan}`}>{PLAN_LABELS[est.plan] || est.plan}</span>
                      <span className={`badge badge-sub-${est.subscriptionStatus}`}>{STATUS_LABELS[est.subscriptionStatus]}</span>
                    </div>
                  </div>

                  <div className="est-name">{est.name}</div>
                  {est.ownerName && <div className="est-owner">{est.ownerName}</div>}
                  {est.email && <div className="est-contact"><Mail size={12} />{est.email}</div>}
                  {est.phone && <div className="est-contact"><Phone size={12} />{est.phone}</div>}

                  <div className="est-meta">
                    <div className="est-meta-item">
                      <span className="est-meta-label">Usuários</span>
                      <span className="est-meta-value">{est.userCount ?? 0}</span>
                    </div>
                    <div className="est-meta-item">
                      <span className="est-meta-label">Vendas</span>
                      <span className="est-meta-value">{est.salesCount ?? 0}</span>
                    </div>
                    <div className="est-meta-item">
                      <span className="est-meta-label">Mensal</span>
                      <span className="est-meta-value" style={{ fontSize: '0.8rem' }}>
                        {est.monthlyAmount ? formatCurrency(est.monthlyAmount) : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="est-due-row">
                    {renderDueBadge(est)}
                    {lastPay && (
                      <span className="last-pay-info">
                        <CheckCircle2 size={11} /> Pago {formatDate(lastPay.paidAt)}
                      </span>
                    )}
                  </div>

                  <div className="est-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => openUsersModal(est)}><Eye size={13} /> Usuários</button>
                    <button className="btn btn-billing btn-sm" onClick={() => openBilling(est)}><DollarSign size={13} /> Cobranças</button>
                    <button className={`btn btn-sm ${days !== null && days < 0 ? 'btn-danger' : 'btn-secondary'}`} onClick={() => openSubModal(est)}>
                      <ShieldCheck size={13} /> Assinatura
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => openEdit(est)}><Edit2 size={13} /></button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(est)}><Trash2 size={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ===== TAB: COBRANÇAS (visão geral) ===== */}
      {tab === 'billing' && (
        <div className="billing-overview">
          {loading ? (
            <div className="sa-empty"><RefreshCw size={32} style={{ opacity: 0.3 }} /></div>
          ) : (
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Estabelecimento</th>
                  <th>Plano</th>
                  <th>Mensalidade</th>
                  <th>Status</th>
                  <th>Próximo Vencimento</th>
                  <th>Último Pagamento</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {establishments.map(est => {
                  const days = getDueDays(est.subscriptionDueDate);
                  const lastPay = est.lastPayment;
                  return (
                    <tr key={est.id} className={est.subscriptionStatus === 'suspended' ? 'row-suspended' : days !== null && days < 0 ? 'row-overdue' : ''}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{est.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{est.ownerName}</div>
                      </td>
                      <td><span className={`badge badge-plan-${est.plan}`}>{PLAN_LABELS[est.plan]}</span></td>
                      <td>{est.monthlyAmount ? formatCurrency(est.monthlyAmount) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                      <td><span className={`badge badge-sub-${est.subscriptionStatus}`}>{STATUS_LABELS[est.subscriptionStatus]}</span></td>
                      <td>
                        <div style={{ fontWeight: days !== null && days < 0 ? 700 : 400, color: days !== null && days < 0 ? '#dc2626' : undefined }}>
                          {formatDate(est.subscriptionDueDate)}
                        </div>
                        {days !== null && <div style={{ fontSize: '0.72rem', color: days < 0 ? '#dc2626' : 'var(--text-secondary)' }}>
                          {days < 0 ? `${Math.abs(days)}d atraso` : days === 0 ? 'hoje' : `em ${days}d`}
                        </div>}
                      </td>
                      <td>
                        {lastPay ? (
                          <div>
                            <div style={{ fontWeight: 600, color: '#16a34a' }}>{formatCurrency(lastPay.amount)}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{formatDate(lastPay.paidAt)}</div>
                          </div>
                        ) : <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Nenhum</span>}
                      </td>
                      <td className="text-right">
                        <button className="btn btn-billing btn-sm" onClick={() => openBilling(est)}>
                          <Receipt size={13} /> Ver Cobranças
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ===== MODAL: CRIAR / EDITAR ESTABELECIMENTO ===== */}
      <Modal isOpen={isFormOpen} onClose={() => setIsFormOpen(false)}
        title={editingEst ? `Editar — ${editingEst.name}` : 'Novo Estabelecimento'}>
        <form onSubmit={handleSubmit}>
          <div className="form-section-title">Dados do Estabelecimento</div>
          <div className="form-group">
            <label>Nome do Estabelecimento *</label>
            <input className="form-control" required value={formData.name}
              onChange={e => setFormData(p => ({ ...p, name: e.target.value }))}
              placeholder="Ex: Distribuidora São João" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Responsável</label>
              <input className="form-control" value={formData.ownerName}
                onChange={e => setFormData(p => ({ ...p, ownerName: e.target.value }))}
                placeholder="Nome do proprietário" />
            </div>
            <div className="form-group">
              <label>Plano</label>
              <select className="form-control" value={formData.plan}
                onChange={e => setFormData(p => ({ ...p, plan: e.target.value as Plan }))}>
                <option value="basic">Básico</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>E-mail</label>
              <input className="form-control" type="email" value={formData.email}
                onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
                placeholder="email@exemplo.com" />
            </div>
            <div className="form-group">
              <label>Telefone</label>
              <input className="form-control" value={formData.phone}
                onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
                placeholder="(11) 99999-9999" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Valor Mensal (R$)</label>
              <input className="form-control" type="number" step="0.01" value={formData.monthlyAmount}
                onChange={e => setFormData(p => ({ ...p, monthlyAmount: e.target.value }))}
                placeholder="Ex: 97.00" />
            </div>
            <div className="form-group">
              <label>Status da Assinatura</label>
              <select className="form-control" value={formData.subscriptionStatus}
                onChange={e => setFormData(p => ({ ...p, subscriptionStatus: e.target.value as SubscriptionStatus }))}>
                <option value="active">Ativo</option>
                <option value="overdue">Em Atraso</option>
                <option value="suspended">Suspenso</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>Vencimento da Assinatura</label>
            <input className="form-control" type="date" value={formData.subscriptionDueDate}
              onChange={e => setFormData(p => ({ ...p, subscriptionDueDate: e.target.value }))} />
            <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              Calculado automaticamente como 1 mês após o cadastro
            </small>
          </div>
          <div className="form-group">
            <label>Observações</label>
            <textarea className="form-control" rows={2} value={formData.notes}
              onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))}
              placeholder="Notas internas..." />
          </div>

          {!editingEst && (
            <>
              <div className="form-section-title">Dados do Gestor (primeiro acesso)</div>
              <div className="form-group">
                <label>Nome do Gestor *</label>
                <input className="form-control" required value={formData.gestorName}
                  onChange={e => setFormData(p => ({ ...p, gestorName: e.target.value }))}
                  placeholder="Ex: Carlos Oliveira" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Login do Gestor *</label>
                  <input className="form-control" required value={formData.gestorUsername}
                    onChange={e => setFormData(p => ({ ...p, gestorUsername: e.target.value }))}
                    placeholder="Ex: carlos.oliveira" />
                </div>
                <div className="form-group">
                  <label>Senha do Gestor *</label>
                  <input className="form-control" type="password" required value={formData.gestorPassword}
                    onChange={e => setFormData(p => ({ ...p, gestorPassword: e.target.value }))}
                    placeholder="Senha de acesso" />
                </div>
              </div>
            </>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setIsFormOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary">
              {editingEst ? 'Salvar Alterações' : 'Criar Estabelecimento'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===== MODAL: ASSINATURA ===== */}
      <Modal isOpen={isSubModalOpen} onClose={() => setIsSubModalOpen(false)}
        title={`Assinatura — ${selectedEst?.name}`}>
        <div className="form-group">
          <label>Status da Assinatura</label>
          <select className="form-control" value={subData.subscriptionStatus}
            onChange={e => setSubData(p => ({ ...p, subscriptionStatus: e.target.value as SubscriptionStatus }))}>
            <option value="active">Ativo</option>
            <option value="overdue">Em Atraso</option>
            <option value="suspended">Suspenso (bloqueia acesso)</option>
          </select>
        </div>
        <div className="form-group">
          <label>Data de Vencimento</label>
          <input className="form-control" type="date" value={subData.subscriptionDueDate}
            onChange={e => setSubData(p => ({ ...p, subscriptionDueDate: e.target.value }))} />
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => setIsSubModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubSave}>Salvar</button>
        </div>
      </Modal>

      {/* ===== MODAL: USUÁRIOS ===== */}
      <Modal isOpen={isUsersModalOpen} onClose={() => setIsUsersModalOpen(false)}
        title={`Usuários — ${selectedEst?.name}`}>
        <div className="est-users-list">
          {estUsers.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>Nenhum usuário.</p>
          ) : estUsers.map(u => (
            <div key={u.id} className="est-user-row">
              <div className="est-user-avatar">{u.name[0].toUpperCase()}</div>
              <div className="est-user-info">
                <div className="est-user-name">{u.name}</div>
                <div className="est-user-username">@{u.username}</div>
              </div>
              <span className={`est-user-role role-${u.role}`}>{u.role === 'gestor' ? 'Gestor' : 'Operador'}</span>
              <span style={{ fontSize: '0.75rem', color: u.active ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                {u.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          ))}
        </div>
        <div className="form-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setIsUsersModalOpen(false)}>Fechar</button>
        </div>
      </Modal>

      {/* ===== MODAL: COBRANÇAS ===== */}
      <Modal isOpen={isBillingModalOpen} onClose={() => setIsBillingModalOpen(false)}
        title={`Cobranças — ${selectedEst?.name}`}>

        {/* Resumo da assinatura */}
        {selectedEst && (
          <div className="billing-summary">
            <div className="billing-summary-item">
              <span className="bs-label">Plano</span>
              <span className="bs-value">{PLAN_LABELS[selectedEst.plan] || selectedEst.plan}</span>
            </div>
            <div className="billing-summary-item">
              <span className="bs-label">Mensalidade</span>
              <span className="bs-value highlight">
                {selectedEst.monthlyAmount ? formatCurrency(selectedEst.monthlyAmount) : 'Não definida'}
              </span>
            </div>
            <div className="billing-summary-item">
              <span className="bs-label">Status</span>
              <span className={`badge badge-sub-${selectedEst.subscriptionStatus}`}>
                {STATUS_LABELS[selectedEst.subscriptionStatus]}
              </span>
            </div>
            <div className="billing-summary-item">
              <span className="bs-label">Próximo Vencimento</span>
              <span className={`bs-value ${getDueDays(selectedEst.subscriptionDueDate) !== null && getDueDays(selectedEst.subscriptionDueDate)! < 0 ? 'overdue' : ''}`}>
                {formatDate(selectedEst.subscriptionDueDate)}
              </span>
            </div>
          </div>
        )}

        {/* Botão registrar pagamento */}
        {!payFormOpen && (
          <button className="btn btn-primary" style={{ width: '100%', marginBottom: '1rem', justifyContent: 'center' }}
            onClick={() => setPayFormOpen(true)}>
            <DollarSign size={16} /> Registrar Pagamento Recebido
          </button>
        )}

        {/* Formulário de pagamento */}
        {payFormOpen && (
          <form onSubmit={handleRegisterPayment} className="pay-form">
            <div className="pay-form-header">
              <span>Registrar Pagamento</span>
              <button type="button" className="pay-form-close" onClick={() => setPayFormOpen(false)}><X size={16} /></button>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Valor Recebido (R$) *</label>
                <input className="form-control" type="number" step="0.01" required value={payForm.amount}
                  onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="Ex: 97.00" />
              </div>
              <div className="form-group">
                <label>Observação</label>
                <input className="form-control" value={payForm.notes}
                  onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Ex: PIX, transferência..." />
              </div>
            </div>
            <div className="pay-form-info">
              <CheckCircle2 size={14} />
              Ao confirmar: assinatura será marcada como <strong>Ativa</strong> e o vencimento avança <strong>1 mês</strong> automaticamente.
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPayFormOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary"><DollarSign size={15} /> Confirmar Pagamento</button>
            </div>
          </form>
        )}

        {/* Histórico */}
        <div className="billing-history-label">Histórico de Pagamentos</div>
        {paymentLoading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Carregando...</div>
        ) : payments.length === 0 ? (
          <div className="billing-empty">
            <Receipt size={32} style={{ opacity: 0.3 }} />
            <p>Nenhum pagamento registrado ainda.</p>
          </div>
        ) : (
          <div className="billing-payments-list">
            {payments.map(pay => (
              <div key={pay.id} className="billing-payment-row">
                <div className="bpr-icon">
                  <Banknote size={16} />
                </div>
                <div className="bpr-info">
                  <div className="bpr-amount">{formatCurrency(pay.amount)}</div>
                  <div className="bpr-meta">
                    Pago em {formatDateTime(pay.paidAt)}
                    {pay.dueDate && ` · Ref: ${formatDate(pay.dueDate)}`}
                    {pay.notes && ` · ${pay.notes}`}
                  </div>
                </div>
                <button className="bpr-delete" title="Remover" onClick={() => handleDeletePayment(pay.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="form-actions" style={{ marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={() => setIsBillingModalOpen(false)}>Fechar</button>
        </div>
      </Modal>
    </div>
  );
}
