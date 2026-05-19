import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Search, ShoppingCart, Plus, Minus, Trash2, CheckCircle, CreditCard, Banknote, QrCode } from 'lucide-react';
import { useInventoryStore } from '../store/useInventoryStore';
import { useSalesStore } from '../store/useSalesStore';
import { useAuthStore } from '../store/useAuthStore';
import CrossSellPopup from '../components/CrossSellPopup';
import type { Product, SaleItem } from '../types';
import './Sales.css';

export default function Sales() {
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'money' | 'card' | 'pix'>('money');
  const [crossSell, setCrossSell] = useState<{ productName: string; suggestion: string } | null>(null);
  const crossSellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const { products } = useInventoryStore();
  const { addSale } = useSalesStore();
  const { token } = useAuthStore();

  // Cross-Sell: buscar sugestão de IA quando o carrinho muda (com debounce de 2s)
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
    } catch (err) {
      // Silencioso — não impacta o fluxo de venda
    }
  }, [token]);

  useEffect(() => {
    if (crossSellTimer.current) clearTimeout(crossSellTimer.current);
    if (cart.length > 0) {
      crossSellTimer.current = setTimeout(() => {
        fetchCrossSell(cart);
      }, 2000);
    } else {
      setCrossSell(null);
    }
    return () => { if (crossSellTimer.current) clearTimeout(crossSellTimer.current); };
  }, [cart, fetchCrossSell]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const search = searchTerm.toLowerCase();
      return (
        p.name.toLowerCase().includes(search) || 
        p.barcode.includes(search) ||
        p.category.toLowerCase().includes(search)
      );
    });
  }, [products, searchTerm]);

  const cartTotal = useMemo(() => {
    return cart.reduce((total, item) => total + item.totalPrice, 0);
  }, [cart]);

  const addToCart = (product: Product) => {
    setCart((currentCart) => {
      const existingItem = currentCart.find(item => item.productId === product.id);
      
      if (existingItem) {
        if (existingItem.quantity >= product.stock) {
          alert('Estoque insuficiente!');
          return currentCart;
        }
        
        return currentCart.map(item => 
          item.productId === product.id 
            ? { 
                ...item, 
                quantity: item.quantity + 1,
                totalPrice: (item.quantity + 1) * item.unitPrice
              }
            : item
        );
      }

      if (product.stock <= 0) {
        alert('Produto sem estoque!');
        return currentCart;
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

  const updateQuantity = (productId: string, delta: number) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    setCart(currentCart => {
      return currentCart.map(item => {
        if (item.productId === productId) {
          const newQuantity = item.quantity + delta;
          
          if (newQuantity <= 0) return item;
          if (newQuantity > product.stock) {
            alert('Estoque insuficiente!');
            return item;
          }

          return {
            ...item,
            quantity: newQuantity,
            totalPrice: newQuantity * item.unitPrice
          };
        }
        return item;
      });
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(current => current.filter(item => item.productId !== productId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;

    await addSale(cart, cartTotal, paymentMethod);

    // Clear the cart — popup is triggered by the store
    setCart([]);
    setSearchTerm('');
    setPaymentMethod('money');
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  return (
    <div className="page-container">
      <div className="sales-container">
        
        {/* Lado Esquerdo: Busca e Catálogo */}
        <div className="search-section card">
          <div className="search-input-wrapper">
            <Search className="search-icon" size={20} />
            <input
              type="text"
              className="search-input"
              placeholder="Buscar produto por nome, código de barras..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>

          <div className="products-grid">
            {filteredProducts.map(product => (
              <div 
                key={product.id} 
                className={`product-card ${product.stock <= 0 ? 'out-of-stock' : ''}`}
                onClick={() => addToCart(product)}
              >
                <h3>{product.name}</h3>
                <div className="price">{formatCurrency(product.sellPrice)}</div>
                <div className="stock">Estoque: {product.stock}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Lado Direito: Carrinho de Compras */}
        <div className="cart-section card">
          <div className="cart-header">
            <h2>Carrinho</h2>
            <ShoppingCart size={24} color="var(--primary)" />
          </div>

          {cart.length === 0 ? (
            <div className="empty-cart">
              <ShoppingCart size={48} opacity={0.5} />
              <p>Carrinho vazio</p>
            </div>
          ) : (
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.productId} className="cart-item">
                  <div className="cart-item-info">
                    <span className="cart-item-name">{item.name}</span>
                    <span className="cart-item-price">
                      {item.quantity}x {formatCurrency(item.unitPrice)}
                    </span>
                  </div>
                  
                  <div className="cart-item-controls">
                    <button className="qty-btn" onClick={() => updateQuantity(item.productId, -1)}>-</button>
                    <span className="qty-display">{item.quantity}</span>
                    <button className="qty-btn" onClick={() => updateQuantity(item.productId, 1)}>+</button>
                    
                    <button className="remove-btn" onClick={() => removeFromCart(item.productId)}>
                      <Trash2 size={18} />
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
                  <button 
                    className={`payment-btn ${paymentMethod === 'money' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('money')}
                  >
                    <Banknote size={20} />
                    Dinheiro
                  </button>
                  <button 
                    className={`payment-btn ${paymentMethod === 'card' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('card')}
                  >
                    <CreditCard size={20} />
                    Cartão
                  </button>
                  <button 
                    className={`payment-btn ${paymentMethod === 'pix' ? 'active' : ''}`}
                    onClick={() => setPaymentMethod('pix')}
                  >
                    <QrCode size={20} />
                    PIX
                  </button>
                </div>
              </div>
            )}

            <div className="cart-total">
              <span>Total:</span>
              <span>{formatCurrency(cartTotal)}</span>
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

      {/* Cross-Sell AI Suggestion Popup */}
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
