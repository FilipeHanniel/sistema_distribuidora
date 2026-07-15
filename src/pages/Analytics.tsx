import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle, BarChart3, Boxes, CalendarDays, Layers3,
  PackageCheck, RefreshCw, ShieldAlert, TrendingUp,
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import type {
  InventoryReport,
  InventoryReportMovementSummary,
  InventoryReportProductAlert,
  InventoryReportProductMargin,
  InventoryReportRuptureRisk,
  RuptureRiskLevel,
  StockMovementType,
} from '../types';
import './Analytics.css';

const COLORS = ['#005CB9', '#0f766e', '#F59E0B', '#8b5cf6', '#E42229'];

const periodOptions = [
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
];

const riskOptions = [
  { value: 7, label: '7 dias' },
  { value: 15, label: '15 dias' },
  { value: 30, label: '30 dias' },
];

const riskLabels: Record<RuptureRiskLevel, string> = {
  out: 'Esgotado',
  critical: 'Critico',
  attention: 'Atencao',
  monitor: 'Monitorar',
};

const movementLabels: Record<StockMovementType, string> = {
  initial_balance: 'Saldo inicial',
  purchase_receipt: 'Compras recebidas',
  purchase_reversal: 'Compras canceladas',
  sale: 'Vendas',
  manual_adjustment: 'Ajustes manuais',
};

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));

const number = (value: number, digits = 0) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value || 0));

