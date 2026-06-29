import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Building2, ClipboardList,
  Eye, FilePenLine, PackagePlus, Plus, RefreshCw, RotateCcw, Search, Trash2, Truck,
} from 'lucide-react';
import Modal from '../components/Modal';
import { apiRequest, getApiErrorMessage } from '../lib/api';
import { useInventoryStore } from '../store/useInventoryStore';
import type { Purchase, PurchaseItem, StockMovement, Supplier } from '../types';
import './Purchases.css';

type View = 'purchases' | 'suppliers' | 'movements';
type PurchaseDraftItem = { key: string; productId: string; quantity: number; unitCost: number };

const statusLabels = { draft: 'Rascunho', received: 'Recebida', cancelled: 'Cancelada' } as const;
const movementLabels: Record<string, string> = {
  initial_balance: 'Saldo inicial',
  purchase_receipt: 'Recebimento de compra',
  purchase_reversal: 'Cancelamento de compra',
  sale: 'Venda',
  manual_adjustment: 'Ajuste manual',
};

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
const dateTime = (value?: string | null) => value
  ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  : '-';
const emptySupplier = {
  name: '', legalName: '', document: '', email: '', phone: '', contactName: '', notes: '', active: 1,
};
const newDraftItem = (): PurchaseDraftItem => ({
  key: crypto.randomUUID(), productId: '', quantity: 1, unitCost: 0,
});

