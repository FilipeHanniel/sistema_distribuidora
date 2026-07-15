import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, PackagePlus, ShoppingCart, BarChart3, Users as UsersIcon,
  Sun, Moon, LogOut, KeyRound, ClipboardList, ChevronDown, Menu, X,
  Building2, Crown, CreditCard, Bell, CheckCheck, FileText, WalletCards, SlidersHorizontal,
  AlertTriangle, ShieldX, RefreshCw
} from 'lucide-react';
import './layout.css';

import Dashboard from '../pages/Dashboard';
import Inventory from '../pages/Inventory';
import Purchases from '../pages/Purchases';
import Sales from '../pages/Sales';
import Analytics from '../pages/Analytics';
import Users from '../pages/Users';
import SalesHistory from '../pages/SalesHistory';
import SuperAdmin from '../pages/SuperAdmin';
import PixSettings from '../pages/PixSettings';
import FiscalSettings from '../pages/FiscalSettings';
import PaymentTransactions from '../pages/PaymentTransactions';
import EstablishmentSettings from '../pages/EstablishmentSettings';
import StockAlertPopup from '../components/StockAlertPopup';
import SaleSuccessPopup from '../components/SaleSuccessPopup';
import PasswordModal from '../components/PasswordModal';
import Login from '../pages/Login';

import { useInventoryStore } from '../store/useInventoryStore';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../store/useAuthStore';
import { useUserStore } from '../store/useUserStore';
import { DEFAULT_UI_SETTINGS, useSettingsStore } from '../store/useSettingsStore';
import { apiRequest } from '../lib/api';
import type { AppNotification, TenantStatus } from '../types';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Painel de Gestão',
  '/inventory': 'Controle de Estoque',
  '/purchases': 'Compras e Fornecedores',
  '/sales': 'Ponto de Venda',
  '/analytics': 'Relatorios Operacionais',
  '/users': 'Funcionários',
  '/comprovantes': 'Comprovantes de Venda',
  '/pix': 'Recebimentos',
  '/transactions': 'Transacoes e Conciliacao',
  '/fiscal': 'Fiscal NFC-e',
  '/settings': 'Configuracoes do Estabelecimento',
  '/superadmin': 'Painel Super Admin',
};

function TopbarTitle() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Distribuidora';
  return <span className="topbar-page-title">{title}</span>;
}

const notificationLabels: Record<string, { label: string; tone: 'stock' | 'payment' | 'fiscal' | 'purchase' | 'platform' | 'ai' | 'default' }> = {
  inventory_rupture_risk: { label: 'Estoque', tone: 'stock' },
  inventory_low_stock: { label: 'Estoque', tone: 'stock' },
  inventory_stagnant: { label: 'Estoque', tone: 'stock' },
  purchase_received: { label: 'Compra', tone: 'purchase' },
  payment_error: { label: 'Pagamento', tone: 'payment' },
  payment_pending: { label: 'Pagamento', tone: 'payment' },
  fiscal_rejected: { label: 'Fiscal', tone: 'fiscal' },
  fiscal_pending: { label: 'Fiscal', tone: 'fiscal' },
  fiscal_sale_without_authorization: { label: 'Fiscal', tone: 'fiscal' },
  subscription_due_soon: { label: 'Plataforma', tone: 'platform' },
  subscription_overdue: { label: 'Plataforma', tone: 'platform' },
  subscription_suspended: { label: 'Plataforma', tone: 'platform' },
  subscription_payment_registered: { label: 'Plataforma', tone: 'platform' },
  ai_report_daily: { label: 'IA', tone: 'ai' },
  ai_report_weekly: { label: 'IA', tone: 'ai' },
};

const notificationMeta = (type: string) => notificationLabels[type] || { label: 'Aviso', tone: 'default' as const };

