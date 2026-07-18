import React, { useState } from 'react';
import { X, Lock, KeyRound, AlertCircle } from 'lucide-react';
import { useUserStore } from '../store/useUserStore';
import { useAuthStore } from '../store/useAuthStore';
import './Modal.css';

interface PasswordModalProps {
  onClose: () => void;
  forceChange?: boolean;
}

export default function PasswordModal({ onClose, forceChange = false }: PasswordModalProps) {
  const { changePassword } = useUserStore();
  const { logout } = useAuthStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('A nova senha e a confirmação não coincidem.');
      return;
    }

    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError('A nova senha deve ter pelo menos 8 caracteres, com letras e numeros.');
      return;
    }

    setLoading(true);
    const result = await changePassword({ currentPassword, newPassword });
    setLoading(false);

    if (result.success) {
      setSuccess('Senha alterada com sucesso. Entre novamente para continuar.');
      setTimeout(() => {
        logout();
        onClose();
      }, 1800);
    } else {
      setError(result.message);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container" style={{ maxWidth: '400px' }}>
        <div className="modal-header">
          <div className="title-with-icon">
            <Lock size={20} className="header-icon" />
            <h3>{forceChange ? 'Trocar senha temporaria' : 'Alterar Senha'}</h3>
          </div>
          {!forceChange && <button className="close-btn" onClick={onClose}><X size={20} /></button>}
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {forceChange && (
            <div className="form-alert warning">
              <AlertCircle size={16} />
              <span>Esta senha e temporaria. Crie uma nova senha para liberar o acesso ao sistema.</span>
            </div>
          )}

          {error && (
            <div className="form-alert error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="form-alert success">
              <span>{success}</span>
            </div>
          )}

          <div className="form-group">
            <label>Senha Atual</label>
            <div className="input-with-icon">
              <KeyRound size={18} />
              <input
                type="password"
                minLength={8}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Digite sua senha atual"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Nova Senha</label>
            <div className="input-with-icon">
              <KeyRound size={18} />
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimo 8 caracteres, letras e numeros"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Confirmar Nova Senha</label>
            <div className="input-with-icon">
              <KeyRound size={18} />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repita a nova senha"
                required
              />
            </div>
          </div>

          <div className="modal-actions">
            {!forceChange && (
              <button type="button" className="secondary-btn" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
            )}
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? 'Salvando...' : forceChange ? 'Trocar e entrar novamente' : 'Alterar Senha'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
