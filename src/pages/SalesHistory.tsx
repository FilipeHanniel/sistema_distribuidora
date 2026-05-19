import { useState, useMemo, useEffect } from 'react';
import { Search, Receipt, Banknote, CreditCard, QrCode, CalendarRange, ChevronDown, ChevronUp, TrendingUp, Download, FileText, Printer } from 'lucide-react';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../store/useAuthStore';
import type { Sale } from '../types';
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

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

const formatDateShort = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR');

export default function SalesHistory() {
  const { sales, fetchSales } = useSalesStore();
  const { user, isOperador } = useAuthStore();
  const [searchDate, setSearchDate] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [todaySales, setTodaySales] = useState<Sale[]>([]);

  const operador = isOperador();

  // Operador: buscar apenas vendas do dia via endpoint dedicado
  useEffect(() => {
    if (operador) {
      const token = useAuthStore.getState().token;
      fetch('/api/sales/today', {
        headers: { Authorization: `Bearer ${token}` }
      }).then(r => r.ok ? r.json() : []).then(setTodaySales);
    } else {
      fetchSales();
    }
  }, [operador, fetchSales]);

  const sourceSales = operador ? todaySales : sales;

  const filtered = useMemo(() => {
    if (!searchDate || operador) return sourceSales;
    const target = new Date(searchDate);
    const targetDate = target.toLocaleDateString('pt-BR');
    return sourceSales.filter(s => {
      const saleDate = new Date(s.createdAt).toLocaleDateString('pt-BR');
      return saleDate === targetDate;
    });
  }, [sourceSales, searchDate, operador]);

  const totalRevenue = filtered.reduce((acc, s) => acc + s.totalAmount, 0);

  // ---- Exportar CSV ----
  const exportCSV = () => {
    const header = 'ID,Data,Forma de Pagamento,Total (R$),Itens\n';
    const rows = filtered.map(sale => {
      const itemsStr = (sale.items || [])
        .map(i => `${i.name} (${i.quantity}x R$${i.unitPrice.toFixed(2)})`)
        .join(' | ');
      return [
        sale.id.slice(0, 8).toUpperCase(),
        formatDate(sale.createdAt),
        METHOD_LABELS[sale.paymentMethod] || sale.paymentMethod,
        sale.totalAmount.toFixed(2),
        `"${itemsStr}"`,
      ].join(',');
    }).join('\n');

    const csv = '\uFEFF' + header + rows; // BOM para UTF-8 no Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = searchDate || new Date().toISOString().split('T')[0];
    a.download = `comprovantes_${dateStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- Imprimir / PDF ----
  const exportPrint = () => {
    const printContent = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Comprovantes de Venda</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 24px; }
          h1 { font-size: 18px; margin-bottom: 4px; }
          .subtitle { color: #666; margin-bottom: 20px; font-size: 11px; }
          .summary { display: flex; gap: 24px; margin-bottom: 20px; }
          .sum-item { background: #f3f4f6; padding: 10px 16px; border-radius: 8px; }
          .sum-label { font-size: 10px; color: #666; margin-bottom: 2px; }
          .sum-value { font-size: 16px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; }
          thead th { background: #1a56db; color: #fff; padding: 8px 10px; text-align: left; font-size: 11px; }
          tbody tr:nth-child(even) { background: #f9fafb; }
          tbody td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
          .items { font-size: 10px; color: #666; margin-top: 2px; }
          .total { font-weight: bold; text-align: right; }
          tfoot td { padding: 10px; font-weight: bold; background: #f3f4f6; }
          @media print {
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <h1>Comprovantes de Venda</h1>
        <p class="subtitle">Gerado em ${new Date().toLocaleString('pt-BR')} — Período: ${searchDate ? formatDateShort(searchDate) : 'Todos os registros'}</p>
        <div class="summary">
          <div class="sum-item"><div class="sum-label">Total de Vendas</div><div class="sum-value">${filtered.length}</div></div>
          <div class="sum-item"><div class="sum-label">Receita Total</div><div class="sum-value">${formatCurrency(totalRevenue)}</div></div>
          <div class="sum-item"><div class="sum-label">Ticket Médio</div><div class="sum-value">${filtered.length ? formatCurrency(totalRevenue / filtered.length) : 'R$ 0,00'}</div></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Data/Hora</th><th>Pagamento</th><th>Itens</th><th style="text-align:right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(sale => `
              <tr>
                <td>#${sale.id.slice(0, 8).toUpperCase()}</td>
                <td>${formatDate(sale.createdAt)}</td>
                <td>${METHOD_LABELS[sale.paymentMethod] || sale.paymentMethod}</td>
                <td>
                  ${(sale.items || []).map(i =>
                    `<div>${i.name} — ${i.quantity}x ${formatCurrency(i.unitPrice)}</div>`
                  ).join('')}
                </td>
                <td class="total">${formatCurrency(sale.totalAmount)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="text-align:right">Total Geral (${filtered.length} vendas)</td>
              <td style="text-align:right">${formatCurrency(totalRevenue)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(printContent);
      win.document.close();
      setTimeout(() => win.print(), 300);
    }
  };

  const widgets = [
    { title: operador ? 'Vendas Hoje' : 'Vendas no Período', value: filtered.length, icon: <Receipt size={20} /> },
    { title: 'Receita Total', value: formatCurrency(totalRevenue), icon: <TrendingUp size={20} /> },
    { title: 'Ticket Médio', value: filtered.length ? formatCurrency(totalRevenue / filtered.length) : 'R$ 0,00', icon: <Receipt size={20} /> },
  ];

  return (
    <div className="page-container history-page">
      <div className="history-header">
        <div>
          <h1>{operador ? 'Comprovantes do Dia' : 'Comprovantes de Venda'}</h1>
          <p className="subtitle">
            {operador
              ? `Transações realizadas hoje, ${new Date().toLocaleDateString('pt-BR')}`
              : 'Histórico completo de transações realizadas'}
          </p>
        </div>
        {!operador && (
          <div className="history-export-actions">
            <button className="btn btn-secondary" onClick={exportCSV} title="Baixar CSV">
              <Download size={16} /> CSV
            </button>
            <button className="btn btn-secondary" onClick={exportPrint} title="Imprimir / PDF">
              <Printer size={16} /> Imprimir
            </button>
          </div>
        )}
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

      {!operador && (
        <div className="history-filters">
          <div className="date-filter">
            <CalendarRange size={18} className="filter-icon" />
            <label>Filtrar por data:</label>
            <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} />
            {searchDate && <button className="clear-filter" onClick={() => setSearchDate('')}>Limpar</button>}
          </div>
          <span className="result-count">{filtered.length} {filtered.length === 1 ? 'comprovante' : 'comprovantes'}</span>
        </div>
      )}

      {operador && (
        <div className="history-filters">
          <span className="result-count" style={{ marginLeft: 0 }}>
            {filtered.length} {filtered.length === 1 ? 'venda realizada hoje' : 'vendas realizadas hoje'}
          </span>
        </div>
      )}

      <div className="receipts-list">
        {filtered.length === 0 ? (
          <div className="receipts-empty">
            <Receipt size={48} opacity={0.3} />
            <p>
              {operador
                ? 'Nenhuma venda registrada hoje ainda.'
                : `Nenhum comprovante encontrado${searchDate ? ' para esta data' : ''}.`}
            </p>
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
