import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, ShoppingCart, BarChart3, Users as UsersIcon,
  Sun, Moon, LogOut, KeyRound, ClipboardList, ChevronDown, Menu, X
} from 'lucide-react';
import './layout.css';

import Dashboard from '../pages/Dashboard';
import Inventory from '../pages/Inventory';
import Sales from '../pages/Sales';
import Analytics from '../pages/Analytics';
import Users from '../pages/Users';
import SalesHistory from '../pages/SalesHistory';
import StockAlertPopup from '../components/StockAlertPopup';
import SaleSuccessPopup from '../components/SaleSuccessPopup';
import PasswordModal from '../components/PasswordModal';
import Login from '../pages/Login';
import AiChatWidget from '../components/AiChatWidget';

import { useInventoryStore } from '../store/useInventoryStore';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../store/useAuthStore';
import { useUserStore } from '../store/useUserStore';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Painel de Gestão',
  '/inventory': 'Controle de Estoque',
  '/sales': 'Ponto de Venda',
  '/analytics': 'Estatísticas',
  '/users': 'Usuários',
  '/comprovantes': 'Comprovantes de Venda',
};

function TopbarTitle() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Distribuidora';
  return <span className="topbar-page-title">{title}</span>;
}

export default function AppLayout() {
  const { fetchProducts } = useInventoryStore();
  const { fetchSales } = useSalesStore();
  const { user, logout, isAuthenticated } = useAuthStore();
  const { fetchUsers } = useUserStore();
  const { lastSale, showSuccessPopup, closeSuccessPopup } = useSalesStore();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    if (isAuthenticated()) {
      fetchProducts();
      if (user?.role === 'admin') {
        fetchSales();
        fetchUsers();
      }
    }
  }, [fetchProducts, fetchSales, fetchUsers, isAuthenticated, user]);

  useEffect(() => {
    if (isDark) {
      document.body.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.body.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // Fechar menu ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!isAuthenticated()) return <Login />;

  const isAdmin = user?.role === 'admin';

  const navItems = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Painel', end: true },
    ...(isAdmin ? [{ to: '/inventory', icon: <Package size={20} />, label: 'Estoque' }] : []),
    { to: '/sales', icon: <ShoppingCart size={20} />, label: 'Ponto de Venda' },
    ...(isAdmin ? [
      { to: '/analytics', icon: <BarChart3 size={20} />, label: 'Estatísticas' },
      { to: '/users', icon: <UsersIcon size={20} />, label: 'Usuários' },
      { to: '/comprovantes', icon: <ClipboardList size={20} />, label: 'Comprovantes' },
    ] : []),
  ];

  return (
    <BrowserRouter>
      <div className="app-layout">

        {/* Overlay mobile */}
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
                <h2>Distribuidora</h2>
                <span className="brand-version">v2.0</span>
              </div>
            </div>
            <button className="sidebar-close-btn" onClick={() => setIsSidebarOpen(false)}>
              <X size={18} />
            </button>
          </div>

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
            <button className="logout-btn" onClick={logout}>
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
              <div className="user-profile-menu" ref={userMenuRef}>
                <div
                  className={`user-info ${isUserMenuOpen ? 'active' : ''}`}
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                >
                  <div className="avatar">{user?.name ? user.name[0].toUpperCase() : 'U'}</div>
                  <div className="user-details">
                    <span className="user-name">{user?.name}</span>
                    <span className="user-role">{isAdmin ? 'Administrador' : 'Operador'}</span>
                  </div>
                  <ChevronDown size={16} className={`chevron ${isUserMenuOpen ? 'open' : ''}`} />
                </div>

                {isUserMenuOpen && (
                  <div className="profile-dropdown">
                    <div className="dropdown-header">
                      <div className="avatar avatar-lg">{user?.name ? user.name[0].toUpperCase() : 'U'}</div>
                      <div>
                        <div className="dropdown-name">{user?.name}</div>
                        <div className="dropdown-role">{isAdmin ? 'Administrador' : 'Operador'}</div>
                      </div>
                    </div>
                    <div className="dropdown-divider" />
                    <button onClick={() => { setIsPasswordModalOpen(true); setIsUserMenuOpen(false); }}>
                      <KeyRound size={16} /> Alterar Senha
                    </button>
                    <button onClick={logout} className="logout-item">
                      <LogOut size={16} /> Sair do Sistema
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="content-scroll">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/inventory" element={isAdmin ? <Inventory /> : <Navigate to="/" />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/analytics" element={isAdmin ? <Analytics /> : <Navigate to="/" />} />
              <Route path="/users" element={isAdmin ? <Users /> : <Navigate to="/" />} />
              <Route path="/comprovantes" element={isAdmin ? <SalesHistory /> : <Navigate to="/" />} />
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
            onClose={closeSuccessPopup}
          />
        )}

        <StockAlertPopup />
        {isAdmin && <AiChatWidget />}
      </div>
    </BrowserRouter>
  );
}
