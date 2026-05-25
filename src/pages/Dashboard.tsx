import { useState, useEffect, useCallback } from 'react';
import { Brain, AlertTriangle, Clock, TrendingDown, PackageCheck, ArrowUpCircle, FileText, CalendarDays, Lightbulb, ListChecks, Target, CircleDot, BarChart3, CreditCard, Boxes } from 'lucide-react';
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
    paymentMethods?: { paymentMethod: string; count: number; revenue: number }[];
    topProducts?: { name: string; quantity: number; revenue: number }[];
    lowStock?: { name: string; stock: number; category: string; soldLast90d?: number }[];
  };
}

type ReportBlock = {
  title: string;
  items: string[];
};

const REPORT_SECTION_TITLES = [
  'Resumo executivo',
  'Pontos positivos',
  'Pontos de atencao',
  'Produtos e estoque',
  'Observacoes',
  'Alertas',
  'Acoes recomendadas',
];

function parseReportContent(content: string): ReportBlock[] {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line !== '---')
    .filter(line => {
      const normalized = line.replace(/\*\*/g, '').replace(/^#+\s*/, '').trim().toLowerCase();
      return !normalized.startsWith('relatorio diario')
        && !normalized.startsWith('relatório diário')
        && !normalized.startsWith('relatorio semanal')
        && !normalized.startsWith('relatório semanal')
        && !normalized.startsWith('periodo ')
        && !normalized.startsWith('período ')
        && normalized !== 'resumo executivo'
        && !normalized.includes('resumo executivo (3');
    });

  const blocks: ReportBlock[] = [];
  let current: ReportBlock = { title: REPORT_SECTION_TITLES[0], items: [] };

  const flush = () => {
    if (current.items.length > 0 || current.title !== REPORT_SECTION_TITLES[0]) {
      blocks.push(current);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\*\*/g, '').trim();
    const heading = line.match(/^#{1,4}\s+(.+)$/) || line.match(/^([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]{2,60}):$/);
    if (heading) {
      flush();
      current = { title: heading[1].trim(), items: [] };
      continue;
    }

    const listItem = line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim();
    current.items.push(listItem);
  }

  flush();
  return blocks.length > 0 ? blocks : [{ title: REPORT_SECTION_TITLES[0], items: [content] }];
}

function reportIcon(title: string, index: number) {
  const normalized = title.toLowerCase();
  if (normalized.includes('indicador')) return <BarChart3 size={17} />;
  if (normalized.includes('comparativo')) return <TrendingDown size={17} />;
  if (normalized.includes('produto') || normalized.includes('estoque')) return <Boxes size={17} />;
  if (normalized.includes('acao') || normalized.includes('recomend')) return <ListChecks size={17} />;
  if (normalized.includes('alerta')) return <AlertTriangle size={17} />;
  if (normalized.includes('oportun')) return <Target size={17} />;
  return index === 0 ? <Lightbulb size={17} /> : <CircleDot size={17} />;
}

function renderInlineStrong(text: string) {
  const cleaned = text.replace(/^[-*â€¢]\s+/, '').trim();
  const match = cleaned.match(/^\*\*(.+?)\*\*:\s*(.+)$/) || cleaned.match(/^([^:]{2,42}):\s*(.+)$/);
  if (!match) return cleaned;
  return (
    <>
      <strong>{match[1]}</strong>
      <span>{match[2]}</span>
    </>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
}

function growthLabel(current: number, previous: number) {
  if (!previous && !current) return 'Sem movimento';
  if (!previous) return 'Novo movimento';
  const pct = ((current - previous) / previous) * 100;
  const direction = pct >= 0 ? 'Alta' : 'Queda';
  return `${direction} de ${Math.abs(pct).toFixed(1)}%`;
}

function AiReportMetricStrip({ report }: { report: AiReport }) {
  const topPayment = report.metrics.paymentMethods?.[0];
  const topProduct = report.metrics.topProducts?.[0];
  const lowStockCount = report.metrics.lowStock?.length || 0;

  return (
    <div className="ai-report-metrics-strip">
      <div className="ai-report-metric">
        <BarChart3 size={16} />
        <span>Vendas</span>
        <strong>{report.metrics.salesCount}</strong>
      </div>
      <div className="ai-report-metric">
        <CreditCard size={16} />
        <span>Faturamento</span>
        <strong>{formatCurrency(report.metrics.totalRevenue)}</strong>
      </div>
      <div className="ai-report-metric">
        <Target size={16} />
        <span>Ticket medio</span>
        <strong>{formatCurrency(report.metrics.averageTicket)}</strong>
      </div>
      <div className="ai-report-metric">
        <TrendingDown size={16} />
        <span>Comparativo</span>
        <strong>{growthLabel(report.metrics.totalRevenue, report.metrics.previousRevenue)}</strong>
      </div>
      <div className="ai-report-metric">
        <Boxes size={16} />
        <span>Destaque</span>
        <strong>{topProduct ? topProduct.name : topPayment ? topPayment.paymentMethod : 'Sem destaque'}</strong>
      </div>
      <div className="ai-report-metric">
        <AlertTriangle size={16} />
        <span>Estoque baixo</span>
        <strong>{lowStockCount}</strong>
      </div>
    </div>
  );
}

function reportTitle(report: AiReport) {
  const end = new Date(report.periodEnd);
  const referenceDate = new Date(end.getTime() - 1);
  const date = referenceDate.toLocaleDateString('pt-BR');
  return `Resumo executivo ${report.periodType === 'weekly' ? 'semanal' : 'diario'} ${date}`;
}

function AiReportContent({ content }: { content: string }) {
  const blocks = parseReportContent(content)
    .filter(block => !['relatorio diario de gestao', 'relatorio semanal de gestao'].includes(block.title.toLowerCase()))
    .map(block => ({
      ...block,
      items: block.items.filter(item => {
        const normalized = item.replace(/\*\*/g, '').trim().toLowerCase();
        return !normalized.startsWith('estabelecimento:')
          && !normalized.startsWith('periodo:')
          && !normalized.startsWith('período:')
          && normalized !== '---'
          && normalized !== 'resumo executivo'
          && !normalized.includes('resumo executivo (3');
      }),
    }))
    .filter(block => block.items.length > 0);

  return (
    <div className="ai-report-structured">
      {blocks.map((block, index) => (
        <section className={`ai-report-block ${index === 0 ? 'executive' : ''}`} key={`${block.title}-${index}`}>
          <div className="ai-report-block-title">
            {reportIcon(block.title, index)}
            <h3>{block.title}</h3>
          </div>
          <div className="ai-report-block-items">
            {block.items.map((item, itemIndex) => {
              const compact = index === 0 || !item.match(/^(\*\*)?[^:]{2,42}(\*\*)?:/);
              return (
                <div className={`ai-report-item ${compact ? 'plain' : ''}`} key={`${item}-${itemIndex}`}>
                  {!compact && <CircleDot size={10} />}
                  <span>{renderInlineStrong(item)}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
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
                  <span>{reportTitle(dailyReport)}</span>
                  <strong>{dailyReport.metrics.salesCount} vendas - {formatCurrency(dailyReport.metrics.totalRevenue)}</strong>
                </div>
                <AiReportMetricStrip report={dailyReport} />
                <AiReportContent content={dailyReport.content} />
              </div>
            )}

            {isMonday && weeklyReport && (
              <div className="ai-report-card weekly">
                <div className="ai-report-meta">
                  <span><CalendarDays size={15} /> {reportTitle(weeklyReport)}</span>
                  <strong>{weeklyReport.metrics.salesCount} vendas - {formatCurrency(weeklyReport.metrics.totalRevenue)}</strong>
                </div>
                <AiReportMetricStrip report={weeklyReport} />
                <AiReportContent content={weeklyReport.content} />
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  );
}
