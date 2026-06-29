import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  Building2, TrendingUp, ShieldCheck, ShieldX,
  Plus, Edit2, Trash2, RefreshCw, Mail, Phone, Calendar,
  Eye, Crown, AlertTriangle, CheckCircle2, DollarSign,
  CreditCard, Receipt, Banknote, X, Users, UserPlus,
  BarChart3, ArrowUpRight, ArrowDownRight, Store, Activity,
  Target, PackageSearch, ClipboardList, KeyRound
} from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import type { AuditLog, Establishment, PlanDefinition } from '../types';
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

interface BusinessInsight {
  id: string;
  name: string;
  ownerName?: string;
  plan: string;
  subscriptionStatus: string;
  monthlyAmount: number;
  periodRevenue: number;
  previousPeriodRevenue: number;
  revenueGrowthPct: number;
  salesCount: number;
  previousSalesCount: number;
  salesGrowthPct: number;
  averageTicket: number;
  productCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  userCount: number;
  activeUsers: number;
  lastSaleAt?: string | null;
  healthScore: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
}

interface BusinessInsights {
  periodDays: number;
  summary: {
    totalBusinesses: number;
    activeBusinesses: number;
    totalRevenue: number;
    totalSales: number;
    averageTicket: number;
    lowStockBusinesses: number;
  };
  businesses: BusinessInsight[];
  topFive: BusinessInsight[];
  bottomFive: BusinessInsight[];
}

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

type Tab = 'platform' | 'businesses' | 'establishments' | 'billing' | 'audit';
type PeriodDays = 30 | 90 | 365;
type Plan = Establishment['plan'];
type SubscriptionStatus = Establishment['subscriptionStatus'];

interface EstablishmentForm {
  name: string;
  loginCode: string;
  ownerName: string;
  email: string;
  phone: string;
  plan: Plan;
  monthlyAmount: string;
  subscriptionStatus: SubscriptionStatus;
  subscriptionDueDate: string;
  subscriptionGraceDays: string;
  notes: string;
  gestorUsername: string;
  gestorPassword: string;
  gestorName: string;
}

const emptyForm: EstablishmentForm = {
  name: '', loginCode: '', ownerName: '', email: '', phone: '', plan: 'basic',
  monthlyAmount: '', subscriptionStatus: 'active', subscriptionDueDate: '', notes: '',
  subscriptionGraceDays: '7',
  gestorUsername: '', gestorPassword: '', gestorName: '',
};

