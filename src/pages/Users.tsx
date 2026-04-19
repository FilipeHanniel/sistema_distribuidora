import React, { useState, useEffect } from 'react';
import { Plus, Search, UserPlus, Shield, User as UserIcon, MoreVertical, Edit2, Trash2, Power, PowerOff, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import type { User } from '../types';
import Modal from '../components/Modal';
import './Users.css';

export default function Users() {
  const { users, fetchUsers, createUser, updateUser, toggleUserStatus, deleteUser } = useUserStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
    role: 'staff' as 'admin' | 'staff'
  });

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        username: user.username,
        password: '', // Password is optional on edit
        name: user.name,
        role: user.role
      });
    } else {
      setEditingUser(null);
      setFormData({
        username: '',
        password: '',
        name: '',
        role: 'staff'
      });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let success = false;
    
    if (editingUser) {
      // If editing, password can be empty to keep current
      success = await updateUser(editingUser.id, formData);
    } else {
      // If creating, password is required
      if (!formData.password) {
        alert('A senha é obrigatória para novos usuários.');
        return;
      }
      success = await createUser(formData);
    }

    if (success) {
      handleCloseModal();
    }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const widgets = [
    { title: 'Total de Usuários', value: users.length, icon: <UserIcon size={20} /> },
    { title: 'Administradores', value: users.filter(u => u.role === 'admin').length, icon: <Shield size={20} /> },
    { title: 'Operadores ativos', value: users.filter(u => u.role === 'staff' && u.active === 1).length, icon: <UserPlus size={20} /> },
  ];

  return (
    <div className="page-container users-page">
      <div className="page-header">
        <div className="header-info">
          <h1>Gestão de Acessos</h1>
          <p className="subtitle">Controle quem pode acessar o sistema e suas permissões</p>
        </div>
        <button className="btn btn-primary" onClick={() => handleOpenModal()}>
          <Plus size={18} /> Novo Usuário
        </button>
      </div>

      <div className="widgets-grid">
        {widgets.map((w, idx) => (
          <div key={idx} className="widget-card">
            <div className="widget-icon">{w.icon}</div>
            <div className="widget-content">
              <span className="widget-title">{w.title}</span>
              <span className="widget-value">{w.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="search-bar">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou login..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="users-list-card card">
        <table className="users-table">
          <thead>
            <tr>
              <th>Usuário</th>
              <th>Login</th>
              <th>Permissão</th>
              <th>Status</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? (
              filteredUsers.map(user => (
                <tr key={user.id} className={user.active === 0 ? 'user-inactive' : ''}>
                  <td>
                    <div className="user-info-cell">
                      <div className="user-avatar">{user.name[0].toUpperCase()}</div>
                      <span>{user.name}</span>
                    </div>
                  </td>
                  <td><code>{user.username}</code></td>
                  <td>
                    <span className={`role-badge ${user.role}`}>
                      {user.role === 'admin' ? <ShieldCheck size={14} /> : <UserIcon size={14} />}
                      {user.role === 'admin' ? 'Administrador' : 'Operador'}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${user.active === 1 ? 'active' : 'inactive'}`}>
                      {user.active === 1 ? 'Ativo' : 'Desativado'}
                    </span>
                  </td>
                  <td className="text-right actions-cell">
                    <button 
                      className="action-btn status" 
                      title={user.active === 1 ? 'Desativar' : 'Ativar'}
                      onClick={() => toggleUserStatus(user.id, user.active === 0)}
                    >
                      {user.active === 1 ? <PowerOff size={18} /> : <Power size={18} />}
                    </button>
                    <button className="action-btn edit" title="Editar" onClick={() => handleOpenModal(user)}>
                      <Edit2 size={18} />
                    </button>
                    <button className="action-btn delete" title="Excluir" onClick={() => deleteUser(user.id)}>
                      <Trash2 size={18} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="empty-state">Nenhum usuário encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={handleCloseModal} 
        title={editingUser ? 'Editar Usuário' : 'Novo Usuário'}
      >
        <form onSubmit={handleSubmit} className="user-form">
          <div className="form-group">
            <label>Nome Completo</label>
            <input 
              type="text" 
              className="form-control"
              value={formData.name}
              onChange={e => setFormData({...formData, name: e.target.value})}
              required
              placeholder="Ex: João Silva"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Nome de Usuário (Login)</label>
              <input 
                type="text" 
                className="form-control"
                value={formData.username}
                onChange={e => setFormData({...formData, username: e.target.value})}
                required
                placeholder="Ex: joao.silva"
              />
            </div>
            
            <div className="form-group">
              <label>Permissão</label>
              <select 
                className="form-control"
                value={formData.role}
                onChange={e => setFormData({...formData, role: e.target.value as any})}
              >
                <option value="staff">Operador (Limite de acesso)</option>
                <option value="admin">Administrador (Acesso total)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>{editingUser ? 'Senha (deixe em branco para não alterar)' : 'Senha de Acesso'}</label>
            <input 
              type="password" 
              className="form-control"
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              required={!editingUser}
              placeholder={editingUser ? '••••••••' : 'Digite a senha'}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancelar</button>
            <button type="submit" className="btn btn-primary">{editingUser ? 'Salvar Alterações' : 'Criar Operador'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
