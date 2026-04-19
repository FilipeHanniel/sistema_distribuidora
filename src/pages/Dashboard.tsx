import { useState, useEffect } from 'react';
import { Brain, AlertTriangle, Clock, TrendingDown, PackageCheck, ArrowUpCircle, ShoppingBag, Trash2, Sparkles, TrendingUp } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import './Dashboard.css';

interface StockPrediction {
  id: string;
  name: string;
  category: string;
  currentStock: number;
  totalSold30d: number;
  dailyRate: number;
  daysUntilStockout: number | null;
  suggestedOrder: number;
  urgency: 'critical' | 'warning' | 'attention';
}

interface ExternalSuggestion {
  id: string;
  productName: string;
  suggestion: string;
  count: number;
  updatedAt: string;
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState<StockPrediction[]>([]);
  const [externalSuggestions, setExternalSuggestions] = useState<ExternalSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const { token, user } = useAuthStore();

  const isAdmin = user?.role === 'admin';

  const fetchData = async () => {
    try {
      // 1. Fetch Predictions
      const predRes = await fetch('http://localhost:3000/api/ai/stock-predictions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (predRes.ok) {
        const data = await predRes.json();
        setPredictions(data);
      }

      // 2. Fetch External Suggestions (Admin only)
      if (isAdmin) {
        const suggRes = await fetch('http://localhost:3000/api/ai/suggestions', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (suggRes.ok) {
          const data = await suggRes.json();
          setExternalSuggestions(data);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar dados do Dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token, isAdmin]);

  const dismissSuggestion = async (id: string) => {
    if (!confirm('Deseja remover esta sugestão da lista?')) return;
    try {
      const res = await fetch(`http://localhost:3000/api/ai/suggestions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        setExternalSuggestions(prev => prev.filter(s => s.id !== id));
      }
    } catch (err) {
      console.error('Erro ao excluir sugestão:', err);
    }
  };

  const urgencyLabel = (u: string) => {
    switch (u) {
      case 'critical': return '🔴 Crítico';
      case 'warning': return '🟡 Atenção';
      case 'attention': return '🔵 Monitorar';
      default: return '';
    }
  };

  const criticalCount = predictions.filter(p => p.urgency === 'critical').length;
  const warningCount = predictions.filter(p => p.urgency === 'warning').length;
  const attentionCount = predictions.filter(p => p.urgency === 'attention').length;

  return (
    <div className="page-container">
      <div className="dashboard-predictions">

        {/* Header */}
        <div className="dashboard-header">
          <div>
            <h1>
              <Brain size={28} color="var(--primary)" />
              Gestão Inteligente
            </h1>
            <p className="dashboard-subtitle">
              Análise preditiva de estoque e oportunidades de mercado via IA
            </p>
          </div>
        </div>

        {/* --- SEÇÃO 1: PREVISÕES DE ESTOQUE --- */}
        <section>
          <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingDown size={20} color="var(--secondary)" /> Ruptura de Estoque
          </h2>

          {!loading && predictions.length > 0 && (
            <div className="predictions-summary">
              {criticalCount > 0 && (
                <div className="summary-badge critical">
                  <AlertTriangle size={16} />
                  <span className="summary-count">{criticalCount}</span>
                  <span>Crítico (≤ 3 dias)</span>
                </div>
              )}
              {warningCount > 0 && (
                <div className="summary-badge warning">
                  <Clock size={16} />
                  <span className="summary-count">{warningCount}</span>
                  <span>Atenção (≤ 7 dias)</span>
                </div>
              )}
              {attentionCount > 0 && (
                <div className="summary-badge attention">
                  <Clock size={16} />
                  <span className="summary-count">{attentionCount}</span>
                  <span>Monitorar (≤ 14 dias)</span>
                </div>
              )}
            </div>
          )}

          {loading && (
            <div className="card predictions-loading">
              <div className="loading-spinner" />
              <span>Analisando dados de vendas...</span>
            </div>
          )}

          {!loading && predictions.length === 0 && (
            <div className="card predictions-empty">
              <PackageCheck size={48} className="empty-icon" />
              <h3>Tudo sob controle!</h3>
              <p>Nenhum produto em risco de falta nos próximos 14 dias.</p>
            </div>
          )}

          {!loading && predictions.length > 0 && (
            <div className="predictions-grid">
              {predictions.map(pred => (
                <div key={pred.id} className={`prediction-card ${pred.urgency}`}>
                  <div className="pred-header">
                    <div>
                      <div className="pred-name">{pred.name}</div>
                      <span className="pred-category">{pred.category}</span>
                    </div>
                    <span className={`pred-urgency ${pred.urgency}`}>
                      {urgencyLabel(pred.urgency)}
                    </span>
                  </div>

                  <div className="pred-days-bar">
                    <div 
                      className={`pred-days-fill ${pred.urgency}`}
                      style={{ width: `${Math.min(100, (pred.daysUntilStockout || 0) / 14 * 100)}%` }}
                    />
                  </div>

                  <div className="pred-stats">
                    <div className="pred-stat">
                      <span className="pred-stat-label">Estoque</span>
                      <span className="pred-stat-value">{pred.currentStock}</span>
                    </div>
                    <div className="pred-stat">
                      <span className="pred-stat-label">Saída/dia</span>
                      <span className="pred-stat-value">{pred.dailyRate}</span>
                    </div>
                    <div className="pred-stat">
                      <span className="pred-stat-label">Dias rest.</span>
                      <span className="pred-stat-value">
                        {pred.daysUntilStockout !== null ? `${pred.daysUntilStockout}d` : '—'}
                      </span>
                    </div>
                  </div>

                  {pred.suggestedOrder > 0 && (
                    <div className="pred-suggestion">
                      <ArrowUpCircle size={16} />
                      <span>Sugestão: pedir <strong>{pred.suggestedOrder} un.</strong></span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* --- SEÇÃO 2: OPORTUNIDADES DE COMPRA (Sugestões Externas) --- */}
        {isAdmin && (
          <section className="suggestions-section">
            <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#8b5cf6' }}>
              <TrendingUp size={20} /> Oportunidades de Compra (Demanda IA)
            </h2>

            {externalSuggestions.length === 0 ? (
              <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <Sparkles size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
                <p>Nenhuma oportunidade externa identificada no momento.</p>
              </div>
            ) : (
              <div className="suggestions-grid">
                {externalSuggestions.map((sugg, index) => (
                  <div key={sugg.id} className="suggestion-card">
                    <div className="suggestion-header">
                      <div className="suggestion-title-group">
                        <span className="suggestion-rank">{index + 1}º</span>
                        <span className="suggestion-name">{sugg.productName}</span>
                      </div>
                      <span className="suggestion-badge">DEMANDA</span>
                    </div>
                    <p className="suggestion-reason">{sugg.suggestion}</p>
                    <div className="suggestion-footer">
                      <span className="suggestion-count">
                        <ShoppingBag size={14} /> Solicitado {sugg.count}x no PDV
                      </span>
                      <button className="btn-dismiss" onClick={() => dismissSuggestion(sugg.id)} title="Descartar sugestão">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