export default function SuperAdmin() {
  const [tab, setTab] = useState<Tab>('platform');
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [establishments, setEstablishments] = useState<ManagedEstablishment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [businessInsights, setBusinessInsights] = useState<BusinessInsights | null>(null);
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
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
  const [subData, setSubData] = useState<{ subscriptionStatus: SubscriptionStatus; subscriptionDueDate: string; subscriptionGraceDays: string }>({
    subscriptionStatus: 'active',
    subscriptionDueDate: '',
    subscriptionGraceDays: '7',
  });
  const [payForm, setPayForm] = useState({ amount: '', notes: '' });
  const [payFormOpen, setPayFormOpen] = useState(false);
  const [userFormMode, setUserFormMode] = useState<'create' | 'reset' | null>(null);
  const [userForm, setUserForm] = useState({ userId: '', name: '', username: '', password: '' });
  const [userFormError, setUserFormError] = useState('');
  const [userFormSaving, setUserFormSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [estRes, statsRes, insightsRes, plansRes, auditRes] = await Promise.all([
        fetch(`${API}/admin/establishments`, { headers: getHeaders() }),
        fetch(`${API}/admin/stats?periodDays=${periodDays}`, { headers: getHeaders() }),
        fetch(`${API}/admin/business-insights?periodDays=${periodDays}`, { headers: getHeaders() }),
        fetch(`${API}/admin/plans`, { headers: getHeaders() }),
        fetch(`${API}/admin/audit-logs?limit=80`, { headers: getHeaders() }),
      ]);
      if (estRes.ok) {
        const establishmentData: ManagedEstablishment[] = await estRes.json();
        setEstablishments(establishmentData);
        setSelectedEst(current => current
          ? establishmentData.find(item => item.id === current.id) || current
          : null);
      }
      if (statsRes.ok) setStats(await statsRes.json());
      if (plansRes.ok) setPlans(await plansRes.json());
      if (auditRes.ok) setAuditLogs(await auditRes.json());
      if (insightsRes.ok) {
        const data: BusinessInsights = await insightsRes.json();
        setBusinessInsights(data);
        setSelectedBusinessId(current => current || data.businesses[0]?.id || '');
      }
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
      name: est.name, loginCode: est.loginCode || '', ownerName: est.ownerName || '', email: est.email || '',
      phone: est.phone || '', plan: est.plan,
      monthlyAmount: est.monthlyAmount ? String(est.monthlyAmount) : '',
      subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
      subscriptionGraceDays: String(est.subscriptionGraceDays ?? 7),
      notes: est.notes || '', gestorUsername: '', gestorPassword: '', gestorName: '',
    });
    setIsFormOpen(true);
  };

  const openSubModal = (est: ManagedEstablishment) => {
    setSelectedEst(est);
    setSubData({
      subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
      subscriptionGraceDays: String(est.subscriptionGraceDays ?? 7),
    });
    setIsSubModalOpen(true);
  };

  const openUsersModal = async (est: ManagedEstablishment) => {
    setSelectedEst(est);
    setUserFormMode(null);
    setUserFormError('');
    setUserForm({ userId: '', name: '', username: '', password: '' });
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

  const handleReconcileSubscriptions = async () => {
    const res = await fetch(`${API}/admin/subscriptions/reconcile`, {
      method: 'POST',
      headers: getHeaders(),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Nao foi possivel atualizar as assinaturas.');
    await loadData();
    alert(`${data.message} ${data.summary.changed} status alterado(s).`);
  };

  const reloadEstablishmentUsers = async (establishmentId: string) => {
    const res = await fetch(`${API}/admin/establishments/${establishmentId}/users`, { headers: getHeaders() });
    if (res.ok) setEstUsers(await res.json());
  };

  const openCreateUser = () => {
    setUserFormMode('create');
    setUserFormError('');
    setUserForm({ userId: '', name: '', username: '', password: '' });
  };

  const openPasswordReset = (user: EstUser) => {
    setUserFormMode('reset');
    setUserFormError('');
    setUserForm({ userId: user.id, name: user.name, username: user.username, password: '' });
  };

  const handleUserFormSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedEst || !userFormMode) return;
    setUserFormSaving(true);
    setUserFormError('');
    const endpoint = userFormMode === 'create'
      ? `${API}/admin/establishments/${selectedEst.id}/users`
      : `${API}/admin/users/${userForm.userId}/password`;
    const method = userFormMode === 'create' ? 'POST' : 'PATCH';
    const body = userFormMode === 'create'
      ? { name: userForm.name, username: userForm.username, password: userForm.password }
      : { newPassword: userForm.password };
    try {
      const res = await fetch(endpoint, { method, headers: getHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Nao foi possivel salvar o usuario.');
      await reloadEstablishmentUsers(selectedEst.id);
      await loadData();
      setUserFormMode(null);
      setUserForm({ userId: '', name: '', username: '', password: '' });
    } catch (error) {
      setUserFormError(error instanceof Error ? error.message : 'Nao foi possivel salvar o usuario.');
    } finally {
      setUserFormSaving(false);
    }
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

  const selectedBusiness = businessInsights?.businesses.find(b => b.id === selectedBusinessId) || businessInsights?.businesses[0];
  const businessSummaryCards = businessInsights ? [
    { label: 'Negocios ativos', value: businessInsights.summary.activeBusinesses, note: `${businessInsights.summary.totalBusinesses} cadastrados`, icon: <Store size={18} /> },
    { label: `Vendas (${periodLabel})`, value: businessInsights.summary.totalSales, note: formatCurrency(businessInsights.summary.totalRevenue), icon: <Receipt size={18} /> },
    { label: 'Ticket medio', value: formatCurrency(businessInsights.summary.averageTicket), note: 'Media da base operacional', icon: <Target size={18} /> },
    { label: 'Estoque em atencao', value: businessInsights.summary.lowStockBusinesses, note: 'Negocios com alerta de estoque', icon: <PackageSearch size={18} /> },
  ] : [];

  const planOptions = plans.length > 0 ? plans : [
    { key: 'basic', label: 'Basico', description: '', limits: { maxUsers: 4, maxOperators: 3, maxProducts: 500, maxPaymentAccounts: 3 }, features: { fiscal: true, aiReports: true, mercadoPagoPix: true, mercadoPagoPoint: false } },
    { key: 'premium', label: 'Premium', description: '', limits: { maxUsers: 7, maxOperators: 6, maxProducts: 3000, maxPaymentAccounts: 6 }, features: { fiscal: true, aiReports: true, mercadoPagoPix: true, mercadoPagoPoint: true } },
    { key: 'enterprise', label: 'Enterprise', description: '', limits: { maxUsers: null, maxOperators: null, maxProducts: null, maxPaymentAccounts: null }, features: { fiscal: true, aiReports: true, mercadoPagoPix: true, mercadoPagoPoint: true } },
  ] as PlanDefinition[];

  const selectedPlan = planOptions.find(p => p.key === formData.plan);
  const formatLimit = (value: number | null | undefined) => value == null ? 'Ilimitado' : value.toLocaleString('pt-BR');
  const actionLabels: Record<string, string> = {
    'establishment.created': 'Estabelecimento criado',
    'establishment.updated': 'Estabelecimento atualizado',
    'establishment.deleted': 'Estabelecimento removido',
    'subscription.updated': 'Assinatura atualizada',
    'subscription.auto_status_updated': 'Status da assinatura atualizado automaticamente',
    'platform_payment.registered': 'Pagamento registrado',
    'platform_payment.deleted': 'Pagamento removido',
    'payment_account.created': 'Conta criada',
    'payment_account.updated': 'Conta atualizada',
    'payment_account.deactivated': 'Conta desativada',
    'payment_account.deleted': 'Conta removida',
    'product.created': 'Produto criado',
    'product.updated': 'Produto atualizado',
    'product.deleted': 'Produto removido',
    'sale.created': 'Venda registrada',
    'user.created': 'Usuario criado',
    'user.created_by_superadmin': 'Usuario criado pelo SuperAdmin',
    'user.updated': 'Usuario atualizado',
    'user.updated_with_password': 'Usuario e senha atualizados',
    'user.password_reset': 'Senha redefinida pelo SuperAdmin',
    'settings.updated': 'Configuracoes do estabelecimento atualizadas',
    'user.activated': 'Usuario ativado',
    'user.deactivated': 'Usuario desativado',
    'user.deleted': 'Usuario removido',
  };

  const summarizeAuditMetadata = (metadata?: Record<string, unknown>) => {
    if (!metadata || Object.keys(metadata).length === 0) return 'Sem detalhes adicionais';
    return Object.entries(metadata)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' | ') || 'Sem detalhes adicionais';
  };

  const getScoreClass = (score: number) => {
    if (score >= 70) return 'strong';
    if (score >= 40) return 'medium';
    return 'weak';
  };

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
        <button className={`sa-tab ${tab === 'businesses' ? 'active' : ''}`} onClick={() => setTab('businesses')}>
          <Activity size={16} /> Negocios
        </button>
        <button className={`sa-tab ${tab === 'establishments' ? 'active' : ''}`} onClick={() => setTab('establishments')}>
          <Building2 size={16} /> Estabelecimentos
        </button>
        <button className={`sa-tab ${tab === 'billing' ? 'active' : ''}`} onClick={() => setTab('billing')}>
          <CreditCard size={16} /> Cobranças
        </button>
        <button className={`sa-tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>
          <ClipboardList size={16} /> Auditoria
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

      {/* ===== TAB: NEGOCIOS ===== */}
      {tab === 'businesses' && (
        loading ? (
          <div className="sa-empty"><RefreshCw size={32} style={{ opacity: 0.3 }} /><p>Carregando...</p></div>
        ) : businessInsights && (
          <div className="business-dashboard">
            <div className="platform-toolbar">
              <div>
                <h2>Saude dos negocios</h2>
                <p>Uso operacional, vendas, estoque e crescimento dos estabelecimentos.</p>
              </div>
              <div className="period-segment" aria-label="Periodo de analise dos negocios">
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
              {businessSummaryCards.map(card => (
                <div className="platform-kpi" key={card.label}>
                  <div className="platform-kpi-top">
                    <span className="platform-kpi-icon">{card.icon}</span>
                  </div>
                  <span className="platform-kpi-label">{card.label}</span>
                  <strong>{card.value}</strong>
                  <small>{card.note}</small>
                </div>
              ))}
            </div>

            <section className="business-section">
              <div className="business-section-header">
                <div>
                  <h3>Analisar um negocio</h3>
                  <p>Escolha um estabelecimento para ver os principais sinais operacionais.</p>
                </div>
                <select className="form-control business-select" value={selectedBusiness?.id || ''} onChange={e => setSelectedBusinessId(e.target.value)}>
                  {businessInsights.businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              {selectedBusiness && (
                <div className="business-detail">
                  <div className="business-score-card">
                    <span className={`health-score ${getScoreClass(selectedBusiness.healthScore)}`}>{selectedBusiness.healthScore}</span>
                    <div>
                      <h4>{selectedBusiness.name}</h4>
                      <p>{selectedBusiness.ownerName || 'Sem responsavel'} · {PLAN_LABELS[selectedBusiness.plan] || selectedBusiness.plan}</p>
                      <span className={`badge badge-sub-${selectedBusiness.subscriptionStatus}`}>
                        {STATUS_LABELS[selectedBusiness.subscriptionStatus] || selectedBusiness.subscriptionStatus}
                      </span>
                    </div>
                  </div>
                  <div className="business-metrics">
                    <div><span>Faturamento</span><strong>{formatCurrency(selectedBusiness.periodRevenue)}</strong>{renderGrowth(selectedBusiness.revenueGrowthPct)}</div>
                    <div><span>Vendas</span><strong>{selectedBusiness.salesCount}</strong>{renderGrowth(selectedBusiness.salesGrowthPct)}</div>
                    <div><span>Ticket medio</span><strong>{formatCurrency(selectedBusiness.averageTicket)}</strong></div>
                    <div><span>Produtos</span><strong>{selectedBusiness.productCount}</strong><small>{selectedBusiness.lowStockCount} em estoque baixo</small></div>
                    <div><span>Usuarios ativos</span><strong>{selectedBusiness.activeUsers}</strong><small>{selectedBusiness.userCount} cadastrados</small></div>
                    <div><span>Ultima venda</span><strong>{formatDate(selectedBusiness.lastSaleAt || undefined)}</strong></div>
                  </div>
                  <div className="business-products">
                    <h4>Produtos mais vendidos</h4>
                    {selectedBusiness.topProducts.length === 0 ? (
                      <p>Nenhum produto vendido neste periodo.</p>
                    ) : selectedBusiness.topProducts.map(product => (
                      <div className="platform-list-row" key={product.name}>
                        <span>{product.name}</span>
                        <strong>{product.quantity} un · {formatCurrency(product.revenue)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <div className="ranking-grid">
              <section className="business-section">
                <div className="business-section-header compact">
                  <div>
                    <h3>5 melhores</h3>
                    <p>Maior pontuacao de saude operacional.</p>
                  </div>
                </div>
                <div className="ranking-list">
                  {businessInsights.topFive.map((item, index) => (
                    <div className="ranking-row" key={item.id}>
                      <span className="ranking-position">{index + 1}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{formatCurrency(item.periodRevenue)} · {item.salesCount} vendas</small>
                      </div>
                      <span className={`health-score small ${getScoreClass(item.healthScore)}`}>{item.healthScore}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="business-section">
                <div className="business-section-header compact">
                  <div>
                    <h3>5 em atencao</h3>
                    <p>Menor pontuacao no periodo selecionado.</p>
                  </div>
                </div>
                <div className="ranking-list">
                  {businessInsights.bottomFive.map((item, index) => (
                    <div className="ranking-row" key={item.id}>
                      <span className="ranking-position">{index + 1}</span>
                      <div>
                        <strong>{item.name}</strong>
                        <small>{formatCurrency(item.periodRevenue)} · {item.lowStockCount} alertas estoque</small>
                      </div>
                      <span className={`health-score small ${getScoreClass(item.healthScore)}`}>{item.healthScore}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="business-section">
              <div className="business-section-header compact">
                <div>
                  <h3>Comparacao geral</h3>
                  <p>Todos os negocios lado a lado no mesmo periodo.</p>
                </div>
              </div>
              <div className="business-table-wrap">
                <table className="business-table">
                  <thead>
                    <tr>
                      <th>Negocio</th>
                      <th>Score</th>
                      <th>Faturamento</th>
                      <th>Cresc.</th>
                      <th>Vendas</th>
                      <th>Ticket</th>
                      <th>Usuarios</th>
                      <th>Estoque</th>
                      <th>Ultima venda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {businessInsights.businesses.map(item => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>{STATUS_LABELS[item.subscriptionStatus] || item.subscriptionStatus}</small>
                        </td>
                        <td><span className={`health-score small ${getScoreClass(item.healthScore)}`}>{item.healthScore}</span></td>
                        <td>{formatCurrency(item.periodRevenue)}</td>
                        <td>{renderGrowth(item.revenueGrowthPct)}</td>
                        <td>{item.salesCount}</td>
                        <td>{formatCurrency(item.averageTicket)}</td>
                        <td>{item.activeUsers}/{item.userCount}</td>
                        <td>{item.lowStockCount} baixo · {item.outOfStockCount} zerado</td>
                        <td>{formatDate(item.lastSaleAt || undefined)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
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
                  <div className="est-login-code"><Building2 size={12} />{est.loginCode}</div>
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

                  {est.usage && est.planDefinition && (
                    <div className="est-plan-usage">
                      <span>Produtos {est.usage.products}/{formatLimit(est.planDefinition.limits.maxProducts)}</span>
                      <span>Contas {est.usage.paymentAccounts}/{formatLimit(est.planDefinition.limits.maxPaymentAccounts)}</span>
                    </div>
                  )}

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
          <div className="platform-toolbar">
            <div>
              <h2>Cobrancas da plataforma</h2>
              <p>Vencimentos, tolerancia, suspensoes e pagamentos registrados.</p>
            </div>
            <button className="btn btn-secondary" onClick={handleReconcileSubscriptions}>
              <RefreshCw size={15} /> Atualizar assinaturas
            </button>
          </div>
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

      {/* ===== TAB: AUDITORIA ===== */}
      {tab === 'audit' && (
        <div className="audit-dashboard">
          <div className="platform-toolbar">
            <div>
              <h2>Auditoria da plataforma</h2>
              <p>Registro de acoes sensiveis feitas por gestores e pelo SuperAdmin.</p>
            </div>
            <button className="btn btn-secondary" onClick={loadData}>
              <RefreshCw size={15} /> Atualizar
            </button>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Acao</th>
                  <th>Estabelecimento</th>
                  <th>Ator</th>
                  <th>Entidade</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="audit-empty">Nenhum evento registrado ainda.</td>
                  </tr>
                ) : auditLogs.map(log => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td><strong>{actionLabels[log.action] || log.action}</strong></td>
                    <td>{log.establishmentName || log.establishmentId || 'Plataforma'}</td>
                    <td>
                      <span>{log.actorName || log.actorUsername || log.actorRole || 'Sistema'}</span>
                      {log.actorRole && <small>{log.actorRole}</small>}
                    </td>
                    <td>
                      <span>{log.entityType || '-'}</span>
                      {log.entityId && <small>{log.entityId.slice(0, 8)}</small>}
                    </td>
                    <td>{summarizeAuditMetadata(log.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <div className="form-group">
            <label>Codigo de acesso *</label>
            <input className="form-control" required value={formData.loginCode}
              onChange={e => setFormData(p => ({ ...p, loginCode: e.target.value }))}
              placeholder="Ex: distribuidora-sao-joao" />
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
              {selectedPlan && (
                <div className="plan-limits-box compact">
                  <strong>{selectedPlan.label}</strong>
                  <span>Usuarios {formatLimit(selectedPlan.limits.maxUsers)} | Operadores {formatLimit(selectedPlan.limits.maxOperators)} | Produtos {formatLimit(selectedPlan.limits.maxProducts)} | Contas {formatLimit(selectedPlan.limits.maxPaymentAccounts)}</span>
                </div>
              )}
              <select className="form-control" value={formData.plan}
                onChange={e => setFormData(p => ({ ...p, plan: e.target.value as Plan }))}>
                {planOptions.map(plan => (
                  <option key={plan.key} value={plan.key}>{plan.label}</option>
                ))}
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
            <label>Dias de tolerancia</label>
            <input className="form-control" type="number" min="0" max="90" value={formData.subscriptionGraceDays}
              onChange={e => setFormData(p => ({ ...p, subscriptionGraceDays: e.target.value }))} />
            <small style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
              A suspensao automatica ocorre no dia seguinte ao fim deste periodo.
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
        <div className="form-group">
          <label>Dias de tolerância</label>
          <input className="form-control" type="number" min="0" max="90" value={subData.subscriptionGraceDays}
            onChange={e => setSubData(p => ({ ...p, subscriptionGraceDays: e.target.value }))} />
        </div>
        <div className="form-actions">
          <button className="btn btn-secondary" onClick={() => setIsSubModalOpen(false)}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSubSave}>Salvar</button>
        </div>
      </Modal>

      {/* ===== MODAL: USUÁRIOS ===== */}
      <Modal isOpen={isUsersModalOpen} onClose={() => setIsUsersModalOpen(false)}
        title={`Usuários — ${selectedEst?.name}`}>
        <div className="est-users-toolbar">
          <div>
            <strong>{estUsers.length} de {formatLimit(selectedEst?.planDefinition?.limits.maxUsers)} usuarios</strong>
            <span>O gestor ja esta incluido neste total.</span>
          </div>
          <button className="btn btn-primary btn-sm" type="button" onClick={openCreateUser}>
            <UserPlus size={14} /> Adicionar funcionario
          </button>
        </div>
        {userFormMode && (
          <form className="est-user-editor" onSubmit={handleUserFormSubmit}>
            <div className="form-section-title">
              {userFormMode === 'create' ? 'Novo funcionario' : `Redefinir senha de ${userForm.name}`}
            </div>
            {userFormError && <div className="user-form-error">{userFormError}</div>}
            {userFormMode === 'create' && (
              <div className="form-row">
                <div className="form-group">
                  <label>Nome *</label>
                  <input className="form-control" required value={userForm.name}
                    onChange={e => setUserForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Login *</label>
                  <input className="form-control" required value={userForm.username}
                    onChange={e => setUserForm(p => ({ ...p, username: e.target.value }))} />
                </div>
              </div>
            )}
            <div className="form-group">
              <label>Senha temporaria *</label>
              <input className="form-control" type="password" minLength={8} required value={userForm.password}
                autoComplete="new-password"
                onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} />
              <small>Minimo de 8 caracteres.</small>
            </div>
            <div className="form-actions compact-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setUserFormMode(null)}>Cancelar</button>
              <button className="btn btn-primary" type="submit" disabled={userFormSaving}>
                {userFormSaving ? 'Salvando...' : userFormMode === 'create' ? 'Criar usuario' : 'Redefinir senha'}
              </button>
            </div>
          </form>
        )}

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
              <button className="btn btn-secondary btn-icon btn-sm" type="button"
                onClick={() => openPasswordReset(u)} title="Redefinir senha" aria-label={`Redefinir senha de ${u.name}`}>
                <KeyRound size={14} />
              </button>
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
            <div className="billing-summary-item">
              <span className="bs-label">Tolerância</span>
              <span className="bs-value">{selectedEst.billing?.graceDays ?? selectedEst.subscriptionGraceDays ?? 7} dias</span>
            </div>
            {selectedEst.billing?.suspensionDate && selectedEst.billing.status !== 'active' && (
              <div className="billing-summary-item">
                <span className="bs-label">Suspensão prevista</span>
                <span className="bs-value">{formatDate(selectedEst.billing.suspensionDate)}</span>
              </div>
            )}
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
