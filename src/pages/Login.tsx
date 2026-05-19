import { useState, type FormEvent } from 'react';
import { User, Lock, AlertCircle } from 'lucide-react';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/useAuthStore';
import './Login.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const loginStore = useAuthStore();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const data = await apiRequest<{ user: Parameters<typeof loginStore.login>[0]; token: string }>('/login', {
        method: 'POST',
        auth: false,
        body: { username, password },
      });
      loginStore.login(data.user, data.token);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Servidor indisponível. Verifique sua conexão.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-brand">
            <div className="login-logo-mark">
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="10" y="14" width="12" height="14" rx="3" fill="url(#loginGrad)" />
                <rect x="13" y="6" width="6" height="9" rx="1.5" fill="url(#loginGrad)" />
                <rect x="12" y="4" width="8" height="3" rx="1.5" fill="#8b5cf6" />
                <rect x="10" y="19" width="12" height="4" rx="0" fill="rgba(255,255,255,0.25)" />
                <circle cx="26" cy="8" r="1.5" fill="#facc15" />
                <path d="M26 4.5V6M26 10V11.5M22.5 8H24M28 8H29.5" stroke="#facc15" strokeWidth="1" strokeLinecap="round" />
                <path d="M7 12C7 12 5 14.5 5 16C5 17.1 5.9 18 7 18C8.1 18 9 17.1 9 16C9 14.5 7 12 7 12Z" fill="#38bdf8" opacity="0.7" />
                <defs>
                  <linearGradient id="loginGrad" x1="10" y1="4" x2="22" y2="28" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#005CB9" />
                    <stop offset="1" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h1>Distribuidora</h1>
          </div>
          <p>Faça login para gerenciar seu negócio</p>
        </div>

        {error && (
          <div className="login-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Usuário</label>
            <div className="input-with-icon">
              <User className="input-icon" size={18} />
              <input
                id="username"
                type="text"
                placeholder="Seu login"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">Senha</label>
            <div className="input-with-icon">
              <Lock className="input-icon" size={18} />
              <input
                id="password"
                type="password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          <button type="submit" className="btn-login" disabled={isLoading}>
            {isLoading ? 'Autenticando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
