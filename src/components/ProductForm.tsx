import React, { useState, useEffect } from 'react';
import type { Product } from '../types';

interface ProductFormProps {
  initialData?: Product | null;
  onSubmit: (data: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onCancel: () => void;
}

export default function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
  const [formData, setFormData] = useState({
    barcode: '',
    name: '',
    category: '',
    costPrice: 0,
    sellPrice: 0,
    stock: 0,
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        barcode: initialData.barcode,
        name: initialData.name,
        category: initialData.category,
        costPrice: initialData.costPrice,
        sellPrice: initialData.sellPrice,
        stock: initialData.stock,
      });
    } else {
      setFormData({
        barcode: '',
        name: '',
        category: '',
        costPrice: 0,
        sellPrice: 0,
        stock: 0,
      });
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Nome do Produto</label>
        <input 
          autoFocus
          required 
          type="text" 
          name="name" 
          value={formData.name} 
          onChange={handleChange} 
          className="form-control" 
          placeholder="Ex: Pepsi Cola 2L"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Código de Barras</label>
          <input 
            required 
            type="text" 
            name="barcode" 
            value={formData.barcode} 
            onChange={handleChange} 
            className="form-control" 
            placeholder="EAN-13"
          />
        </div>
        <div className="form-group">
          <label>Categoria</label>
          <input 
            required 
            type="text" 
            name="category" 
            value={formData.category} 
            onChange={handleChange} 
            className="form-control" 
            placeholder="Ex: Refrigerantes"
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Custo (R$)</label>
          <input 
            required 
            type="number" 
            step="0.01"
            min="0"
            name="costPrice" 
            value={formData.costPrice || ''} 
            onChange={handleChange} 
            className="form-control" 
          />
        </div>
        <div className="form-group">
          <label>Venda (R$)</label>
          <input 
            required 
            type="number" 
            step="0.01"
            min="0"
            name="sellPrice" 
            value={formData.sellPrice || ''} 
            onChange={handleChange} 
            className="form-control" 
          />
        </div>
        <div className="form-group">
          <label>Qtd. Inicial</label>
          <input 
            required 
            type="number"
            min="0"
            name="stock" 
            value={formData.stock || ''} 
            onChange={handleChange} 
            className="form-control" 
            disabled={!!initialData} // Disable stock edit on form if initialData exists, standard practice is a separate stock movement
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn btn-primary">
          {initialData ? 'Salvar Alterações' : 'Cadastrar Produto'}
        </button>
      </div>
    </form>
  );
}
