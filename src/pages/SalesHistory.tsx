import { useState, useMemo } from 'react';
import { Search, Receipt, Banknote, CreditCard, QrCode, CalendarRange, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';
import { useSalesStore } from '../store/useSalesStore';
import './SalesHistory.css';

const METHOD_ICONS: Record<string, JSX.Element> = {
  money: <Banknote size={16} />,
  card: <CreditCard size={16} />,
  pix: <QrCode size={16} />,
};
const METHOD_LABELS: Record<string, string> = {
  money: 'Dinheiro',
  card: 'Cartão',
  pix: 'PIX',
};

export default function SalesHistory() {
  const { sales } = useSalesStore();
  const [searchDate, setSearchDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  const filtered = useMemo(() => {
    if (!searchDate) return sales;
    const target = new Date(searchDate);
    const targetDate = target.toLocaleDateString('pt-BR');
    return sales.filter(s => {
      const saleDate = new Date(s.createdAt).toLocaleDateString('pt-BR');
      return saleDate === targetDate;
    });
  }, [sales, searchDate]);

  const totalRevenue = filtered.reduce((acc, s) => acc + s.totalAmount, 0);

  const widgets = [
    { title: 'Vendas no Período', value: filtered.length, icon: <Receipt size={20} /> },
    { title: 'Receita Total', value: formatCurrency(totalRevenue), icon: <TrendingUp size={20} /> },
    { title: 'Ticket Médio', value: filtered.length ? formatCurrency(totalRevenue / filtered.length) : 'R$ 0,00', icon: <Receipt size={20} /> },
  ];

  return (
    <div className="page-container history-page">
      <div className="history-header">
        <div>
          <h1>Comprovantes de Venda</h1>
          <p className="subtitle">Histórico completo de transações realizadas</p>
        </div>
      </div>

      <div className="history-widgets">
        {widgets.map((w, i) => (
          <div key={i} className="history-widget">
            <div className="hw-icon">{w.icon}</div>
            <div className="hw-content">
              <span className="hw-title">{w.title}</span>
              <span className="hw-value">{w.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="history-filters">
        <div className="date-filter">
          <CalendarRange size={18} className="filter-icon" />
          <label>Filtrar por data:</label>
          <input
            type="date"
            value={searchDate}
            onChange={e => setSearchDate(e.target.value)}
          />
          {searchDate && (
            <button className="clear-filter" onClick={() => setSearchDate('')}>Limpar</button>
          )}
        </div>
        <span className="result-count">{filtered.length} {filtered.length === 1 ? 'comprovante' : 'comprovantes'}</span>
      </div>

      <div className="receipts-list">
        {filtered.length === 0 ? (
          <div className="receipts-empty">
            <Receipt size={48} opacity={0.3} />
            <p>Nenhum comprovante encontrado{searchDate ? ' para esta data' : ''}.</p>
          </div>
        ) : (
          filtered.map(sale => {
            const isOpen = expandedId === sale.id;
            return (
              <div key={sale.id} className={`receipt-card ${isOpen ? 'receipt-card--open' : ''}`}>
                <div className="receipt-summary" onClick={() => setExpandedId(isOpen ? null : sale.id)}>
                  <div className="receipt-left">
                    <div className="receipt-method-icon">
                      {METHOD_ICONS[sale.paymentMethod] ?? <Receipt size={16} />}
                    </div>
                    <div className="receipt-info">
                      <span className="receipt-id">#{(sale as any).id?.slice(0, 8).toUpperCase()}</span>
                      <span className="receipt-time">{formatDate(sale.createdAt)}</span>
                    </div>
                  </div>

                  <div className="receipt-right">
                    <span className="receipt-method-label">
                      {METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod}
                    </span>
                    <span className="receipt-total">{formatCurrency(sale.totalAmount)}</span>
                    <div className="receipt-chevron">
                      {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="receipt-detail">
                    <table className="receipt-items-table">
                      <thead>
                        <tr>
                          <th>Produto</th>
                          <th className="text-right">Qtd</th>
                          <th className="text-right">Unit.</th>
                          <th className="text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sale.items?.map((item, idx) => (
                          <tr key={idx}>
                            <td>{item.name}</td>
                            <td className="text-right">{item.quantity}</td>
                            <td className="text-right">{formatCurrency(item.unitPrice)}</td>
                            <td className="text-right">{formatCurrency(item.totalPrice)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="text-right"><strong>Total da Venda</strong></td>
                          <td className="text-right receipt-grand-total">{formatCurrency(sale.totalAmount)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
