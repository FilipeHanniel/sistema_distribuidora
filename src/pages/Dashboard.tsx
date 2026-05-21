import { useState, useEffect, useCallback } from 'react';
import { Brain, AlertTriangle, Clock, TrendingDown, PackageCheck, ArrowUpCircle, FileText, CalendarDays } from 'lucide-react';
import { apiRequest } from '../lib/api';
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

interface AiReport {
  id: string;
  periodType: 'daily' | 'weekly';
  periodStart: string;
  periodEnd: string;
  content: string;
  cached: boolean;
  metrics: {
    salesCount: number;
    totalRevenue: number;
    averageTicket: number;
    previousRevenue: number;
    previousSalesCount: number;
  };
}

export default function Dashboard() {
  const [predictions, setPredictions] = useState<StockPrediction[]>([]);
  const [dailyReport, setDailyReport] = useState<AiReport | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const { user } = useAuthStore();

  const isGestor = user?.role === 'gestor';
  const isMonday = new Date().getDay() === 1;

  const fetchData = useCallback(async () => {
    try {
      const predictions = await apiRequest<StockPrediction[]>('/ai/stock-predictions');
      setPredictions(predictions);

      if (isGestor) {
        setReportLoading(true);
        const daily = await apiRequest<AiReport>('/ai/reports?period=daily');
        setDailyReport(daily);
        if (isMonday) {
          const weekly = await apiRequest<AiReport>('/ai/reports?period=weekly');
          setWeeklyReport(weekly);
        }
      }
    } catch (err) {
      console.error('Erro ao buscar dados do Dashboard:', err);
    } finally {
      setLoading(false);
      setReportLoading(false);
    }
  }, [isGestor, isMonday]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        {isGestor && (
          <section className="ai-report-section">
            <div className="ai-report-header">
              <div>
                <h2><FileText size={20} /> Relatorio inteligente diario</h2>
                <p>Gerado uma vez por dia com base nas vendas, produtos e estoque do estabelecimento.</p>
              </div>
              {reportLoading && <span className="ai-report-loading">Gerando analise...</span>}
            </div>

            {dailyReport && (
              <div className="ai-report-card">
                <div className="ai-report-meta">
                  <span>{new Date(dailyReport.periodStart).toLocaleDateString('pt-BR')}</span>
                  <strong>{dailyReport.metrics.salesCount} vendas - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dailyReport.metrics.totalRevenue)}</strong>
                </div>
                <div className="ai-report-content">{dailyReport.content}</div>
              </div>
            )}

            {isMonday && weeklyReport && (
              <div className="ai-report-card weekly">
                <div className="ai-report-meta">
                  <span><CalendarDays size={15} /> Relatorio semanal</span>
                  <strong>{weeklyReport.metrics.salesCount} vendas - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(weeklyReport.metrics.totalRevenue)}</strong>
                </div>
                <div className="ai-report-content">{weeklyReport.content}</div>
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