export default function Purchases() {
  const [view, setView] = useState<View>('purchases');
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [movementType, setMovementType] = useState('');
  const [movementProduct, setMovementProduct] = useState('');
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: '', invoiceNumber: '', notes: '' });
  const [purchaseItems, setPurchaseItems] = useState<PurchaseDraftItem[]>([newDraftItem()]);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [saving, setSaving] = useState(false);

  const products = useInventoryStore(state => state.products);
  const fetchProducts = useInventoryStore(state => state.fetchProducts);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [purchaseRows, supplierRows, movementRows] = await Promise.all([
        apiRequest<Purchase[]>('/purchases'),
        apiRequest<Supplier[]>('/suppliers?includeInactive=true'),
        apiRequest<StockMovement[]>('/stock-movements?limit=300'),
      ]);
      setPurchases(purchaseRows);
      setSuppliers(supplierRows);
      setMovements(movementRows);
      await fetchProducts();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel carregar compras e estoque.'));
    } finally {
      setLoading(false);
    }
  }, [fetchProducts]);

  useEffect(() => { loadData(); }, [loadData]);

  const activeSuppliers = suppliers.filter(supplier => supplier.active === 1);
  const filteredPurchases = purchases.filter(purchase => {
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || [purchase.supplierName, purchase.invoiceNumber, purchase.id]
      .some(value => String(value || '').toLowerCase().includes(term));
    return matchesSearch && (!statusFilter || purchase.status === statusFilter);
  });
  const filteredMovements = movements.filter(movement =>
    (!movementType || movement.type === movementType)
    && (!movementProduct || movement.productId === movementProduct)
  );
  const purchaseTotal = useMemo(() => purchaseItems.reduce((sum, item) =>
    sum + Number(item.quantity || 0) * Number(item.unitCost || 0), 0), [purchaseItems]);
  const inventoryValue = products.reduce((sum, product) => sum + product.stock * product.costPrice, 0);

  const showMessage = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const openNewPurchase = () => {
    setEditingPurchaseId(null);
    setPurchaseForm({ supplierId: '', invoiceNumber: '', notes: '' });
    setPurchaseItems([newDraftItem()]);
    setPurchaseModalOpen(true);
  };

  const openEditPurchase = async (purchase: Purchase) => {
    setSaving(true);
    setError('');
    try {
      const full = await apiRequest<Purchase>(`/purchases/${purchase.id}`);
      setEditingPurchaseId(full.id);
      setPurchaseForm({
        supplierId: full.supplierId || '', invoiceNumber: full.invoiceNumber || '', notes: full.notes || '',
      });
      setPurchaseItems((full.items || []).map(item => ({
        key: item.id, productId: item.productId, quantity: item.quantity, unitCost: item.unitCost,
      })));
      setSelectedPurchase(null);
      setPurchaseModalOpen(true);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel abrir o rascunho.'));
    } finally {
      setSaving(false);
    }
  };

  const updatePurchaseItem = (key: string, field: keyof Omit<PurchaseDraftItem, 'key'>, value: string | number) => {
    setPurchaseItems(current => current.map(item => {
      if (item.key !== key) return item;
      const next = { ...item, [field]: value };
      if (field === 'productId') {
        const product = products.find(candidate => candidate.id === value);
        if (product) next.unitCost = product.costPrice;
      }
      return next;
    }));
  };

  const savePurchase = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(editingPurchaseId ? `/purchases/${editingPurchaseId}` : '/purchases', {
        method: editingPurchaseId ? 'PUT' : 'POST',
        body: { ...purchaseForm, items: purchaseItems.map(({ productId, quantity, unitCost }) => ({ productId, quantity, unitCost })) },
      });
      setPurchaseModalOpen(false);
      showMessage(editingPurchaseId ? 'Rascunho atualizado.' : 'Compra salva como rascunho.');
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel salvar a compra.'));
    } finally {
      setSaving(false);
    }
  };

  const openPurchase = async (purchase: Purchase) => {
    setSaving(true);
    try {
      setSelectedPurchase(await apiRequest<Purchase>(`/purchases/${purchase.id}`));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel abrir a compra.'));
    } finally {
      setSaving(false);
    }
  };

  const runPurchaseAction = async (purchase: Purchase, action: 'receive' | 'cancel' | 'delete') => {
    const prompt = action === 'receive'
      ? 'Confirmar o recebimento e atualizar o estoque e o custo medio?'
      : action === 'cancel'
        ? 'Cancelar esta compra e reverter o estoque? A operacao so sera aceita se nao houver movimentos posteriores.'
        : 'Excluir este rascunho?';
    if (!window.confirm(prompt)) return;
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/purchases/${purchase.id}${action === 'delete' ? '' : `/${action}`}`, {
        method: action === 'delete' ? 'DELETE' : 'POST',
      });
      setSelectedPurchase(null);
      showMessage(action === 'receive' ? 'Compra recebida e estoque atualizado.' : action === 'cancel' ? 'Compra cancelada e estoque revertido.' : 'Rascunho excluido.');
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel concluir a operacao.'));
    } finally {
      setSaving(false);
    }
  };

  const openSupplier = (supplier?: Supplier) => {
    setEditingSupplierId(supplier?.id || null);
    setSupplierForm(supplier ? {
      name: supplier.name,
      legalName: supplier.legalName || '',
      document: supplier.document || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      contactName: supplier.contactName || '',
      notes: supplier.notes || '',
      active: supplier.active,
    } : emptySupplier);
    setSupplierModalOpen(true);
  };

  const saveSupplier = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest(editingSupplierId ? `/suppliers/${editingSupplierId}` : '/suppliers', {
        method: editingSupplierId ? 'PUT' : 'POST', body: supplierForm,
      });
      setSupplierModalOpen(false);
      showMessage(editingSupplierId ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.');
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel salvar o fornecedor.'));
    } finally {
      setSaving(false);
    }
  };

  const removeSupplier = async (supplier: Supplier) => {
    if (!window.confirm(`Remover ${supplier.name}? Fornecedores com historico serao apenas inativados.`)) return;
    try {
      const result = await apiRequest<{ message: string }>(`/suppliers/${supplier.id}`, { method: 'DELETE' });
      showMessage(result.message);
      await loadData();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Nao foi possivel remover o fornecedor.'));
    }
  };

  return (
    <div className="page-container purchases-page">
      <header className="purchases-header">
        <div>
          <h1><PackagePlus size={25} /> Compras e fornecedores</h1>
          <p>Registre entradas, acompanhe custos e mantenha a origem de cada movimento de estoque.</p>
        </div>
        <button className="btn btn-secondary" onClick={loadData} disabled={loading} title="Atualizar dados">
          <RefreshCw size={17} className={loading ? 'spin' : ''} /> Atualizar
        </button>
      </header>

      <div className="purchase-metrics">
        <div><span>Rascunhos em aberto</span><strong>{purchases.filter(item => item.status === 'draft').length}</strong></div>
        <div><span>Compras recebidas</span><strong>{purchases.filter(item => item.status === 'received').length}</strong></div>
        <div><span>Fornecedores ativos</span><strong>{activeSuppliers.length}</strong></div>
        <div><span>Valor atual em estoque</span><strong>{money(inventoryValue)}</strong></div>
      </div>

      <div className="purchase-tabs" role="tablist">
        <button className={view === 'purchases' ? 'active' : ''} onClick={() => setView('purchases')}><ClipboardList size={16} /> Compras</button>
        <button className={view === 'suppliers' ? 'active' : ''} onClick={() => setView('suppliers')}><Truck size={16} /> Fornecedores</button>
        <button className={view === 'movements' ? 'active' : ''} onClick={() => setView('movements')}><RotateCcw size={16} /> Movimentacoes</button>
      </div>

      {error && <div className="purchase-alert error"><AlertTriangle size={17} /> {error}<button onClick={() => setError('')}>Fechar</button></div>}
      {notice && <div className="purchase-alert success">{notice}</div>}

      {view === 'purchases' && (
        <section>
          <div className="purchase-toolbar">
            <div className="purchase-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar fornecedor, nota ou ID" /></div>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="">Todos os status</option>
              <option value="draft">Rascunhos</option><option value="received">Recebidas</option><option value="cancelled">Canceladas</option>
            </select>
            <button className="btn btn-primary" onClick={openNewPurchase}><Plus size={17} /> Nova compra</button>
          </div>
          <div className="purchase-table-wrap">
            <table className="purchase-table">
              <thead><tr><th>Data</th><th>Fornecedor</th><th>Documento</th><th>Itens</th><th>Total</th><th>Status</th><th aria-label="Acoes" /></tr></thead>
              <tbody>
                {!loading && filteredPurchases.length === 0 && <tr><td colSpan={7} className="purchase-empty">Nenhuma compra encontrada.</td></tr>}
                {filteredPurchases.map(purchase => (
                  <tr key={purchase.id}>
                    <td>{dateTime(purchase.createdAt)}</td><td><strong>{purchase.supplierName || 'Sem fornecedor'}</strong></td>
                    <td>{purchase.invoiceNumber || '-'}</td><td>{purchase.itemCount || 0}</td><td><strong>{money(purchase.totalAmount)}</strong></td>
                    <td><span className={`purchase-status ${purchase.status}`}>{statusLabels[purchase.status]}</span></td>
                    <td><button className="purchase-icon-button" onClick={() => openPurchase(purchase)} title="Ver compra"><Eye size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === 'suppliers' && (
        <section>
          <div className="purchase-toolbar align-end"><span className="toolbar-caption">Fornecedores inativos permanecem no historico das compras.</span><button className="btn btn-primary" onClick={() => openSupplier()}><Plus size={17} /> Novo fornecedor</button></div>
          <div className="supplier-list">
            {suppliers.length === 0 && <div className="purchase-empty">Nenhum fornecedor cadastrado.</div>}
            {suppliers.map(supplier => (
              <div className={`supplier-row ${supplier.active ? '' : 'inactive'}`} key={supplier.id}>
                <div className="supplier-icon"><Building2 size={19} /></div>
                <div><strong>{supplier.name}</strong><span>{supplier.document || 'Documento nao informado'}</span></div>
                <div><span>Contato</span><strong>{supplier.contactName || supplier.email || supplier.phone || '-'}</strong></div>
                <div><span>Compras</span><strong>{supplier.purchaseCount || 0}</strong></div>
                <div className="supplier-state">{supplier.active ? 'Ativo' : 'Inativo'}</div>
                <div className="supplier-actions">
                  <button className="purchase-icon-button" onClick={() => openSupplier(supplier)} title="Editar fornecedor"><FilePenLine size={17} /></button>
                  {supplier.active === 1 && <button className="purchase-icon-button danger" onClick={() => removeSupplier(supplier)} title="Remover fornecedor"><Trash2 size={17} /></button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {view === 'movements' && (
        <section>
          <div className="movement-filters">
            <select value={movementProduct} onChange={event => setMovementProduct(event.target.value)}><option value="">Todos os produtos</option>{products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</select>
            <select value={movementType} onChange={event => setMovementType(event.target.value)}><option value="">Todos os movimentos</option>{Object.entries(movementLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          </div>
          <div className="purchase-table-wrap">
            <table className="purchase-table movement-table">
              <thead><tr><th>Data</th><th>Produto</th><th>Movimento</th><th>Quantidade</th><th>Saldo anterior</th><th>Saldo final</th><th>Referencia</th></tr></thead>
              <tbody>
                {filteredMovements.length === 0 && <tr><td colSpan={7} className="purchase-empty">Nenhuma movimentacao encontrada.</td></tr>}
                {filteredMovements.map(movement => (
                  <tr key={movement.id}>
                    <td>{dateTime(movement.createdAt)}</td><td><strong>{movement.productName}</strong></td><td>{movementLabels[movement.type] || movement.type}</td>
                    <td><span className={`movement-quantity ${movement.quantity >= 0 ? 'in' : 'out'}`}>{movement.quantity >= 0 ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}{movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}</span></td>
                    <td>{movement.stockBefore}</td><td><strong>{movement.stockAfter}</strong></td><td>{movement.notes || movement.referenceId || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal isOpen={purchaseModalOpen} onClose={() => !saving && setPurchaseModalOpen(false)} title={editingPurchaseId ? 'Editar compra' : 'Nova compra'} size="wide">
        <form onSubmit={savePurchase} className="purchase-form">
          <div className="purchase-form-grid">
            <label>Fornecedor<select value={purchaseForm.supplierId} onChange={event => setPurchaseForm(current => ({ ...current, supplierId: event.target.value }))}><option value="">Sem fornecedor</option>{activeSuppliers.map(supplier => <option value={supplier.id} key={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>Numero da nota ou documento<input value={purchaseForm.invoiceNumber} onChange={event => setPurchaseForm(current => ({ ...current, invoiceNumber: event.target.value }))} /></label>
          </div>
          <div className="purchase-items-header"><strong>Produtos da compra</strong><button type="button" className="btn btn-secondary" onClick={() => setPurchaseItems(current => [...current, newDraftItem()])}><Plus size={15} /> Adicionar item</button></div>
          <div className="purchase-items">
            {purchaseItems.map((item, index) => (
              <div className="purchase-item-row" key={item.key}>
                <span>{index + 1}</span>
                <select required value={item.productId} onChange={event => updatePurchaseItem(item.key, 'productId', event.target.value)}><option value="">Selecione o produto</option>{products.map(product => <option value={product.id} key={product.id}>{product.name}</option>)}</select>
                <input required type="number" min="1" step="1" value={item.quantity} onChange={event => updatePurchaseItem(item.key, 'quantity', Number(event.target.value))} aria-label="Quantidade" />
                <input required type="number" min="0" step="0.01" value={item.unitCost} onChange={event => updatePurchaseItem(item.key, 'unitCost', Number(event.target.value))} aria-label="Custo unitario" />
                <strong>{money(item.quantity * item.unitCost)}</strong>
                <button type="button" className="purchase-icon-button danger" onClick={() => setPurchaseItems(current => current.filter(candidate => candidate.key !== item.key))} disabled={purchaseItems.length === 1} title="Remover item"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
          <label>Observacoes<textarea rows={2} value={purchaseForm.notes} onChange={event => setPurchaseForm(current => ({ ...current, notes: event.target.value }))} /></label>
          <div className="purchase-form-footer"><div><span>Total da compra</span><strong>{money(purchaseTotal)}</strong></div><div><button type="button" className="btn btn-secondary" onClick={() => setPurchaseModalOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar rascunho'}</button></div></div>
        </form>
      </Modal>

      <Modal isOpen={supplierModalOpen} onClose={() => !saving && setSupplierModalOpen(false)} title={editingSupplierId ? 'Editar fornecedor' : 'Novo fornecedor'}>
        <form onSubmit={saveSupplier} className="supplier-form">
          <label>Nome de identificacao *<input required value={supplierForm.name} onChange={event => setSupplierForm(current => ({ ...current, name: event.target.value }))} /></label>
          <label>Razao social<input value={supplierForm.legalName} onChange={event => setSupplierForm(current => ({ ...current, legalName: event.target.value }))} /></label>
          <div className="purchase-form-grid"><label>CPF ou CNPJ<input value={supplierForm.document} onChange={event => setSupplierForm(current => ({ ...current, document: event.target.value }))} /></label><label>Contato<input value={supplierForm.contactName} onChange={event => setSupplierForm(current => ({ ...current, contactName: event.target.value }))} /></label></div>
          <div className="purchase-form-grid"><label>E-mail<input type="email" value={supplierForm.email} onChange={event => setSupplierForm(current => ({ ...current, email: event.target.value }))} /></label><label>Telefone<input value={supplierForm.phone} onChange={event => setSupplierForm(current => ({ ...current, phone: event.target.value }))} /></label></div>
          <label>Observacoes<textarea rows={3} value={supplierForm.notes} onChange={event => setSupplierForm(current => ({ ...current, notes: event.target.value }))} /></label>
          {editingSupplierId && <label className="supplier-active"><input type="checkbox" checked={supplierForm.active === 1} onChange={event => setSupplierForm(current => ({ ...current, active: event.target.checked ? 1 : 0 }))} /> Fornecedor ativo</label>}
          <div className="form-actions"><button type="button" className="btn btn-secondary" onClick={() => setSupplierModalOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button></div>
        </form>
      </Modal>

      <Modal isOpen={Boolean(selectedPurchase)} onClose={() => !saving && setSelectedPurchase(null)} title="Detalhes da compra" size="wide">
        {selectedPurchase && <div className="purchase-detail">
          <div className="purchase-detail-summary"><div><span>Fornecedor</span><strong>{selectedPurchase.supplierName || 'Nao informado'}</strong></div><div><span>Documento</span><strong>{selectedPurchase.invoiceNumber || '-'}</strong></div><div><span>Criada em</span><strong>{dateTime(selectedPurchase.createdAt)}</strong></div><div><span>Status</span><strong>{statusLabels[selectedPurchase.status]}</strong></div></div>
          <table className="purchase-table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Custo unitario</th><th>Total</th></tr></thead><tbody>{(selectedPurchase.items || []).map((item: PurchaseItem) => <tr key={item.id}><td>{item.productName}</td><td>{item.quantity}</td><td>{money(item.unitCost)}</td><td><strong>{money(item.totalCost)}</strong></td></tr>)}</tbody></table>
          {selectedPurchase.notes && <p className="purchase-notes"><strong>Observacoes:</strong> {selectedPurchase.notes}</p>}
          <div className="purchase-detail-footer"><strong>Total: {money(selectedPurchase.totalAmount)}</strong><div>
            {selectedPurchase.status === 'draft' && <><button className="btn btn-danger" onClick={() => runPurchaseAction(selectedPurchase, 'delete')} disabled={saving}><Trash2 size={16} /> Excluir</button><button className="btn btn-secondary" onClick={() => openEditPurchase(selectedPurchase)} disabled={saving}><FilePenLine size={16} /> Editar</button><button className="btn btn-primary" onClick={() => runPurchaseAction(selectedPurchase, 'receive')} disabled={saving}><ArrowDownToLine size={16} /> Receber compra</button></>}
            {selectedPurchase.status === 'received' && <button className="btn btn-danger" onClick={() => runPurchaseAction(selectedPurchase, 'cancel')} disabled={saving}><RotateCcw size={16} /> Cancelar e reverter</button>}
          </div></div>
        </div>}
      </Modal>
    </div>
  );
}
