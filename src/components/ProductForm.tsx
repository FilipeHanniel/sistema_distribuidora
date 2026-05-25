import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { Product } from '../types';

type ProductFormData = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

interface ProductFormProps {
  initialData?: Product | null;
  onSubmit: (data: ProductFormData) => void;
  onCancel: () => void;
}

const emptyFormData: ProductFormData = {
  barcode: '',
  name: '',
  category: '',
  costPrice: 0,
  sellPrice: 0,
  stock: 0,
  ncm: '',
  cfop: '',
  csosn: '',
  cst: '',
  fiscalUnit: 'UN',
  origin: '0',
  taxRate: 0,
};

function getInitialFormData(initialData?: Product | null): ProductFormData {
  if (!initialData) return emptyFormData;
  return {
    barcode: initialData.barcode,
    name: initialData.name,
    category: initialData.category,
    costPrice: initialData.costPrice,
    sellPrice: initialData.sellPrice,
    stock: initialData.stock,
    ncm: initialData.ncm || '',
    cfop: initialData.cfop || '',
    csosn: initialData.csosn || '',
    cst: initialData.cst || '',
    fiscalUnit: initialData.fiscalUnit || 'UN',
    origin: initialData.origin || '0',
    taxRate: initialData.taxRate || 0,
    establishmentId: initialData.establishmentId,
  };
}

export default function ProductForm({ initialData, onSubmit, onCancel }: ProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>(() => getInitialFormData(initialData));

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? Number(value) : value,
    }));
  };

  const handleSubmit = (e: FormEvent) => {
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
            disabled={!!initialData}
          />
        </div>
      </div>

      <div className="form-group">
        <label>Dados fiscais para NFC-e</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
          <input
            type="text"
            name="ncm"
            value={formData.ncm || ''}
            onChange={handleChange}
            className="form-control"
            placeholder="NCM"
          />
          <input
            type="text"
            name="cfop"
            value={formData.cfop || ''}
            onChange={handleChange}
            className="form-control"
            placeholder="CFOP"
          />
          <input
            type="text"
            name="csosn"
            value={formData.csosn || ''}
            onChange={handleChange}
            className="form-control"
            placeholder="CSOSN"
          />
          <input
            type="text"
            name="cst"
            value={formData.cst || ''}
            onChange={handleChange}
            className="form-control"
            placeholder="CST"
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Unidade fiscal</label>
          <input
            type="text"
            name="fiscalUnit"
            value={formData.fiscalUnit || 'UN'}
            onChange={handleChange}
            className="form-control"
            placeholder="UN"
          />
        </div>
        <div className="form-group">
          <label>Origem</label>
          <input
            type="text"
            name="origin"
            value={formData.origin || '0'}
            onChange={handleChange}
            className="form-control"
            placeholder="0"
          />
        </div>
        <div className="form-group">
          <label>Aliquota ICMS (%)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            name="taxRate"
            value={formData.taxRate || ''}
            onChange={handleChange}
            className="form-control"
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
