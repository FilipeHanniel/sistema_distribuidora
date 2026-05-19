import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Search, ShoppingCart, Plus, Minus, Trash2, CheckCircle, CreditCard, Banknote, QrCode, Scan, Tag, X } from 'lucide-react';
import { useInventoryStore } from '../store/useInventoryStore';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../store/useAuthStore';
import CrossSellPopup from '../components/CrossSellPopup';
import type { Product, SaleItem } from '../types';
import './Sales.css';

export default function Sales() {
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'money' | 'card' | 'pix'>('money');
  const [crossSell, setCrossSell] = useState<{ productName: string; suggestion: string } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const crossSellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { products } = useInventoryStore();
  const { addSale } = useSalesStore();
  const { token } = useAuthStore();

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort();
    return ['Todos', ...cats];
  }, [products]);

  const fetchCrossSell = useCallback(async (cartItems: SaleItem[]) => {
    if (cartItems.length === 0) {
      setCrossSell(null);
      return;
    }
    try {
      const res = await fetch('/api/ai/cross-sell', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ cartItems: cartItems.map(i => i.name) })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestion && data.productName) {
          setCrossSell({ productName: data.productName, suggestion: data.suggestion });
        }
      }
    } catch {
      // Silencioso
    }
  }, [token]);

  useEffect(() => {
    if (crossSellTimer.current) clearTimeout(crossSellTimer.current);
    if (cart.length > 0) {
      crossSellTimer.current = setTimeout(() => fetchCrossSell(cart), 2000);
    } else {
      setCrossSell(null);
    }
    return () => { if (crossSellTimer.current) clearTimeout(crossSellTimer.current); };
  }, [cart, fetchCrossSell]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const search = searchTerm.toLowerCase();
      const matchSearch = !searchTerm || (
        p.name.toLowerCase().includes(search) ||
        p.barcode.includes(search) ||
        p.category.toLowerCase().includes(search)
      );
      const matchCategory = selectedCategory === 'Todos' || p.category === selectedCategory;
      return matchSearch && matchCategory;
    });
  }, [products, searchTerm, selectedCategory]);

  const cartTotal = useMemo(() => cart.reduce((total, item) => total + item.totalPrice, 0), [cart]);
  const cartItemCount = useMemo(() => cart.reduce((total, item) => total + item.quantity, 0), [cart]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) return;
    setCart((currentCart) => {
      const existingItem = currentCart.find(item => item.productId === product.id);
      if (existingItem) {
        if (existingItem.quantity >= product.stock) return currentCart;
        return currentCart.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice }
            : item
        );
      }
      return [...currentCart, {
        productId: product.id,
        name: product.name,
        quantity: 1,
        unitPrice: product.sellPrice,
        totalPrice: product.sellPrice
      }];
    });
  };

  const handleBarcodeScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const code = barcodeInput.trim();
    if (!code) return;

    const product = products.find(p => p.barcode === code);
    if (product) {
      if (product.stock <= 0) {
        setBarcodeError(`"${product.name}" sem estoque!`);
      } else {
        addToCart(product);
        setBarcodeError('');
      }
    } else {
      setBarcodeError(`Código "${code}" não encontrado.`);
    }
    setBarcodeInput('');
    setTimeout(() => setBarcodeError(''), 3000);
  };

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    setCart(currentCart =>
      currentCart.map(item => {
        if (item.productId === productId) {
          const newQuantity = item.quantity + delta;
          if (newQuantity <= 0) return item;
          if (newQuantity > product.stock) return item;
          return { ...item, quantity: newQuantity, totalPrice: newQuantity * item.unitPrice };
        }
        return item;
      })
    );
  };

  const removeFromCart = (productId: string) => {
    setCart(current => current.filter(item => item.productId !== productId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    await addSale(cart, cartTotal, paymentMethod);
    setCart([]);
    setSearchTerm('');
    setPaymentMethod('money');
    barcodeRef.current?.focus();
  };

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <div className="page-container sales-page">
      <div className="sales-container">

        {/* Lado Esquerdo */}
        <div className="search-section card">

          {/* Scanner de Código de Barras */}
          <div className="barcode-scanner-area">
            <div className="barcode-input-wrapper">
              <Scan size={18} className="barcode-icon" />
              <input
                ref={barcodeRef}
                type="text"
                className="barcode-input"
                placeholder="Escaneie ou digite o código de barras e pressione Enter..."
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={handleBarcodeScan}
                autoFocus
              />
            </div>
            {barcodeError && (
              <div className="barcode-error">
                <X size={14} /> {barcodeError}
              </div>
            )}
          </div>

          {/* Busca por Nome */}
          <div className="search-input-wrapper">
            <Search className="search-icon" size={18} />
            <input
              ref={searchRef}
              type="text"
              className="search-input"
              placeholder="Buscar produto por nome ou categoria..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="search-clear" onClick={() => setSearchTerm('')}>
                <X size={16} />
              </button>
            )}
          </div>

          {/* Filtro de Categorias */}
          <div className="category-filter">
            {categories.map(cat => (
              <button
                key={cat}
                className={`category-chip ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat !== 'Todos' && <Tag size={12} />}
                {cat}
              </button>
            ))}
          </div>

          {/* Grid de Produtos */}
          <div className="products-grid">
            {filteredProducts.length === 0 ? (
              <div className="no-results">
                <Search size={32} opacity={0.3} />
                <p>Nenhum produto encontrado</p>
              </div>
            ) : (
              filteredProducts.map(product => {
                const inCart = cart.find(i => i.productId === product.id);
                return (
                  <div
                    key={product.id}
                    className={`product-card ${product.stock <= 0 ? 'out-of-stock' : ''} ${inCart ? 'in-cart' : ''}`}
                    onClick={() => addToCart(product)}
                  >
                    {inCart && <div className="in-cart-badge">{inCart.quantity}</div>}
                    <div className="product-category-tag">{product.category}</div>
                    <h3>{product.name}</h3>
                    <div className="price">{formatCurrency(product.sellPrice)}</div>
                    <div className={`stock ${product.stock <= 5 ? 'low' : ''}`}>
                      {product.stock <= 0 ? 'Sem estoque' : `${product.stock} em estoque`}
                    </div>
                    {product.stock > 0 && (
                      <div className="product-add-hint">
                        <Plus size={14} /> Adicionar
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Lado Direito: Carrinho */}
        <div className="cart-section card">
          <div className="cart-header">
            <div className="cart-title">
              <ShoppingCart size={22} color="var(--primary)" />
              <h2>Carrinho</h2>
            </div>
            {cart.length > 0 && (
              <div className="cart-badges">
                <span className="cart-count-badge">{cartItemCount} {cartItemCount === 1 ? 'item' : 'itens'}</span>
                <button className="clear-cart-btn" onClick={() => setCart([])}>
                  <Trash2 size={14} /> Limpar
                </button>
              </div>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="empty-cart">
              <ShoppingCart size={48} opacity={0.25} />
              <p>Carrinho vazio</p>
              <span>Escaneie um código ou clique em um produto</span>
            </div>
          ) : (
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.productId} className="cart-item">
                  <div className="cart-item-info">
                    <span className="cart-item-name">{item.name}</span>
                    <span className="cart-item-price">
                      {formatCurrency(item.unitPrice)} / un
                    </span>
                  </div>
                  <div className="cart-item-controls">
                    <button className="qty-btn" onClick={() => updateQuantity(item.productId, -1)} disabled={item.quantity <= 1}>
                      <Minus size={14} />
                    </button>
                    <span className="qty-display">{item.quantity}</span>
                    <button className="qty-btn" onClick={() => updateQuantity(item.productId, 1)}>
                      <Plus size={14} />
                    </button>
                    <span className="cart-item-total">{formatCurrency(item.totalPrice)}</span>
                    <button className="remove-btn" onClick={() => removeFromCart(item.productId)}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="cart-summary">
            {cart.length > 0 && (
              <div className="payment-section">
                <span className="payment-label">Forma de Pagamento</span>
                <div className="payment-methods">
                  {(['money', 'card', 'pix'] as const).map((method) => {
                    const icons = { money: <Banknote size={20} />, card: <CreditCard size={20} />, pix: <QrCode size={20} /> };
                    const labels = { money: 'Dinheiro', card: 'Cartão', pix: 'PIX' };
                    return (
                      <button
                        key={method}
                        className={`payment-btn ${paymentMethod === method ? 'active' : ''}`}
                        onClick={() => setPaymentMethod(method)}
                      >
                        {icons[method]}
                        {labels[method]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="cart-total">
              <span>Total:</span>
              <span className="cart-total-value">{formatCurrency(cartTotal)}</span>
            </div>

            <button
              className="btn-checkout"
              disabled={cart.length === 0}
              onClick={handleCheckout}
            >
              <CheckCircle size={20} />
              Finalizar Venda
            </button>
          </div>
        </div>
      </div>

      {crossSell && (
        <CrossSellPopup
          productName={crossSell.productName}
          suggestion={crossSell.suggestion}
          onClose={() => setCrossSell(null)}
        />
      )}
    </div>
  );
}
