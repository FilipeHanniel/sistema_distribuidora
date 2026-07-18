import { useState, useEffect, type FormEvent } from 'react';
import { Plus, Search, UserPlus, User as UserIcon, Edit2, Trash2, Power, PowerOff, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { apiRequest } from '../lib/api';
import type { User } from '../types';
import Modal from '../components/Modal';
import './Users.css';

export default function Users() {
  const { users, fetchUsers, createUser, updateUser, toggleUserStatus, deleteUser } = useUserStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [maxOperators, setMaxOperators] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    name: '',
  });

  useEffect(() => {
    fetchUsers();
    apiRequest<{ plan: { limits: { maxOperators: number | null } } }>('/tenant/status')
      .then(status => setMaxOperators(status.plan.limits.maxOperators))
      .catch(error => console.error('Falha ao carregar limites do plano:', error));
  }, [fetchUsers]);

  const operadores = users.filter(u => u.role === 'operador');
  const countAtivos = operadores.filter(u => u.active === 1).length;
  const atLimit = maxOperators !== null && operadores.length >= maxOperators;
  const maxOperatorsLabel = maxOperators === null ? 'Ilimitado' : String(maxOperators);

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setFormData({ username: user.username, password: '', name: user.name });
    } else {
      setEditingUser(null);
      setFormData({ username: '', password: '', name: '' });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => { setIsModalOpen(false); setEditingUser(null); };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let success = false;
    if (editingUser) {
      success = await updateUser(editingUser.id, formData);
    } else {
      if (!formData.password) { alert('A senha é obrigatória para novos funcionários.'); return; }
      if (formData.password.length < 8 || !/[A-Za-z]/.test(formData.password) || !/\d/.test(formData.password)) {
        alert('A senha deve possuir pelo menos 8 caracteres, com letras e numeros.');
        return;
      }
      success = await createUser({ ...formData, role: 'operador' });
    }
    if (success) handleCloseModal();
  };

  const filteredUsers = operadores.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="page-container users-page">
      <div className="page-header">
        <div className="header-info">
          <h1>Funcionários</h1>
          <p className="subtitle">Cadastre e gerencie operadores do ponto de venda — limite do plano: {maxOperatorsLabel}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => handleOpenModal()}
          disabled={atLimit}
          title={atLimit ? `Limite de ${maxOperatorsLabel} funcionários atingido` : 'Novo funcionário'}
        >
          <Plus size={18} /> Novo Funcionário
        </button>
      </div>

      {/* Contadores */}
      <div className="widgets-grid">
        <div className="widget-card">
          <div className="widget-icon"><UserPlus size={20} /></div>
          <div className="widget-content">
            <span className="widget-title">Funcionários Cadastrados</span>
            <span className="widget-value">
              {operadores.length} <span style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>/ {maxOperatorsLabel}</span>
            </span>
          </div>
        </div>
        <div className="widget-card">
          <div className="widget-icon"><UserIcon size={20} /></div>
          <div className="widget-content">
            <span className="widget-title">Operadores Ativos</span>
            <span className="widget-value">{countAtivos}</span>
          </div>
        </div>
        <div className="widget-card" style={{ borderColor: atLimit ? 'var(--danger, #dc2626)' : undefined }}>
          <div className="widget-icon" style={{ background: atLimit ? '#fee2e2' : undefined, color: atLimit ? '#dc2626' : undefined }}>
            <ShieldCheck size={20} />
          </div>
          <div className="widget-content">
            <span className="widget-title">Vagas Disponíveis</span>
            <span className="widget-value" style={{ color: atLimit ? '#dc2626' : undefined }}>
              {maxOperators === null ? '∞' : Math.max(0, maxOperators - operadores.length)}
            </span>
          </div>
        </div>
      </div>

      {atLimit && (
        <div style={{
          background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '1rem',
          padding: '0.875rem 1.25rem', marginBottom: '1.5rem', fontSize: '0.875rem',
          color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <UserPlus size={16} />
          Você atingiu o limite de {maxOperatorsLabel} funcionários. Exclua um para cadastrar outro.
        </div>
      )}

      <div className="search-bar">
        <div className="search-input-wrapper">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por nome ou login..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="users-list-card card">
        <table className="users-table">
          <thead>
            <tr>
              <th>Funcionário</th>
              <th>Login</th>
              <th>Status</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length > 0 ? filteredUsers.map(user => (
              <tr key={user.id} className={user.active === 0 ? 'user-inactive' : ''}>
                <td>
                  <div className="user-info-cell">
                    <div className="user-avatar">{user.name[0].toUpperCase()}</div>
                    <span>{user.name}</span>
                  </div>
                </td>
                <td><code>{user.username}</code></td>
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
            )) : (
              <tr>
                <td colSpan={4} className="empty-state">
                  {operadores.length === 0 ? 'Nenhum funcionário cadastrado ainda.' : 'Nenhum resultado encontrado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingUser ? 'Editar Funcionário' : 'Novo Funcionário (Operador)'}
      >
        <form onSubmit={handleSubmit} className="user-form">
          <div className="form-group">
            <label>Nome Completo</label>
            <input type="text" className="form-control" value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required placeholder="Ex: João Silva" />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Login de Acesso</label>
              <input type="text" className="form-control" value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                required placeholder="Ex: joao.silva" />
            </div>
            <div className="form-group">
              <label>{editingUser ? 'Nova Senha (opcional)' : 'Senha de Acesso'}</label>
              <input type="password" className="form-control" value={formData.password}
                minLength={editingUser ? undefined : 8}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                required={!editingUser} placeholder={editingUser ? '••••••••' : 'Senha'} />
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-main)', padding: '0.75rem', borderRadius: '0.5rem' }}>
            Este funcionário terá acesso ao <strong>Ponto de Venda</strong> e <strong>Comprovantes do dia</strong>.
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancelar</button>
            <button type="submit" className="btn btn-primary">
              {editingUser ? 'Salvar Alterações' : 'Cadastrar Funcionário'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