const shortDate = (value: string) => {
  const [, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}`;
};

const fullDate = (value?: string | null) => value
  ? new Date(value).toLocaleDateString('pt-BR')
  : '-';

const compactText = (value: string, max = 28) =>
  value.length > max ? `${value.slice(0, max - 1)}...` : value;

export default function Analytics() {
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [periodDays, setPeriodDays] = useState(30);
  const [ruptureRiskDays, setRuptureRiskDays] = useState(15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<InventoryReport>(
        `/reports/inventory?periodDays=${periodDays}&ruptureRiskDays=${ruptureRiskDays}&salesWindowDays=90`
      );
      setReport(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel carregar o relatorio.'));
    } finally {
      setLoading(false);
    }
  }, [periodDays, ruptureRiskDays]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const trendData = useMemo(() => (report?.salesTrend || []).map(item => ({
    ...item,
    label: shortDate(item.date),
  })), [report]);

  const categoryData = useMemo(() => (report?.categoryBreakdown || []).slice(0, 8).map(item => ({
    name: compactText(item.category, 18),
    Estoque: item.inventoryCostValue,
    Vendas: item.revenue,
  })), [report]);

  const summary = report?.summary;
  const kpis = summary ? [
    {
      icon: <Boxes size={22} />,
      label: 'Valor em estoque',
      value: money(summary.inventoryCostValue),
      sub: `${number(summary.inventoryUnits)} unidades em ${summary.productCount} produtos`,
      color: 'primary',
    },
    {
      icon: <TrendingUp size={22} />,
      label: 'Margem no periodo',
      value: money(summary.grossProfit),
      sub: `${number(summary.grossMarginPct, 1)}% sobre ${money(summary.revenue)}`,
      color: 'success',
    },
    {
      icon: <ShieldAlert size={22} />,
      label: 'Risco de ruptura',
      value: String(summary.ruptureRiskCount),
      sub: `${summary.lowStockCount} com estoque baixo ativo`,
      color: summary.ruptureRiskCount > 0 ? 'warning' : 'success',
    },
    {
      icon: <PackageCheck size={22} />,
      label: 'Produtos parados',
      value: String(summary.stagnantCount),
      sub: 'Com estoque e sem saida em 90 dias',
      color: 'info',
    },
  ] : [];

  return (
    <div className="page-container">
      <div className="analytics-container">
        <header className="reports-header">
          <div>
            <h1><BarChart3 size={24} /> Relatorios operacionais</h1>
            <p>Estoque, margem e risco de ruptura com base nas vendas e movimentacoes registradas.</p>
          </div>
          <div className="reports-filters">
            <label>
              <CalendarDays size={15} />
              Periodo
              <select value={periodDays} onChange={event => setPeriodDays(Number(event.target.value))}>
                {periodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <AlertTriangle size={15} />
              Ruptura
              <select value={ruptureRiskDays} onChange={event => setRuptureRiskDays(Number(event.target.value))}>
                {riskOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-secondary" onClick={loadReport} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'spin' : ''} />
              Atualizar
            </button>
          </div>
        </header>

        {error && <div className="report-alert error"><AlertTriangle size={17} /> {error}</div>}

        {loading && !report ? (
          <div className="report-loading">Carregando relatorio...</div>
        ) : report && (
          <>
            <div className="report-meta">
              <span>Periodo analisado: {fullDate(report.period.start)} a {fullDate(report.period.end)}</span>
              <span>Ruptura calculada por saida dos ultimos {report.settings.salesWindowDays} dias.</span>
              <span>Gerado em {new Date(report.generatedAt).toLocaleString('pt-BR')}</span>
            </div>

            <div className="kpi-grid">
              {kpis.map(kpi => (
                <div key={kpi.label} className={`kpi-card kpi-${kpi.color}`}>
                  <div className={`kpi-icon ${kpi.color}`}>{kpi.icon}</div>
                  <div className="kpi-content">
                    <span className="kpi-title">{kpi.label}</span>
                    <span className="kpi-value">{kpi.value}</span>
                    <span className="kpi-sub">{kpi.sub}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="charts-row">
              <section className="chart-card chart-main">
                <div className="chart-card-header">
                  <h3><TrendingUp size={18} /> Faturamento no periodo</h3>
                </div>
                <ResponsiveContainer width="100%" height={240} minWidth={0}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 14, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={value => `R$${value}`} />
                    <RechartsTooltip formatter={value => [money(Number(value || 0)), 'Faturamento']} labelFormatter={label => `Dia ${label}`} />
                    <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2.5} fill="url(#revenueGradient)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </section>

              <section className="chart-card chart-side">
                <div className="chart-card-header">
                  <h3><Layers3 size={18} /> Categorias</h3>
                </div>
                {categoryData.length === 0 ? (
                  <div className="chart-empty">Sem produtos cadastrados.</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240} minWidth={0}>
                    <BarChart data={categoryData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={value => `R$${value}`} />
                      <RechartsTooltip formatter={(value, name) => [money(Number(value || 0)), String(name)]} />
                      <Bar dataKey="Estoque" radius={[3, 3, 0, 0]}>
                        {categoryData.map((_, index) => <Cell key={`stock-${index}`} fill={COLORS[index % COLORS.length]} />)}
                      </Bar>
                      <Bar dataKey="Vendas" fill="#10B981" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </section>
            </div>

            <div className="reports-grid">
              <ReportPanel
                title="Risco de ruptura"
                description={`Produtos com saida recente e cobertura menor ou igual a ${report.settings.ruptureRiskDays} dias.`}
              >
                <RuptureTable rows={report.ruptureRisks} />
              </ReportPanel>

              <ReportPanel
                title="Margem por produto"
                description="Produtos vendidos no periodo, ordenados pelo lucro bruto estimado."
              >
                <MarginTable rows={report.marginByProduct.slice(0, 12)} />
              </ReportPanel>
            </div>

            <div className="reports-grid">
              <ReportPanel
                title="Estoque baixo com saida"
                description={`Considera estoque menor ou igual a ${report.settings.lowStockThreshold} e venda nos ultimos 90 dias.`}
              >
                <LowStockList rows={report.lowStockProducts.slice(0, 10)} />
              </ReportPanel>

              <ReportPanel
                title="Produtos parados"
                description="Itens com estoque positivo e sem venda registrada nos ultimos 90 dias."
              >
                <StagnantList rows={report.stagnantProducts.slice(0, 10)} />
              </ReportPanel>
            </div>

            <ReportPanel
              title="Movimentacoes de estoque"
              description="Resumo do periodo por origem de entrada ou saida."
            >
              <MovementSummary rows={report.movementSummary} />
            </ReportPanel>
          </>
        )}
      </div>
    </div>
  );
}

function ReportPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="report-panel">
      <div className="report-panel-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function RuptureTable({ rows }: { rows: InventoryReportRuptureRisk[] }) {
  if (rows.length === 0) return <div className="report-empty">Nenhum risco de ruptura identificado.</div>;
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Estoque</th>
            <th>Saida 90d</th>
            <th>Cobertura</th>
            <th>Repor</th>
            <th>Risco</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.productId}>
              <td><strong>{row.name}</strong><span>{row.category}</span></td>
              <td>{number(row.currentStock)}</td>
              <td>{number(row.soldLastWindow)}</td>
              <td>{number(row.daysCover, 1)} dias</td>
              <td>{number(row.suggestedRestock)} un.</td>
              <td><span className={`risk-pill ${row.riskLevel}`}>{riskLabels[row.riskLevel]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarginTable({ rows }: { rows: InventoryReportProductMargin[] }) {
  if (rows.length === 0) return <div className="report-empty">Nenhuma venda no periodo selecionado.</div>;
  return (
    <div className="report-table-wrap">
      <table className="report-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Qtd.</th>
            <th>Receita</th>
            <th>Custo</th>
            <th>Lucro</th>
            <th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.productId}>
              <td><strong>{row.name}</strong><span>{row.category}</span></td>
              <td>{number(row.quantitySold)}</td>
              <td>{money(row.revenue)}</td>
              <td>{money(row.estimatedCost)}</td>
              <td className={row.grossProfit >= 0 ? 'positive' : 'negative'}>{money(row.grossProfit)}</td>
              <td>{number(row.grossMarginPct, 1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LowStockList({ rows }: { rows: InventoryReportProductAlert[] }) {
  if (rows.length === 0) return <div className="report-empty">Nenhum produto ativo em estoque baixo.</div>;
  return (
    <div className="report-list">
      {rows.map(row => (
        <div className="report-list-row" key={row.productId}>
          <div>
            <strong>{row.name}</strong>
            <span>{row.category} - ultima venda: {fullDate(row.lastSaleAt)}</span>
          </div>
          <div className="report-list-metric">
            <strong>{number(row.currentStock)} un.</strong>
            <span>{number(row.soldLastWindow)} vendidas</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StagnantList({ rows }: { rows: InventoryReportProductAlert[] }) {
  if (rows.length === 0) return <div className="report-empty">Nenhum produto parado relevante.</div>;
  return (
    <div className="report-list">
      {rows.map(row => (
        <div className="report-list-row" key={row.productId}>
          <div>
            <strong>{row.name}</strong>
            <span>{row.category} - {number(row.currentStock)} un. em estoque</span>
          </div>
          <div className="report-list-metric">
            <strong>{money(row.inventoryCostValue)}</strong>
            <span>capital parado</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MovementSummary({ rows }: { rows: InventoryReportMovementSummary[] }) {
  if (rows.length === 0) return <div className="report-empty">Nenhuma movimentacao no periodo.</div>;
  return (
    <div className="movement-summary-grid">
      {rows.map(row => (
        <div className="movement-summary-card" key={row.type}>
          <span>{movementLabels[row.type] || row.type}</span>
          <strong>{number(row.netQuantity)} un.</strong>
          <small>{row.movementCount} movimento{row.movementCount === 1 ? '' : 's'} - {money(row.estimatedValue)}</small>
        </div>
      ))}
    </div>
  );
}
