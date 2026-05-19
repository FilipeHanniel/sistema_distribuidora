import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2, Users, TrendingUp, ShieldCheck, ShieldAlert, ShieldX,
  Plus, Edit2, Trash2, RefreshCw, Mail, Phone, Calendar,
  DollarSign, ShoppingCart, Eye, Crown, AlertTriangle, CheckCircle2
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

const getDueDays = (iso?: string) => {
  if (!iso) return null;
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
  return diff;
};

const PLAN_LABELS: Record<string, string> = { basic: 'Básico', premium: 'Premium', enterprise: 'Enterprise' };
const STATUS_LABELS: Record<string, string> = { active: 'Ativo', overdue: 'Em Atraso', suspended: 'Suspenso' };

interface Stats {
  total: number;
  active: number;
  overdue: number;
  suspended: number;
  totalUsers: number;
  totalRevenue: number;
  totalSales: number;
}

interface EstUser {
  id: string;
  username: string;
  name: string;
  role: string;
  active: number;
}

const emptyForm = {
  name: '', ownerName: '', email: '', phone: '', plan: 'basic' as const,
  subscriptionStatus: 'active' as const, subscriptionDueDate: '', notes: '',
  gestorUsername: '', gestorPassword: '', gestorName: '',
};

export default function SuperAdmin() {
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEst, setEditingEst] = useState<Establishment | null>(null);
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [isUsersModalOpen, setIsUsersModalOpen] = useState(false);
  const [selectedEst, setSelectedEst] = useState<Establishment | null>(null);
  const [estUsers, setEstUsers] = useState<EstUser[]>([]);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [subData, setSubData] = useState({ subscriptionStatus: 'active', subscriptionDueDate: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [estRes, statsRes] = await Promise.all([
        fetch(`${API}/admin/establishments`, { headers: getHeaders() }),
        fetch(`${API}/admin/stats`, { headers: getHeaders() }),
      ]);
      if (estRes.ok) setEstablishments(await estRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setEditingEst(null);
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    setFormData({ ...emptyForm, subscriptionDueDate: nextMonth.toISOString().split('T')[0] });
    setIsFormOpen(true);
  };

  const openEdit = (est: Establishment) => {
    setEditingEst(est);
    setFormData({
      name: est.name, ownerName: est.ownerName || '', email: est.email || '',
      phone: est.phone || '', plan: est.plan, subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
      notes: est.notes || '', gestorUsername: '', gestorPassword: '', gestorName: '',
    });
    setIsFormOpen(true);
  };

  const openSubModal = (est: Establishment) => {
    setSelectedEst(est);
    setSubData({
      subscriptionStatus: est.subscriptionStatus,
      subscriptionDueDate: est.subscriptionDueDate ? est.subscriptionDueDate.split('T')[0] : '',
    });
    setIsSubModalOpen(true);
  };

  const openUsersModal = async (est: Establishment) => {
    setSelectedEst(est);
    setIsUsersModalOpen(true);
    const res = await fetch(`${API}/admin/establishments/${est.id}/users`, { headers: getHeaders() });
    if (res.ok) setEstUsers(await res.json());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dueDateISO = formData.subscriptionDueDate ? new Date(formData.subscriptionDueDate).toISOString() : undefined;
    if (editingEst) {
      const res = await fetch(`${API}/admin/establishments/${editingEst.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ ...formData, subscriptionDueDate: dueDateISO }),
      });
      if (res.ok) { setIsFormOpen(false); loadData(); }
      else { const d = await res.json(); alert(d.error); }
    } else {
      const res = await fetch(`${API}/admin/establishments`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ ...formData, subscriptionDueDate: dueDateISO }),
      });
      if (res.ok) { setIsFormOpen(false); loadData(); }
      else { const d = await res.json(); alert(d.error); }
    }
  };

  const handleSubSave = async () => {
    if (!selectedEst) return;
    const dueDateISO = subData.subscriptionDueDate ? new Date(subData.subscriptionDueDate).toISOString() : undefined;
    const res = await fetch(`${API}/admin/establishments/${selectedEst.id}/subscription`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ ...subData, subscriptionDueDate: dueDateISO }),
    });
    if (res.ok) { setIsSubModalOpen(false); loadData(); }
  };

  const handleDelete = async (est: Establishment) => {
    if (!confirm(`Excluir "${est.name}"? Todos os usuários serão desativados.`)) return;
    const res = await fetch(`${API}/admin/establishments/${est.id}`, {
      method: 'DELETE', headers: getHeaders(),
    });
    if (res.ok) loadData();
  };

  const renderDueInfo = (est: Establishment) => {
    const days = getDueDays(est.subscriptionDueDate);
    if (days === null) return null;
    let cls = '';
    let icon = <Calendar size={14} />;
    if (days < 0) { cls = 'overdue'; icon = <AlertTriangle size={14} />; }
    else if (days <= 7) { cls = 'warning'; icon = <AlertTriangle size={14} />; }
    return (
      <div className={`est-due-info ${cls}`}>
        {icon}
        {days < 0 ? `Vencido há ${Math.abs(days)} dias` :
         days === 0 ? 'Vence hoje!' :
         `Vence em ${days} dias (${formatDate(est.subscriptionDueDate)})`}
      </div>
    );
  };

  const statCards = stats ? [
    { label: 'Estabelecimentos', value: stats.total, icon: <Building2 size={20} />, color: 'blue' },
    { label: 'Assinaturas Ativas', value: stats.active, icon: <CheckCircle2 size={20} />, color: 'green' },
    { label: 'Em Atraso', value: stats.overdue, icon: <AlertTriangle size={20} />, color: 'amber' },
    { label: 'Suspensos', value: stats.suspended, icon: <ShieldX size={20} />, color: 'red' },
    { label: 'Total de Usuários', value: stats.totalUsers, icon: <Users size={20} />, color: 'purple' },
    { label: 'Faturamento Total', value: formatCurrency(stats.totalRevenue), icon: <TrendingUp size={20} />, color: 'teal' },
  ] : [];

  return (
    <div className="page-container superadmin-page">
      <div className="sa-header">
        <div>
          <h1><Crown size={28} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />Painel Super Admin</h1>
          <p className="subtitle">Gestão centralizada de todos os estabelecimentos e assinaturas</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={loadData}>
            <RefreshCw size={16} /> Atualizar
          </button>
          <button className="btn btn-primary" onClick={openCreate}>
            <Plus size={16} /> Novo Estabelecimento
          </button>
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

      {/* Establishments Grid */}
      <div className="sa-toolbar">
        <h2>Estabelecimentos ({establishments.length})</h2>
      </div>

      {loading ? (
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
            return (
              <div key={est.id} className="est-card">
                <div className="est-card-top">
                  <div className="est-avatar">{est.name[0].toUpperCase()}</div>
                  <div className="est-badges">
                    <span className={`badge badge-plan-${est.plan}`}>{PLAN_LABELS[est.plan] || est.plan}</span>
                    <span className={`badge badge-sub-${est.subscriptionStatus}`}>{STATUS_LABELS[est.subscriptionStatus]}</span>
                  </div>
                </div>

                <div className="est-name">{est.name}</div>
                {est.ownerName && <div className="est-owner">{est.ownerName}</div>}
                {est.email && (
                  <div className="est-contact"><Mail size={12} />{est.email}</div>
                )}
                {est.phone && (
                  <div className="est-contact"><Phone size={12} />{est.phone}</div>
                )}

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
                    <span className="est-meta-label">Mês</span>
                    <span className="est-meta-value" style={{ fontSize: '0.875rem' }}>
                      {formatCurrency(est.revenueMonth ?? 0)}
                    </span>
                  </div>
                </div>

                {renderDueInfo(est)}

                <div className="est-actions">
                  <button className="btn btn-secondary" onClick={() => openUsersModal(est)} title="Ver usuários">
                    <Eye size={14} /> Usuários
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => openSubModal(est)}
                    title="Gerenciar assinatura"
                    style={{ color: days !== null && days < 0 ? '#dc2626' : undefined }}
                  >
                    <ShieldCheck size={14} /> Assinatura
                  </button>
                  <button className="btn btn-secondary" onClick={() => openEdit(est)} title="Editar">
                    <Edit2 size={14} />
                  </button>
                  <button className="btn btn-danger" onClick={() => handleDelete(est)} title="Excluir">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Modal: Criar / Editar Estabelecimento ---- */}
      <Modal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editingEst ? `Editar — ${editingEst.name}` : 'Novo Estabelecimento'}
      >
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
                onChange={e => setFormData(p => ({ ...p, plan: e.target.value as any }))}>
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
              <label>Status da Assinatura</label>
              <select className="form-control" value={formData.subscriptionStatus}
                onChange={e => setFormData(p => ({ ...p, subscriptionStatus: e.target.value as any }))}>
                <option value="active">Ativo</option>
                <option value="overdue">Em Atraso</option>
                <option value="suspended">Suspenso</option>
              </select>
            </div>
            <div className="form-group">
              <label>Vencimento da Assinatura</label>
              <input className="form-control" type="date" value={formData.subscriptionDueDate}
                onChange={e => setFormData(p => ({ ...p, subscriptionDueDate: e.target.value }))} />
            </div>
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

      {/* ---- Modal: Gerenciar Assinatura ---- */}
      <Modal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        title={`Assinatura — ${selectedEst?.name}`}
      >
        <div className="form-group">
          <label>Status da Assinatura</label>
          <select className="form-control" value={subData.subscriptionStatus}
            onChange={e => setSubData(p => ({ ...p, subscriptionStatus: e.target.value }))}>
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

      {/* ---- Modal: Usuários do Estabelecimento ---- */}
      <Modal
        isOpen={isUsersModalOpen}
        onClose={() => setIsUsersModalOpen(false)}
        title={`Usuários — ${selectedEst?.name}`}
      >
        <div className="est-users-list">
          {estUsers.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem' }}>
              Nenhum usuário encontrado.
            </p>
          ) : estUsers.map(u => (
            <div key={u.id} className="est-user-row">
              <div className="est-user-avatar">{u.name[0].toUpperCase()}</div>
              <div className="est-user-info">
                <div className="est-user-name">{u.name}</div>
                <div className="est-user-username">@{u.username}</div>
              </div>
              <span className={`est-user-role role-${u.role}`}>
                {u.role === 'gestor' ? 'Gestor' : 'Operador'}
              </span>
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
    </div>
  );
}
