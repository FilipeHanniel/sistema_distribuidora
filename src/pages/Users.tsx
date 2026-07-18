import { useState, useEffect, type FormEvent } from 'react';
import {
  Plus, Search, UserPlus, User as UserIcon, Edit2, Trash2,
  Power, PowerOff, ShieldCheck, KeyRound,
} from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { apiRequest } from '../lib/api';
import type { User } from '../types';
import Modal from '../components/Modal';
import './Users.css';

const isValidPassword = (value: string) => value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);

export default function Users() {
  const {
    users,
    fetchUsers,
    createUser,
    updateUser,
    resetUserPassword,
    toggleUserStatus,
    deleteUser,
  } = useUserStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
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

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleClosePasswordModal = () => {
    setPasswordUser(null);
    setTemporaryPassword('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    let success = false;
    if (editingUser) {
      success = await updateUser(editingUser.id, {
        username: formData.username,
        name: formData.name,
      });
    } else {
      if (!formData.password) {
        alert('A senha temporaria e obrigatoria para novos funcionarios.');
        return;
      }
      if (!isValidPassword(formData.password)) {
        alert('A senha deve possuir pelo menos 8 caracteres, com letras e numeros.');
        return;
      }
      success = await createUser({ ...formData, role: 'operador' });
    }
    if (success) handleCloseModal();
  };

  const handlePasswordReset = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    if (!isValidPassword(temporaryPassword)) {
      alert('A senha temporaria deve possuir pelo menos 8 caracteres, com letras e numeros.');
      return;
    }
    const success = await resetUserPassword(passwordUser.id, temporaryPassword);
    if (success) handleClosePasswordModal();
  };

  const filteredUsers = operadores.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="page-container users-page">
      <div className="page-header">
        <div className="header-info">
          <h1>Funcionarios</h1>
          <p className="subtitle">Cadastre e gerencie operadores do ponto de venda - limite do plano: {maxOperatorsLabel}</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => handleOpenModal()}
          disabled={atLimit}
          title={atLimit ? `Limite de ${maxOperatorsLabel} funcionarios atingido` : 'Novo funcionario'}
        >
          <Plus size={18} /> Novo Funcionario
        </button>
      </div>

      <div className="widgets-grid">
        <div className="widget-card">
          <div className="widget-icon"><UserPlus size={20} /></div>
          <div className="widget-content">
            <span className="widget-title">Funcionarios Cadastrados</span>
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
            <span className="widget-title">Vagas Disponiveis</span>
            <span className="widget-value" style={{ color: atLimit ? '#dc2626' : undefined }}>
              {maxOperators === null ? 'Ilimitado' : Math.max(0, maxOperators - operadores.length)}
            </span>
          </div>
        </div>
      </div>

      {atLimit && (
        <div className="users-warning">
          <UserPlus size={16} />
          Voce atingiu o limite de {maxOperatorsLabel} funcionarios. Exclua um para cadastrar outro.
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
              <th>Funcionario</th>
              <th>Login</th>
              <th>Status</th>
              <th className="text-right">Acoes</th>
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
                  {Number(user.mustChangePassword || 0) === 1 && (
                    <span className="status-badge temporary-password">Senha temporaria</span>
                  )}
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
                  <button
                    className="action-btn reset"
                    title="Redefinir senha"
                    onClick={() => { setPasswordUser(user); setTemporaryPassword(''); }}
                  >
                    <KeyRound size={18} />
                  </button>
                  <button className="action-btn delete" title="Excluir" onClick={() => deleteUser(user.id)}>
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="empty-state">
                  {operadores.length === 0 ? 'Nenhum funcionario cadastrado ainda.' : 'Nenhum resultado encontrado.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={editingUser ? 'Editar Funcionario' : 'Novo Funcionario (Operador)'}
      >
        <form onSubmit={handleSubmit} className="user-form">
          <div className="form-group">
            <label>Nome Completo</label>
            <input
              type="text"
              className="form-control"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="Ex: Joao Silva"
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Login de Acesso</label>
              <input
                type="text"
                className="form-control"
                value={formData.username}
                onChange={e => setFormData({ ...formData, username: e.target.value })}
                required
                placeholder="Ex: joao.silva"
              />
            </div>
            {!editingUser && (
              <div className="form-group">
                <label>Senha temporaria</label>
                <input
                  type="password"
                  className="form-control"
                  value={formData.password}
                  minLength={8}
                  autoComplete="new-password"
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  required
                  placeholder="Senha"
                />
              </div>
            )}
          </div>
          <div className="user-form-note">
            Este funcionario tera acesso ao <strong>Ponto de Venda</strong> e <strong>Comprovantes do dia</strong>.
            Senhas temporarias precisam ser trocadas no primeiro login.
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleCloseModal}>Cancelar</button>
            <button type="submit" className="btn btn-primary">
              {editingUser ? 'Salvar Alteracoes' : 'Cadastrar Funcionario'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(passwordUser)}
        onClose={handleClosePasswordModal}
        title={passwordUser ? `Redefinir senha de ${passwordUser.name}` : 'Redefinir senha'}
      >
        <form onSubmit={handlePasswordReset} className="user-form">
          <div className="form-group">
            <label>Nova senha temporaria</label>
            <input
              type="password"
              className="form-control"
              value={temporaryPassword}
              minLength={8}
              autoComplete="new-password"
              onChange={e => setTemporaryPassword(e.target.value)}
              required
              placeholder="Minimo 8 caracteres, letras e numeros"
            />
            <small>O operador devera trocar esta senha no proximo login.</small>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={handleClosePasswordModal}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Redefinir senha</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
