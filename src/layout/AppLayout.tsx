import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { LayoutDashboard, Package, ShoppingCart, BarChart3, Users as UsersIcon, Sun, Moon, LogOut, KeyRound, ClipboardList } from 'lucide-react';
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

export default function AppLayout() {
  const { fetchProducts } = useInventoryStore();
  const { fetchSales } = useSalesStore();
  const { user, logout, isAuthenticated } = useAuthStore();
  const { fetchUsers } = useUserStore();
  const { lastSale, showSuccessPopup, closeSuccessPopup } = useSalesStore();

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

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

  const toggleTheme = () => setIsDark(!isDark);

  // Se não estiver logado, mostra apenas a página de Login
  if (!isAuthenticated()) {
    return <Login />;
  }

  const isAdmin = user?.role === 'admin';

  return (
    <BrowserRouter>
      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="brand">
              <div className="logo-mark">
                <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {/* Bottle body */}
                  <rect x="10" y="14" width="12" height="14" rx="3" fill="url(#brandGrad)" />
                  {/* Bottle neck */}
                  <rect x="13" y="6" width="6" height="9" rx="1.5" fill="url(#brandGrad)" />
                  {/* Cap */}
                  <rect x="12" y="4" width="8" height="3" rx="1.5" fill="#8b5cf6" />
                  {/* Label stripe */}
                  <rect x="10" y="19" width="12" height="4" rx="0" fill="rgba(255,255,255,0.25)" />
                  {/* Sparkle */}
                  <circle cx="26" cy="8" r="1.5" fill="#facc15" />
                  <path d="M26 4.5V6M26 10V11.5M22.5 8H24M28 8H29.5" stroke="#facc15" strokeWidth="1" strokeLinecap="round" />
                  {/* Droplet */}
                  <path d="M7 12C7 12 5 14.5 5 16C5 17.1 5.9 18 7 18C8.1 18 9 17.1 9 16C9 14.5 7 12 7 12Z" fill="#38bdf8" opacity="0.7" />
                  <defs>
                    <linearGradient id="brandGrad" x1="10" y1="4" x2="22" y2="28" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#005CB9" />
                      <stop offset="1" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <h2>Distribuidora</h2>
            </div>
          </div>
          
          <nav className="sidebar-nav">
            <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
              <LayoutDashboard size={20} />
              <span>Painel</span>
            </NavLink>
            
            {isAdmin && (
              <NavLink to="/inventory" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Package size={20} />
                <span>Estoque</span>
              </NavLink>
            )}

            <NavLink to="/sales" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <ShoppingCart size={20} />
              <span>Ponto de Venda</span>
            </NavLink>

            {isAdmin && (
              <NavLink to="/analytics" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <BarChart3 size={20} />
                <span>Estatísticas</span>
              </NavLink>
            )}

            {isAdmin && (
              <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <UsersIcon size={20} />
                <span>Usuários</span>
              </NavLink>
            )}

            {isAdmin && (
              <NavLink to="/comprovantes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ClipboardList size={20} />
                <span>Comprovantes</span>
              </NavLink>
            )}
          </nav>

          <div className="sidebar-footer">
             <button className="theme-toggle" onClick={toggleTheme}>
               {isDark ? (
                  <><Sun size={18} /> Modo Claro</>
               ) : (
                  <><Moon size={18} /> Modo Escuro</>
               )}
             </button>
             <button className="logout-btn" onClick={logout}>
               <LogOut size={18} /> Sair
             </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="main-content">
          <header className="topbar">
            <div className="user-profile-menu">
              <div className="user-info" onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}>
                <div className="avatar">{user?.name ? user.name[0] : 'U'}</div>
                <div className="user-details">
                  <span className="user-name">{user?.name}</span>
                  <span className="user-role">{isAdmin ? 'Administrador' : 'Operador'}</span>
                </div>
              </div>
              
              {isUserMenuOpen && (
                <div className="profile-dropdown">
                  <button onClick={() => { setIsPasswordModalOpen(true); setIsUserMenuOpen(false); }}>
                    <KeyRound size={16} /> Alterar Senha
                  </button>
                  <button onClick={logout} className="logout-item">
                    <LogOut size={16} /> Sair do Sistema
                  </button>
                </div>
              )}
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

        {/* Global Popups */}
        <StockAlertPopup />

        {/* AI Chat Assistant (Admin Only) */}
        {isAdmin && <AiChatWidget />}
      </div>
    </BrowserRouter>
  );
}
