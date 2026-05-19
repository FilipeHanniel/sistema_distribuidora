import { Pencil, Trash2, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { useInventoryStore } from '../store/useInventoryStore';
import type { Product } from '../types';

interface ProductListProps {
  searchTerm: string;
  onEdit: (product: Product) => void;
  onAdjustStock: (product: Product, type: 'in' | 'out') => void;
}

export default function ProductList({ searchTerm, onEdit, onAdjustStock }: ProductListProps) {
  const { products, deleteProduct } = useInventoryStore();

  const filteredProducts = products.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    p.barcode.includes(searchTerm)
  );

  const getStockStatus = (stock: number) => {
    if (stock === 0) return { label: 'Esgotado', color: 'var(--secondary)' };
    if (stock <= 10) return { label: 'Baixo', color: '#F59E0B' }; // Orange warning
    return { label: 'Normal', color: '#10B981' }; // Green ok
  };

  if (products.length === 0) {
    return (
      <div className="empty-state">
        <p>Nenhum produto cadastrado no momento.</p>
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="inventory-table">
        <thead>
          <tr>
            <th>Produto</th>
            <th>Código / Categoria</th>
            <th>Custo</th>
            <th>Venda</th>
            <th>Estoque</th>
            <th>Status</th>
            <th style={{ textAlign: 'right' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {filteredProducts.map((product) => {
            const status = getStockStatus(product.stock);
            return (
              <tr key={product.id}>
                <td>
                  <strong>{product.name}</strong>
                </td>
                <td>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{product.barcode}</div>
                  <div style={{ fontSize: '0.85rem' }}>{product.category}</div>
                </td>
                <td>R$ {product.costPrice.toFixed(2)}</td>
                <td>R$ {product.sellPrice.toFixed(2)}</td>
                <td>
                  <div className="stock-control">
                    <span>{product.stock} un.</span>
                  </div>
                </td>
                <td>
                  <span className="badge" style={{ backgroundColor: status.color, color: '#fff' }}>
                    {status.label}
                  </span>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div className="action-buttons">
                     <button className="icon-btn btn-stock-in" onClick={() => onAdjustStock(product, 'in')} title="Entrada Rápida">
                      <ArrowUpCircle size={18} />
                    </button>
                    <button className="icon-btn btn-stock-out" onClick={() => onAdjustStock(product, 'out')} title="Saída (Perda/Ajuste)">
                      <ArrowDownCircle size={18} />
                    </button>
                    <button className="icon-btn" onClick={() => onEdit(product)} title="Editar Produto">
                      <Pencil size={18} />
                    </button>
                    <button className="icon-btn text-danger" onClick={() => {
                        if(window.confirm('Tem certeza que deseja apagar este produto?')) {
                            deleteProduct(product.id);
                        }
                    }} title="Excluir Produto">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
