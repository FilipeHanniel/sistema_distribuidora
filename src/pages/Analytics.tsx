import { useMemo } from 'react';
import { useSalesStore } from '../store/useSalesStore';
import { useInventoryStore } from '../store/useInventoryStore';
import { DollarSign, TrendingUp, ShoppingBag, Package, Banknote, CreditCard, QrCode } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend
} from 'recharts';
import './Analytics.css';

const COLORS = ['#005CB9', '#8b5cf6', '#10B981', '#F59E0B', '#E42229'];

export default function Analytics() {
  const { sales } = useSalesStore();
  const { products } = useInventoryStore();

  const totalRevenue = useMemo(() => sales.reduce((sum, s) => sum + s.totalAmount, 0), [sales]);
  const totalSalesCount = sales.length;
  const avgTicket = totalSalesCount > 0 ? totalRevenue / totalSalesCount : 0;

  const estimatedProfit = useMemo(() => {
    return sales.reduce((profitSum, sale) => {
      const saleCost = sale.items.reduce((c, item) => {
        const product = products.find(p => p.id === item.productId);
        return c + ((product?.costPrice ?? 0) * item.quantity);
      }, 0);
      return profitSum + (sale.totalAmount - saleCost);
    }, 0);
  }, [sales, products]);

  const profitMargin = totalRevenue > 0 ? (estimatedProfit / totalRevenue) * 100 : 0;

  const topSellers = useMemo(() => {
    const itemCounts: Record<string, { name: string; quantity: number; revenue: number }> = {};
    sales.forEach(sale => {
      sale.items.forEach(item => {
        if (!itemCounts[item.productId]) {
          itemCounts[item.productId] = { name: item.name, quantity: 0, revenue: 0 };
        }
        itemCounts[item.productId].quantity += item.quantity;
        itemCounts[item.productId].revenue += item.totalPrice;
      });
    });
    return Object.values(itemCounts).sort((a, b) => b.quantity - a.quantity).slice(0, 5);
  }, [sales]);

  // Faturamento últimos 14 dias
  const areaChartData = useMemo(() => {
    const daily: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      daily[key] = 0;
    }
    sales.forEach(sale => {
      const key = new Date(sale.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (daily[key] !== undefined) daily[key] += sale.totalAmount;
    });
    return Object.entries(daily).map(([date, amount]) => ({ name: date, Faturamento: amount }));
  }, [sales]);

  // Forma de pagamento
  const paymentData = useMemo(() => {
    const counts: Record<string, number> = { money: 0, card: 0, pix: 0 };
    sales.forEach(s => { if (counts[s.paymentMethod] !== undefined) counts[s.paymentMethod]++; });
    const total = sales.length || 1;
    return [
      { name: 'Dinheiro', value: counts.money, pct: Math.round((counts.money / total) * 100) },
      { name: 'Cartão', value: counts.card, pct: Math.round((counts.card / total) * 100) },
      { name: 'PIX', value: counts.pix, pct: Math.round((counts.pix / total) * 100) },
    ].filter(d => d.value > 0);
  }, [sales]);

  // Top sellers bar chart
  const barData = topSellers.map(s => ({ name: s.name.split(' ').slice(0, 2).join(' '), Unidades: s.quantity, Receita: s.revenue }));

  // Estoque por categoria
  const categoryStock = useMemo(() => {
    const cats: Record<string, number> = {};
    products.forEach(p => { cats[p.category] = (cats[p.category] || 0) + p.stock; });
    return Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [products]);

  const lowStockProducts = useMemo(() => products.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock), [products]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const CustomAreaTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="label">{label}</p>
          <p className="value">{formatCurrency(payload[0].value)}</p>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="custom-tooltip">
          <p className="label">{label}</p>
          <p className="value">{payload[0].value} un. - {formatCurrency(payload[1]?.value ?? 0)}</p>
        </div>
      );
    }
    return null;
  };

  const kpis = [
    {
      icon: <DollarSign size={22} />,
      label: 'Faturamento Total',
      value: formatCurrency(totalRevenue),
      color: 'primary',
      sub: `${totalSalesCount} venda${totalSalesCount !== 1 ? 's' : ''} registrada${totalSalesCount !== 1 ? 's' : ''}`,
    },
    {
      icon: <TrendingUp size={22} />,
      label: 'Lucro Estimado',
      value: formatCurrency(estimatedProfit),
      color: 'success',
      sub: `Margem: ${profitMargin.toFixed(1)}%`,
    },
    {
      icon: <ShoppingBag size={22} />,
      label: 'Ticket Médio',
      value: formatCurrency(avgTicket),
      color: 'warning',
      sub: 'Por venda',
    },
    {
      icon: <Package size={22} />,
      label: 'Produtos Cadastrados',
      value: products.length.toString(),
      color: 'info',
      sub: `${lowStockProducts.length} com estoque baixo`,
    },
  ];

  return (
    <div className="page-container">
      <div className="analytics-container">

        {/* KPIs */}
        <div className="kpi-grid">
          {kpis.map((kpi, i) => (
            <div key={i} className={`kpi-card kpi-${kpi.color}`}>
              <div className={`kpi-icon ${kpi.color}`}>{kpi.icon}</div>
              <div className="kpi-content">
                <span className="kpi-title">{kpi.label}</span>
                <span className="kpi-value">{kpi.value}</span>
                <span className="kpi-sub">{kpi.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Área Chart + Pagamentos */}
        <div className="charts-row">
          <div className="chart-card chart-main">
            <div className="chart-card-header">
              <h3><TrendingUp size={18} /> Faturamento — Últimos 14 Dias</h3>
            </div>
            <ResponsiveContainer width="100%" height={220} minWidth={0}>
              <AreaChart data={areaChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorFat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `R$${v}`} />
                <RechartsTooltip content={<CustomAreaTooltip />} cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="Faturamento" stroke="var(--primary)" strokeWidth={2.5} fill="url(#colorFat)" dot={false} activeDot={{ r: 5, fill: 'var(--primary)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="chart-card chart-side">
            <div className="chart-card-header">
              <h3>💳 Formas de Pagamento</h3>
            </div>
            {paymentData.length === 0 ? (
              <div className="chart-empty">Nenhuma venda registrada</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={paymentData} cx="50%" cy="50%" innerRadius={50} outerRadius={70} paddingAngle={3} dataKey="value">
                      {paymentData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend formatter={(value) => <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{value}</span>} />
                    <RechartsTooltip formatter={(value, name) => [`${value} vendas`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="payment-breakdown">
                  {paymentData.map((d, i) => {
                    const icons = [<Banknote size={14} />, <CreditCard size={14} />, <QrCode size={14} />];
                    return (
                      <div key={d.name} className="payment-row">
                        <span className="payment-dot" style={{ background: COLORS[i] }} />
                        <span className="payment-row-icon">{icons[i]}</span>
                        <span className="payment-row-label">{d.name}</span>
                        <span className="payment-row-pct">{d.pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Mais Vendidos Bar Chart */}
        {topSellers.length > 0 && (
          <div className="chart-card">
            <div className="chart-card-header">
              <h3>🏆 Top 5 Mais Vendidos</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <RechartsTooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="Unidades" radius={[0, 4, 4, 0]}>
                  {barData.map((_, index) => (
                    <Cell key={`bar-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Bottom row */}
        <div className="bottom-row">
          {/* Estoque por Categoria */}
          <div className="chart-card">
            <div className="chart-card-header">
              <h3><Package size={18} /> Estoque por Categoria</h3>
            </div>
            <div className="category-stock-list">
              {categoryStock.map((cat, i) => {
                const maxVal = categoryStock[0]?.value || 1;
                const pct = Math.round((cat.value / maxVal) * 100);
                return (
                  <div key={cat.name} className="category-stock-row">
                    <div className="cat-info">
                      <span className="cat-name">{cat.name}</span>
                      <span className="cat-count">{cat.value} un.</span>
                    </div>
                    <div className="cat-bar-bg">
                      <div className="cat-bar-fill" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Alertas de Estoque */}
          <div className="chart-card">
            <div className="chart-card-header">
              <h3 style={{ color: lowStockProducts.length > 0 ? 'var(--secondary)' : undefined }}>
                ⚠️ Alertas de Estoque Baixo
              </h3>
            </div>
            {lowStockProducts.length === 0 ? (
              <div className="chart-empty" style={{ color: '#10B981' }}>✅ Estoque regularizado</div>
            ) : (
              <div className="data-list">
                {lowStockProducts.slice(0, 6).map(product => (
                  <div className="alert-item" key={product.id}>
                    <div className="data-item-info">
                      <span className="data-item-name">{product.name}</span>
                      <span className="data-item-sub">Categoria: {product.category}</span>
                    </div>
                    <div className={`stock-badge ${product.stock === 0 ? 'empty' : 'low'}`}>
                      {product.stock === 0 ? 'Esgotado' : `${product.stock} un.`}
                    </div>
                  </div>
                ))}
                {lowStockProducts.length > 6 && (
                  <p className="more-label">+{lowStockProducts.length - 6} produtos em baixa</p>
                )}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
