import React, { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import ProductList from '../components/ProductList';
import ProductForm from '../components/ProductForm';
import Modal from '../components/Modal';
import { useInventoryStore } from '../store/useInventoryStore';
import type { Product } from '../types';
import './Inventory.css';

export default function Inventory() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  
  // Modals for Stock Ajustment
  const [stockModal, setStockModal] = useState<{isOpen: boolean, product: Product | null, type: 'in' | 'out' | null}>({ isOpen: false, product: null, type: null });
  const [amount, setAmount] = useState<number>(1);

  const { addProduct, updateProduct, updateStock, products } = useInventoryStore();

  const handleOpenForm = (product?: Product) => {
    if (product) {
      setProductToEdit(product);
    } else {
      setProductToEdit(null);
    }
    setIsFormModalOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormModalOpen(false);
    setProductToEdit(null);
  };

  const handleFormSubmit = (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (productToEdit) {
      updateProduct(productToEdit.id, data);
    } else {
      addProduct(data);
    }
    handleCloseForm();
  };

  const handleOpenStockAdjust = (product: Product, type: 'in' | 'out') => {
    setStockModal({ isOpen: true, product, type });
    setAmount(1);
  };

  const handleConfirmStockAdjust = (e: React.FormEvent) => {
    e.preventDefault();
    if (stockModal.product && stockModal.type) {
      const step = stockModal.type === 'in' ? amount : -amount;
      updateStock(stockModal.product.id, step);
      setStockModal({ isOpen: false, product: null, type: null });
    }
  };

  const widgets = [
    { title: 'Total de Produtos', value: products.length },
    { title: 'Em Estoque Baixo', value: products.filter(p => p.stock <= 10 && p.stock > 0).length },
    { title: 'Esgotados', value: products.filter(p => p.stock === 0).length },
  ];

  return (
    <div className="page-container">
      <div className="inventory-header">
        <h1>Controle de Estoque</h1>
        <button className="btn btn-primary" onClick={() => handleOpenForm()}>
          <Plus size={18} /> Novo Produto
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {widgets.map((w, idx) => (
            <div key={idx} className="card">
                <h4 style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.875rem' }}>{w.title}</h4>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{w.value}</div>
            </div>
        ))}
      </div>

      <div className="search-box" style={{ marginBottom: '1.5rem' }}>
        <Search size={18} className="search-icon" />
        <input 
          type="text" 
          placeholder="Buscar produto por nome ou código..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <ProductList 
        searchTerm={searchTerm} 
        onEdit={handleOpenForm} 
        onAdjustStock={handleOpenStockAdjust} 
      />

      {/* Form Modal */}
      <Modal 
        isOpen={isFormModalOpen} 
        onClose={handleCloseForm} 
        title={productToEdit ? 'Editar Produto' : 'Cadastrar Novo Produto'}
      >
        <ProductForm 
          initialData={productToEdit} 
          onSubmit={handleFormSubmit} 
          onCancel={handleCloseForm} 
        />
      </Modal>

      {/* Stock Adjustment Modal */}
      <Modal 
        isOpen={stockModal.isOpen} 
        onClose={() => setStockModal({ isOpen: false, product: null, type: null })} 
        title={stockModal.type === 'in' ? 'Entrada de Estoque' : 'Ajuste de Saída / Perda'}
      >
        {stockModal.product && (
          <form onSubmit={handleConfirmStockAdjust}>
            <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
              Produto: <strong>{stockModal.product.name}</strong> <br/>
              Estoque Atual: {stockModal.product.stock}
            </p>
            <div className="form-group">
              <label>Quantidade a {stockModal.type === 'in' ? 'Adicionar' : 'Retirar'}</label>
              <input 
                autoFocus
                required 
                type="number" 
                min="1"
                value={amount} 
                onChange={(e) => setAmount(Number(e.target.value))} 
                className="form-control" 
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStockModal({ isOpen: false, product: null, type: null })}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Confirmar</button>
            </div>
          </form>
        )}
      </Modal>

    </div>
  );
}
