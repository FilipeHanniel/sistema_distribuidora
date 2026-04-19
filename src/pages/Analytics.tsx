import { useMemo } from 'react';
import { useSalesStore } from '../store/useSalesStore';
import { useInventoryStore } from '../store/useInventoryStore';
import { DollarSign, TrendingUp, PackageSearch, AlertTriangle, ShoppingBag } from 'lucide-react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer 
} from 'recharts';
import './Analytics.css';

export default function Analytics() {
  const { sales } = useSalesStore();
  const { products } = useInventoryStore();

  // ----- KPI Calculations -----
  const totalRevenue = useMemo(() => {
    return sales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  }, [sales]);

  const totalSalesCount = sales.length;

  // Estimated Profit = Revenue - Estimated Cost
  // For each sale item, we try to find the current cost in inventory.
  const estimatedProfit = useMemo(() => {
    return sales.reduce((profitSum, sale) => {
      const saleCost = sale.items.reduce((itemCostSum, item) => {
        const product = products.find(p => p.id === item.productId);
        const unitCost = product ? product.costPrice : 0;
        return itemCostSum + (unitCost * item.quantity);
      }, 0);
      return profitSum + (sale.totalAmount - saleCost);
    }, 0);
  }, [sales, products]);

  // ----- Top Sellers Analysis -----
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

    return Object.values(itemCounts)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5); // Top 5
  }, [sales]);

  // ----- Recharts Data (Revenue past 7 days simplified) -----
  // For a real app, you would group by exact Date. Here we will group by date string.
  const chartData = useMemo(() => {
    const daily: Record<string, number> = {};
    
    // Create base last 7 days to always show a trend even if no sales
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      daily[dateStr] = 0;
    }

    sales.forEach(sale => {
      const d = new Date(sale.createdAt);
      const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      if (daily[dateStr] !== undefined) {
        daily[dateStr] += sale.totalAmount;
      }
    });

    return Object.entries(daily).map(([date, amount]) => ({
      name: date,
      Faturamento: amount
    }));
  }, [sales]);

  // ----- Stock Alerts -----
  const lowStockProducts = useMemo(() => {
    // Assuming low stock threshold is <= 5
    return products.filter(p => p.stock <= 5).sort((a, b) => a.stock - b.stock);
  }, [products]);


  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  // Custom tooltips
  const CustomTooltip = ({ active, payload, label }: any) => {
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

  return (
    <div className="page-container">
      <div className="analytics-container">
        
        {/* KPIs */}
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon primary">
              <DollarSign size={24} />
            </div>
            <div className="kpi-content">
              <span className="kpi-title">Faturamento Total</span>
              <span className="kpi-value">{formatCurrency(totalRevenue)}</span>
            </div>
          </div>
          
          <div className="kpi-card">
            <div className="kpi-icon success">
              <TrendingUp size={24} />
            </div>
            <div className="kpi-content">
              <span className="kpi-title">Lucro Estimado</span>
              <span className="kpi-value">{formatCurrency(estimatedProfit)}</span>
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-icon warning">
              <ShoppingBag size={24} />
            </div>
            <div className="kpi-content">
              <span className="kpi-title">Vendas Realizadas</span>
              <span className="kpi-value">{totalSalesCount}</span>
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="dashboard-grid">
          
          {/* Main Chart Column */}
          <div className="chart-card" style={{ height: '400px' }}>
            <h3><TrendingUp size={20} color="var(--primary)" /> Faturamento (Últimos 7 dias)</h3>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: 'var(--text-secondary)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fill: 'var(--text-secondary)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(val) => `R$${val}`}
                />
                <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                <Bar 
                  dataKey="Faturamento" 
                  fill="var(--primary)" 
                  radius={[4, 4, 0, 0]} 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Right Column: Lists */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            
            {/* Top Sellers */}
            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <PackageSearch size={20} color="var(--primary)" /> 
                Mais Vendidos
              </h3>
              {topSellers.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>Nenhuma venda registrada.</p>
              ) : (
                <div className="data-list">
                  {topSellers.map((item, index) => (
                    <div className="data-item" key={index}>
                      <div className="data-item-info">
                        <span className="data-item-name">{item.name}</span>
                        <span className="data-item-sub">{item.quantity} unidades</span>
                      </div>
                      <span className="data-item-value">{formatCurrency(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Alerts */}
            <div className="card">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--secondary)' }}>
                <AlertTriangle size={20} /> 
                Avisos de Estoque
              </h3>
              {lowStockProducts.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>Estoque regularizado.</p>
              ) : (
                <div className="data-list">
                  {lowStockProducts.slice(0, 4).map(product => (
                    <div className="alert-item" key={product.id}>
                      <div className="data-item-info">
                        <span className="data-item-name">{product.name}</span>
                        <span className="data-item-sub">Estoque atual: {product.stock}</span>
                      </div>
                    </div>
                  ))}
                  {lowStockProducts.length > 4 && (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                      + {lowStockProducts.length - 4} produtos em baixa
                    </p>
                  )}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
