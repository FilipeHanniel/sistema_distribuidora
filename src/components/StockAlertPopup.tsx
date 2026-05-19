import { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { useInventoryStore } from '../store/useInventoryStore';
import './StockAlertPopup.css';

export default function StockAlertPopup() {
  const { products } = useInventoryStore();
  const [dismissedAtCount, setDismissedAtCount] = useState<number | null>(null);

  const lowStockProducts = products.filter(p => p.stock <= 5);
  const isHidden = dismissedAtCount !== null && lowStockProducts.length <= dismissedAtCount;

  if (lowStockProducts.length === 0 || isHidden) {
    return null;
  }

  return (
    <div className="stock-alert-popup">
      <div className="stock-alert-header">
        <div className="stock-alert-title">
          <AlertCircle size={20} className="alert-icon" />
          <span>Aviso de Estoque Baixo</span>
        </div>
        <button className="stock-alert-close" onClick={() => setDismissedAtCount(lowStockProducts.length)}>
          <X size={18} />
        </button>
      </div>
      <div className="stock-alert-body">
        <p>Você possui <strong>{lowStockProducts.length}</strong> {lowStockProducts.length === 1 ? 'produto' : 'produtos'} chegando ao fim do estoque.</p>
        <ul className="stock-alert-list">
          {lowStockProducts.slice(0, 3).map(p => (
            <li key={p.id}>{p.name} - <span>{p.stock} un</span></li>
          ))}
        </ul>
        {lowStockProducts.length > 3 && (
          <p className="stock-alert-more">+ {lowStockProducts.length - 3} outros itens</p>
        )}
      </div>
    </div>
  );
}