const formatNotificationTime = (value?: string) => {
  if (!value) return '';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const referenceLabel = (item: AppNotification) => {
  if (!item.referenceType) return '';
  const labels: Record<string, string> = {
    product: 'Produto',
    purchase: 'Compra',
    payment_transaction: 'Transacao',
    fiscal_document: 'Documento fiscal',
    sale: 'Venda',
    subscription: 'Assinatura',
    ai_report: 'Relatorio',
  };
  return labels[item.referenceType] || item.referenceType;
};

export default function AppLayout() {
  const { fetchProducts, clearProducts } = useInventoryStore();
  const { fetchSales, clearSalesSession } = useSalesStore();
  const { user, logout, isAuthenticated, isSuperAdmin, isGestor, isOperador } = useAuthStore();
  const { fetchUsers, clearUsers } = useUserStore();
  const { settings, fetchSettings, clearSettings } = useSettingsStore();
  const { lastSale, showSuccessPopup, closeSuccessPopup } = useSalesStore();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tenantStatus, setTenantStatus] = useState<TenantStatus | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');

  const superAdmin = isSuperAdmin();
  const gestor = isGestor();
  const operador = isOperador();

  useEffect(() => {
    clearProducts();
    clearSalesSession();
    clearUsers();
    clearSettings();
    setNotifications([]);
    setTenantStatus(null);

    if (!isAuthenticated()) return;

    if (!superAdmin) {
      fetchProducts();
      fetchSettings().catch(() => undefined);
      if (gestor) {
        fetchSales();
        fetchUsers();
      }
    }
  }, [
    user?.id,
    fetchProducts,
    clearProducts,
    fetchSales,
    clearSalesSession,
    fetchUsers,
    clearUsers,
    fetchSettings,
    clearSettings,
    isAuthenticated,
    superAdmin,
    gestor,
  ]);

  useEffect(() => {
    if (isDark) {
      document.body.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadNotifications = useCallback(async (sync = false) => {
    if (!gestor || !isAuthenticated()) return;
    try {
      if (sync) await apiRequest('/notifications/sync', { method: 'POST' });
      const rows = await apiRequest<AppNotification[]>('/notifications');
      setNotifications(rows);
    } catch {
      setNotifications([]);
    }
  }, [gestor, isAuthenticated]);

  useEffect(() => {
    if (!gestor || !isAuthenticated()) return;
    loadNotifications();
    const timer = window.setInterval(loadNotifications, 60000);
    return () => window.clearInterval(timer);
  }, [gestor, isAuthenticated, loadNotifications]);

  useEffect(() => {
    if (superAdmin || !isAuthenticated()) return;
    const loadTenantStatus = () => {
      apiRequest<TenantStatus>('/tenant/status')
        .then(setTenantStatus)
        .catch(() => setTenantStatus(null));
    };
    loadTenantStatus();
    const timer = window.setInterval(loadTenantStatus, 60000);
    return () => window.clearInterval(timer);
  }, [user?.id, superAdmin, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated()) return;
    const validateSession = () => {
      apiRequest<{ status: string }>('/session').catch(() => undefined);
    };
    validateSession();
    const timer = window.setInterval(validateSession, 30000);
    return () => window.clearInterval(timer);
  }, [user?.id, isAuthenticated]);

  if (!isAuthenticated()) return <Login />;

  // ---- Navegação por perfil ----
  type NavItem = { to: string; icon: ReactNode; label: string; end?: boolean };

  let navItems: NavItem[] = [];
  if (superAdmin) {
    navItems = [
      { to: '/superadmin', icon: <Crown size={20} />, label: 'Painel Geral', end: true },
    ];
  } else if (gestor) {
    navItems = [
      { to: '/', icon: <LayoutDashboard size={20} />, label: 'Painel', end: true },
      { to: '/inventory', icon: <Package size={20} />, label: 'Estoque' },
      { to: '/purchases', icon: <PackagePlus size={20} />, label: 'Compras' },
      { to: '/sales', icon: <ShoppingCart size={20} />, label: 'Ponto de Venda' },
      { to: '/analytics', icon: <BarChart3 size={20} />, label: 'Relatorios' },
      { to: '/users', icon: <UsersIcon size={20} />, label: 'Funcionários' },
      { to: '/pix', icon: <CreditCard size={20} />, label: 'Recebimentos' },
      { to: '/transactions', icon: <WalletCards size={20} />, label: 'Transacoes' },
      { to: '/fiscal', icon: <FileText size={20} />, label: 'Fiscal NFC-e' },
      { to: '/comprovantes', icon: <ClipboardList size={20} />, label: 'Comprovantes' },
      { to: '/settings', icon: <SlidersHorizontal size={20} />, label: 'Configuracoes' },
    ];
  } else {
    // operador
    navItems = [
      { to: '/sales', icon: <ShoppingCart size={20} />, label: 'Ponto de Venda', end: true },
      { to: '/comprovantes', icon: <ClipboardList size={20} />, label: 'Comprovantes do Dia' },
    ];
  }

  const roleLabel = superAdmin ? 'Super Admin' : gestor ? 'Gestor' : 'Operador';
  const roleColor = superAdmin ? '#f59e0b' : gestor ? 'var(--primary)' : '#16a34a';
  const brandName = !superAdmin && user?.establishmentName ? user.establishmentName : 'Distribuidora';
  const brandCaption = superAdmin ? 'v2.0' : roleLabel;
  const unreadNotifications = notifications.filter(n => !n.readAt).length;

  const markNotificationRead = async (id: string) => {
    await apiRequest(`/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
  };

  const markAllNotificationsRead = async () => {
    await apiRequest('/notifications/read-all', { method: 'PATCH' });
    const now = new Date().toISOString();
    setNotifications(prev => prev.map(n => ({ ...n, readAt: n.readAt || now })));
  };

  const handleLogout = () => {
    clearProducts();
    clearSalesSession();
    clearUsers();
    clearSettings();
    setNotifications([]);
    setTenantStatus(null);
    logout();
  };

  return (
    <BrowserRouter>
      <div className="app-layout">

        {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}

        {/* Sidebar */}
        <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-header">
            <div className="brand">
              <div className="logo-mark">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="10" y="14" width="12" height="14" rx="3" fill="url(#brandGrad)" />
                  <rect x="13" y="6" width="6" height="9" rx="1.5" fill="url(#brandGrad)" />
                  <rect x="12" y="4" width="8" height="3" rx="1.5" fill="#8b5cf6" />
                  <rect x="10" y="19" width="12" height="4" rx="0" fill="rgba(255,255,255,0.25)" />
                  <circle cx="26" cy="8" r="1.5" fill="#facc15" />
                  <path d="M26 4.5V6M26 10V11.5M22.5 8H24M28 8H29.5" stroke="#facc15" strokeWidth="1" strokeLinecap="round" />
                  <path d="M7 12C7 12 5 14.5 5 16C5 17.1 5.9 18 7 18C8.1 18 9 17.1 9 16C9 14.5 7 12 7 12Z" fill="#38bdf8" opacity="0.7" />
                  <defs>
                    <linearGradient id="brandGrad" x1="10" y1="4" x2="22" y2="28" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#005CB9" />
                      <stop offset="1" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="brand-text">
                <h2 title={brandName}>{brandName}</h2>
                <span className="brand-version">{brandCaption}</span>
              </div>
            </div>
            <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>

          {/* Badge de estabelecimento */}
          {!superAdmin && user?.establishmentName && (
            <div className="sidebar-est-badge">
              <Building2 size={13} />
              <span>{user.establishmentName}</span>
            </div>
          )}

          <div className="sidebar-section-label">Menu Principal</div>

          <nav className="sidebar-nav">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setIsSidebarOpen(false)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-footer">
            <button className="theme-toggle" onClick={() => setIsDark(!isDark)}>
              {isDark ? <><Sun size={16} /> Modo Claro</> : <><Moon size={16} /> Modo Escuro</>}
            </button>
            <button className="logout-btn" onClick={handleLogout}>
              <LogOut size={16} /> Sair do Sistema
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="main-content">
          <header className="topbar">
            <div className="topbar-left">
              <button className="hamburger-btn" onClick={() => setIsSidebarOpen(true)}>
                <Menu size={20} />
              </button>
              <TopbarTitle />
            </div>

            <div className="topbar-right">
              {gestor && (
                <div className="notifications-menu" ref={notificationsRef}>
                  <button className={`notification-button ${isNotificationsOpen ? 'active' : ''}`} onClick={() => setIsNotificationsOpen(!isNotificationsOpen)} aria-label="Notificacoes">
                    <Bell size={18} />
                    {unreadNotifications > 0 && <span className="notification-count">{unreadNotifications}</span>}
                  </button>
                  {isNotificationsOpen && (
                    <div className="notifications-dropdown">
                      <div className="notifications-header">
                        <strong>Notificacoes</strong>
                        <div>
                          <button onClick={() => loadNotifications(true)}><RefreshCw size={14} /> Atualizar</button>
                          {unreadNotifications > 0 && (
                            <button onClick={markAllNotificationsRead}><CheckCheck size={14} /> Ler todas</button>
                          )}
                        </div>
                      </div>
                      <div className="notifications-list">
                        {notifications.length === 0 ? (
                          <div className="notification-empty">Nenhuma notificacao.</div>
                        ) : notifications.map(item => {
                          const meta = notificationMeta(item.type);
                          const ref = referenceLabel(item);
                          return (
                            <button key={item.id} className={`notification-item ${item.readAt ? '' : 'unread'}`} onClick={() => markNotificationRead(item.id)}>
                              <div className="notification-item-top">
                                <span className={`notification-type ${meta.tone}`}>{meta.label}</span>
                                <small>{formatNotificationTime(item.createdAt)}</small>
                              </div>
                              <span className="notification-title">{item.title}</span>
                              <small className="notification-message">{item.message}</small>
                              {ref && <em className="notification-reference">{ref}</em>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="user-profile-menu" ref={userMenuRef}>
                <div
                  className={`user-info ${isUserMenuOpen ? 'active' : ''}`}
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                >
                  <div className="avatar" style={{ background: `linear-gradient(135deg, ${roleColor}, #8b5cf6)` }}>
                    {user?.name ? user.name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="user-details">
                    <span className="user-name">{user?.name}</span>
                    <span className="user-role" style={{ color: roleColor }}>{roleLabel}</span>
                  </div>
                  <ChevronDown size={16} className={`chevron ${isUserMenuOpen ? 'open' : ''}`} />
                </div>

                {isUserMenuOpen && (
                  <div className="profile-dropdown">
                    <div className="dropdown-header">
                      <div className="avatar avatar-lg" style={{ background: `linear-gradient(135deg, ${roleColor}, #8b5cf6)` }}>
                        {user?.name ? user.name[0].toUpperCase() : 'U'}
                      </div>
                      <div>
                        <div className="dropdown-name">{user?.name}</div>
                        <div className="dropdown-role" style={{ color: roleColor }}>{roleLabel}</div>
                        {user?.establishmentName && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                            {user.establishmentName}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="dropdown-divider" />
                    <button onClick={() => { setIsPasswordModalOpen(true); setIsUserMenuOpen(false); }}>
                      <KeyRound size={16} /> Alterar Senha
                    </button>
                    <button onClick={handleLogout} className="logout-item">
                      <LogOut size={16} /> Sair do Sistema
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {tenantStatus?.billing.status === 'overdue' && (
            <div className="subscription-banner subscription-banner--overdue" role="status" aria-live="polite">
              <AlertTriangle size={18} />
              <div>
                <strong>Mensalidade em atraso</strong>
                <span>
                  {tenantStatus.billing.daysPastDue} dia{tenantStatus.billing.daysPastDue === 1 ? '' : 's'} de atraso.
                  {tenantStatus.billing.suspensionDate && ` Operações serão suspensas em ${new Date(tenantStatus.billing.suspensionDate).toLocaleDateString('pt-BR')}.`}
                </span>
              </div>
            </div>
          )}

          {tenantStatus?.billing.status === 'suspended' && (
            <div className="subscription-banner subscription-banner--suspended" role="alert">
              <ShieldX size={18} />
              <div>
                <strong>Assinatura suspensa</strong>
                <span>Vendas e alterações estão bloqueadas. Regularize a mensalidade com o administrador da plataforma.</span>
              </div>
            </div>
          )}

          <div className="content-scroll">
            <Routes>
              {/* Super Admin routes */}
              <Route path="/superadmin" element={superAdmin ? <SuperAdmin /> : <Navigate to={gestor ? '/' : '/sales'} />} />

              {/* Gestor routes */}
              <Route path="/" element={!operador ? <Dashboard /> : <Navigate to="/sales" />} />
              <Route path="/inventory" element={gestor ? <Inventory /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/purchases" element={gestor ? <Purchases /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/analytics" element={gestor ? <Analytics /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/users" element={gestor ? <Users /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/pix" element={gestor ? <PixSettings /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/transactions" element={gestor ? <PaymentTransactions /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/fiscal" element={gestor ? <FiscalSettings /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />
              <Route path="/settings" element={gestor ? <EstablishmentSettings /> : <Navigate to={superAdmin ? '/superadmin' : '/sales'} />} />

              {/* Shared routes */}
              <Route path="/sales" element={!superAdmin ? <Sales /> : <Navigate to="/superadmin" />} />
              <Route path="/comprovantes" element={!superAdmin ? <SalesHistory /> : <Navigate to="/superadmin" />} />

              {/* Default redirect */}
              <Route path="*" element={
                superAdmin ? <Navigate to="/superadmin" /> :
                gestor ? <Navigate to="/" /> :
                <Navigate to="/sales" />
              } />
            </Routes>
          </div>
        </main>

        {isPasswordModalOpen && <PasswordModal onClose={() => setIsPasswordModalOpen(false)} />}

        {showSuccessPopup && lastSale && (
          <SaleSuccessPopup
            totalAmount={lastSale.amount}
            paymentMethod={lastSale.method}
            operatorName={user?.name ?? 'Operador'}
            saleId={lastSale.id}
            items={lastSale.items}
            createdAt={lastSale.createdAt}
            fiscalDocument={lastSale.fiscalDocument}
            establishmentName={settings?.name || user?.establishmentName || ''}
            receiptFooter={settings?.receiptFooter || DEFAULT_UI_SETTINGS.receiptFooter}
            autoClose={(settings?.receiptAutoCloseSeconds ?? DEFAULT_UI_SETTINGS.receiptAutoCloseSeconds) > 0}
            autoCloseSeconds={settings?.receiptAutoCloseSeconds ?? DEFAULT_UI_SETTINGS.receiptAutoCloseSeconds}
            onClose={closeSuccessPopup}
          />
        )}

        <StockAlertPopup />
      </div>
    </BrowserRouter>
  );
}
