import { useState, useMemo, useEffect, useRef, type FormEvent } from 'react';
import { Search, ShoppingCart, Plus, Minus, Trash2, CheckCircle, CreditCard, Banknote, QrCode, Scan, Tag, X } from 'lucide-react';
import { useInventoryStore } from '../store/useInventoryStore';
import { useSalesStore } from '../store/useSalesStore';
import { DEFAULT_UI_SETTINGS, useSettingsStore } from '../store/useSettingsStore';
import { apiRequest } from '../lib/api';
import Modal from '../components/Modal';
import type { CardTransaction, PixAccount, PixTransaction, Product, SaleItem } from '../types';
import './Sales.css';

interface PaymentRuntimeConfig {
  strategy: 'polling';
  pollingIntervalMs: number;
}

export default function Sales() {
  const [searchTerm, setSearchTerm] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState('');
  const [quickProductOpen, setQuickProductOpen] = useState(false);
  const [quickProduct, setQuickProduct] = useState({
    barcode: '',
    name: '',
    costPrice: '',
    sellPrice: '',
    stock: '1',
    category: 'Geral',
  });
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'money' | 'card' | 'pix'>('money');
  const [pixAccounts, setPixAccounts] = useState<PixAccount[]>([]);
  const [selectedPixAccountId, setSelectedPixAccountId] = useState('');
  const [selectedCardAccountId, setSelectedCardAccountId] = useState('');
  const [pixTransaction, setPixTransaction] = useState<PixTransaction | null>(null);
  const [pixWaiting, setPixWaiting] = useState(false);
  const [pixCancelling, setPixCancelling] = useState(false);
  const [cardTransaction, setCardTransaction] = useState<CardTransaction | null>(null);
  const [cardWaiting, setCardWaiting] = useState(false);
  const [cardCancelling, setCardCancelling] = useState(false);
  const [cardSimulating, setCardSimulating] = useState(false);
  const [cardPaymentType, setCardPaymentType] = useState<'credit_card' | 'debit_card'>('credit_card');
  const [cardInstallments, setCardInstallments] = useState(1);
  const [checkoutProcessing, setCheckoutProcessing] = useState(false);
  const [paymentConfig, setPaymentConfig] = useState<PaymentRuntimeConfig>({
    strategy: 'polling',
    pollingIntervalMs: 10000,
  });
  const [selectedCategory, setSelectedCategory] = useState<string>('Todos');
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { products, addProduct } = useInventoryStore();
  const lowStockThreshold = useSettingsStore(state => state.settings?.lowStockThreshold ?? DEFAULT_UI_SETTINGS.lowStockThreshold);
  const {
    addSale,
    createPixPayment,
    checkPixPayment,
    cancelPixPayment,
    createCardPayment,
    checkCardPayment,
    cancelCardPayment,
    simulateCardPayment,
  } = useSalesStore();

  useEffect(() => {
    const mpWindow = window as unknown as {
      MercadoPago?: new (publicKey: string, options?: { locale?: string }) => unknown;
      mercadoPagoSdk?: unknown;
    };
    const publicKey = import.meta.env.VITE_MERCADO_PAGO_PUBLIC_KEY || '';
    if (publicKey && mpWindow.MercadoPago && !mpWindow.mercadoPagoSdk) {
      mpWindow.mercadoPagoSdk = new mpWindow.MercadoPago(publicKey, { locale: 'pt-BR' });
    }
  }, []);

  useEffect(() => {
    apiRequest<PixAccount[]>('/pix/accounts')
      .then(accounts => {
        const active = accounts.filter(a => a.active);
        setPixAccounts(active);
        const pixReady = active.filter(a => a.supportsPix !== false);
        const cardReady = active.filter(a => a.supportsPoint);
        setSelectedPixAccountId(pixReady.find(a => a.isDefault)?.id || pixReady[0]?.id || '');
        setSelectedCardAccountId(cardReady.find(a => a.isDefault)?.id || cardReady[0]?.id || '');
      })
      .catch(() => setPixAccounts([]));
  }, []);

  useEffect(() => {
    apiRequest<PaymentRuntimeConfig>('/payments/config')
      .then(config => setPaymentConfig({
        strategy: 'polling',
        pollingIntervalMs: Math.max(3000, Number(config.pollingIntervalMs || 10000)),
      }))
      .catch(() => setPaymentConfig({
        strategy: 'polling',
        pollingIntervalMs: 10000,
      }));
  }, []);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(products.map(p => p.category))).filter(Boolean).sort();
    return ['Todos', ...cats];
  }, [products]);

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
  const availablePixAccounts = useMemo(() => pixAccounts.filter(a => a.supportsPix !== false), [pixAccounts]);
  const availableCardAccounts = useMemo(() => pixAccounts.filter(a => a.supportsPoint), [pixAccounts]);

  useEffect(() => {
    const account = availableCardAccounts.find(item => item.id === selectedCardAccountId);
    if (!account) return;
    const type = account.defaultType === 'debit_card' ? 'debit_card' : 'credit_card';
    setCardPaymentType(type);
    setCardInstallments(type === 'debit_card' ? 1 : Math.max(1, Math.min(12, Number(account.defaultInstallments || 1))));
  }, [availableCardAccounts, selectedCardAccountId]);

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
      setQuickProduct({
        barcode: code,
        name: '',
        costPrice: '',
        sellPrice: '',
        stock: '1',
        category: 'Geral',
      });
      setQuickProductOpen(true);
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

  const getMercadoPagoDeviceId = () => {
    const mpWindow = window as unknown as { MP_DEVICE_SESSION_ID?: string; mpDeviceSessionId?: string };
    return mpWindow.mpDeviceSessionId || mpWindow.MP_DEVICE_SESSION_ID || '';
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || checkoutProcessing || pixWaiting || cardWaiting) return;
    setCheckoutProcessing(true);
    try {
      if (paymentMethod === 'pix') {
        const transaction = await createPixPayment(cart, cartTotal, selectedPixAccountId || undefined, getMercadoPagoDeviceId());
        if (transaction) {
          setPixTransaction(transaction);
          setPixWaiting(true);
        }
        return;
      }
      if (paymentMethod === 'card' && selectedCardAccountId) {
        const transaction = await createCardPayment(
          cart,
          cartTotal,
          selectedCardAccountId,
          cardPaymentType,
          cardPaymentType === 'debit_card' ? 1 : cardInstallments
        );
        if (transaction) {
          setCardTransaction(transaction);
          setCardWaiting(true);
        }
        return;
      }
      if (paymentMethod === 'card') {
        window.alert('Selecione uma conta com terminal configurado para confirmar o pagamento em cartao.');
        return;
      }
      const saleId = await addSale(cart, cartTotal, paymentMethod);
      if (saleId) {
        setCart([]);
        setSearchTerm('');
        setPaymentMethod('money');
        barcodeRef.current?.focus();
      }
    } finally {
      setCheckoutProcessing(false);
    }
  };

  const handleCloseCardModal = async () => {
    if (!cardTransaction) return;
    if (cardTransaction.status === 'paid') {
      setCardTransaction(null);
      return;
    }
    if (!cardWaiting || cardTransaction.status !== 'pending') {
      setCardWaiting(false);
      setCardTransaction(null);
      setCheckoutProcessing(false);
      return;
    }

    const shouldCancel = window.confirm('Cancelar o pagamento enviado ao terminal? A venda nao sera registrada.');
    if (!shouldCancel) return;
    setCardCancelling(true);
    const cancelled = await cancelCardPayment(cardTransaction.id);
    setCardCancelling(false);
    if (!cancelled) return;
    setCardTransaction(cancelled);
    if (cancelled.status === 'pending') return;
    setCardWaiting(false);
    setCheckoutProcessing(false);
    setCardTransaction(null);
    barcodeRef.current?.focus();
  };

  const handleCardSimulation = async (scenario: 'approved' | 'failed' | 'expired' | 'action_required') => {
    if (!cardTransaction || cardSimulating) return;
    setCardSimulating(true);
    const updated = await simulateCardPayment(cardTransaction.id, scenario);
    setCardSimulating(false);
    if (updated) setCardTransaction(updated);
  };

  const handleClosePixModal = async () => {
    if (!pixTransaction) return;
    if (pixTransaction.status === 'paid') {
      setPixTransaction(null);
      return;
    }
    if (!pixWaiting || pixTransaction.status !== 'pending') {
      setPixWaiting(false);
      setPixTransaction(null);
      setCheckoutProcessing(false);
      return;
    }

    const shouldCancel = window.confirm('Cancelar esta cobranca Pix? A venda nao sera registrada.');
    if (!shouldCancel) return;

    setPixCancelling(true);
    const cancelled = await cancelPixPayment(pixTransaction.id);
    setPixCancelling(false);
    if (!cancelled) return;
    if (cancelled.status === 'pending') {
      setPixTransaction(cancelled);
      setPixWaiting(true);
      return;
    }
    if (cancelled.status === 'paid') {
      setCart([]);
      setSearchTerm('');
      setPaymentMethod('money');
    }
    setPixWaiting(false);
    setCheckoutProcessing(false);
    setPixTransaction(null);
    barcodeRef.current?.focus();
  };

  useEffect(() => {
    if (!pixWaiting || !pixTransaction?.id) return;
    const timer = window.setInterval(async () => {
      const updated = await checkPixPayment(pixTransaction.id);
      if (!updated) return;
      setPixTransaction(updated);
      if (updated.status === 'paid') {
        window.clearInterval(timer);
        setPixWaiting(false);
        setCart([]);
        setSearchTerm('');
        setPaymentMethod('money');
        setPixTransaction(null);
        setCheckoutProcessing(false);
        barcodeRef.current?.focus();
      }
      if (updated.status === 'cancelled' || updated.status === 'expired') {
        window.clearInterval(timer);
        setPixWaiting(false);
        setCheckoutProcessing(false);
      }
    }, paymentConfig.pollingIntervalMs);
    return () => window.clearInterval(timer);
  }, [pixWaiting, pixTransaction?.id, checkPixPayment, paymentConfig.pollingIntervalMs]);

  useEffect(() => {
    if (!cardWaiting || !cardTransaction?.id) return;
    const timer = window.setInterval(async () => {
      const updated = await checkCardPayment(cardTransaction.id);
      if (!updated) return;
      setCardTransaction(updated);
      if (updated.status === 'paid') {
        window.clearInterval(timer);
        setCardWaiting(false);
        setCart([]);
        setSearchTerm('');
        setPaymentMethod('money');
        setCardTransaction(null);
        setCheckoutProcessing(false);
        barcodeRef.current?.focus();
      }
      if (updated.status === 'cancelled' || updated.status === 'expired') {
        window.clearInterval(timer);
        setCardWaiting(false);
        setCheckoutProcessing(false);
      }
    }, paymentConfig.pollingIntervalMs);
    return () => window.clearInterval(timer);
  }, [cardWaiting, cardTransaction?.id, checkCardPayment, paymentConfig.pollingIntervalMs]);

  const handleQuickProductSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await addProduct({
      barcode: quickProduct.barcode,
      name: quickProduct.name,
      costPrice: Number(quickProduct.costPrice) || 0,
      sellPrice: Number(quickProduct.sellPrice) || 0,
      stock: Number(quickProduct.stock) || 0,
      category: quickProduct.category || 'Geral',
    });
    setQuickProductOpen(false);
    setBarcodeError('Produto cadastrado. Escaneie novamente para adicionar ao carrinho.');
    setTimeout(() => setBarcodeError(''), 3500);
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
                    <div className={`stock ${product.stock <= lowStockThreshold ? 'low' : ''}`}>
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
                {paymentMethod === 'pix' && (
                  <div className="pix-account-select">
                    <label>Conta recebedora</label>
                    <select value={selectedPixAccountId} onChange={e => setSelectedPixAccountId(e.target.value)}>
                      {availablePixAccounts.length === 0 ? (
                        <option value="">Nenhuma conta recebedora ativa</option>
                      ) : availablePixAccounts.map(account => (
                        <option key={account.id} value={account.id}>{account.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {paymentMethod === 'card' && availableCardAccounts.length > 0 && (
                  <div className="card-payment-config">
                    <div className="pix-account-select">
                      <label>Terminal de cartão</label>
                      <select value={selectedCardAccountId} onChange={e => setSelectedCardAccountId(e.target.value)}>
                        {availableCardAccounts.map(account => (
                          <option key={account.id} value={account.id}>
                            {account.name}{account.terminalId ? ` - ${account.terminalId}` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="card-payment-options">
                      <label>
                        Modalidade
                        <select
                          value={cardPaymentType}
                          onChange={e => {
                            const type = e.target.value as 'credit_card' | 'debit_card';
                            setCardPaymentType(type);
                            if (type === 'debit_card') setCardInstallments(1);
                          }}
                        >
                          <option value="credit_card">Crédito</option>
                          <option value="debit_card">Débito</option>
                        </select>
                      </label>
                      <label>
                        Parcelas
                        <select
                          value={cardInstallments}
                          disabled={cardPaymentType === 'debit_card'}
                          onChange={e => setCardInstallments(Number(e.target.value))}
                        >
                          {Array.from({ length: 12 }, (_, index) => index + 1).map(value => (
                            <option key={value} value={value}>{value}x</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                )}
                {paymentMethod === 'card' && availableCardAccounts.length === 0 && (
                  <div className="card-terminal-note">
                    Cadastre uma conta com terminal Mercado Pago Point para receber por cartão.
                  </div>
                )}
              </div>
            )}

            <div className="cart-total">
              <span>Total:</span>
              <span className="cart-total-value">{formatCurrency(cartTotal)}</span>
            </div>

            <button
              className="btn-checkout"
              disabled={cart.length === 0 || checkoutProcessing || pixWaiting || cardWaiting || (paymentMethod === 'pix' && !selectedPixAccountId) || (paymentMethod === 'card' && !selectedCardAccountId)}
              onClick={handleCheckout}
            >
              <CheckCircle size={20} />
              {checkoutProcessing || pixWaiting || cardWaiting ? 'Processando...' : 'Finalizar Venda'}
            </button>
          </div>
        </div>
      </div>

      <Modal isOpen={!!pixTransaction} onClose={handleClosePixModal} title="Pagamento Pix">
        {pixTransaction && (
          <div className="pix-payment-modal">
            <div className="pix-payment-status">
              <QrCode size={22} />
              <div>
                <strong>{pixTransaction.status === 'paid' ? 'Pagamento confirmado' : 'Aguardando pagamento'}</strong>
                <span>{formatCurrency(pixTransaction.amount)}</span>
              </div>
            </div>

            {pixTransaction.provider === 'mercado_pago' && (pixTransaction.providerTransactionId || pixTransaction.providerPaymentId || pixTransaction.externalReference) && (
              <div className="pix-provider-identifiers">
                <label>Identificacao Mercado Pago</label>
                {pixTransaction.providerTransactionId && (
                  <div>
                    <span>Pedido</span>
                    <strong>{pixTransaction.providerTransactionId}</strong>
                  </div>
                )}
                {pixTransaction.providerPaymentId && (
                  <div>
                    <span>Pagamento</span>
                    <strong>{pixTransaction.providerPaymentId}</strong>
                  </div>
                )}
                {pixTransaction.externalReference && (
                  <div>
                    <span>Referencia</span>
                    <strong>{pixTransaction.externalReference}</strong>
                  </div>
                )}
              </div>
            )}

            {pixTransaction.qrCodeBase64 ? (
              <img className="pix-qr-image" src={`data:image/png;base64,${pixTransaction.qrCodeBase64}`} alt="QR Code Pix" />
            ) : (
              <div className="pix-qr-placeholder">
                <QrCode size={56} />
                <span>Use o copia e cola abaixo</span>
              </div>
            )}

            {pixTransaction.qrCode && (
              <div className="pix-copy-code">
                <label>Pix copia e cola</label>
                <textarea readOnly value={pixTransaction.qrCode} />
                <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(pixTransaction.qrCode || '')}>
                  Copiar codigo
                </button>
              </div>
            )}

            {pixTransaction.ticketUrl && (
              <div className="pix-test-payment">
                <strong>Pagamento manual de teste</strong>
                <span>Abra a pagina do Pix para consultar a cobranca de teste. O sistema confirmara o status diretamente no Mercado Pago.</span>
                <a className="pix-ticket-link" href={pixTransaction.ticketUrl} target="_blank" rel="noreferrer">Abrir pagina do Pix</a>
              </div>
            )}

            <div className="pix-waiting-note">
              {pixCancelling
                ? 'Cancelando a cobranca Pix...'
                : pixWaiting
                  ? `Consultando o Mercado Pago a cada ${Math.round(paymentConfig.pollingIntervalMs / 1000)} segundos. Clique no X para cancelar.`
                  : 'A cobranca nao esta mais em consulta automatica.'}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!cardTransaction} onClose={handleCloseCardModal} title="Pagamento no terminal">
        {cardTransaction && (
          <div className="pix-payment-modal">
            <div className="pix-payment-status">
              <CreditCard size={22} />
              <div>
                <strong>
                  {cardTransaction.status === 'paid'
                    ? 'Pagamento confirmado'
                    : cardTransaction.status === 'cancelled'
                      ? 'Pagamento recusado ou cancelado'
                      : cardTransaction.status === 'expired'
                        ? 'Pagamento expirado'
                        : cardTransaction.providerStatus === 'action_required'
                          ? 'Ação necessária no terminal'
                          : 'Aguardando terminal'}
                </strong>
                <span>{formatCurrency(cardTransaction.amount)}</span>
              </div>
            </div>

            <div className="pix-provider-identifiers">
              <label>Transação Point</label>
              <div>
                <span>Modalidade</span>
                <strong>{cardTransaction.paymentType === 'debit_card' ? 'Débito' : `Crédito ${cardTransaction.installments || 1}x`}</strong>
              </div>
              {cardTransaction.providerTransactionId && (
                <div>
                  <span>Pedido</span>
                  <strong>{cardTransaction.providerTransactionId}</strong>
                </div>
              )}
              {cardTransaction.providerPaymentId && (
                <div>
                  <span>Pagamento</span>
                  <strong>{cardTransaction.providerPaymentId}</strong>
                </div>
              )}
              {cardTransaction.providerStatus && (
                <div>
                  <span>Status Point</span>
                  <strong>{cardTransaction.providerStatus}{cardTransaction.providerStatusDetail ? ` / ${cardTransaction.providerStatusDetail}` : ''}</strong>
                </div>
              )}
            </div>

            <div className="pix-qr-placeholder">
              <CreditCard size={56} />
              <span>{cardTransaction.terminalId ? `Venda enviada para ${cardTransaction.terminalId}` : 'Venda enviada para o terminal'}</span>
            </div>

            {cardTransaction.isTest && cardWaiting && (
              <div className="point-test-panel">
                <strong>Simulação oficial Mercado Pago Point</strong>
                <span>Escolha o resultado que o ambiente de teste deve devolver. A atualização pode levar até 10 segundos.</span>
                <div>
                  <button className="btn btn-primary" disabled={cardSimulating} onClick={() => handleCardSimulation('approved')}>Aprovar</button>
                  <button className="btn btn-secondary" disabled={cardSimulating} onClick={() => handleCardSimulation('failed')}>Recusar</button>
                  <button className="btn btn-secondary" disabled={cardSimulating} onClick={() => handleCardSimulation('action_required')}>Exigir ação</button>
                  <button className="btn btn-secondary" disabled={cardSimulating} onClick={() => handleCardSimulation('expired')}>Expirar</button>
                </div>
              </div>
            )}

            <div className="pix-waiting-note">
              {cardCancelling
                ? 'Cancelando a transação no terminal...'
                : cardWaiting
                ? `Consulta automática a cada ${Math.round(paymentConfig.pollingIntervalMs / 1000)} segundos. Clique no X para cancelar.`
                : 'A transacao nao esta mais em consulta automatica.'}
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={quickProductOpen} onClose={() => setQuickProductOpen(false)} title="Cadastro rapido de produto">
        <form onSubmit={handleQuickProductSubmit}>
          <div className="form-group">
            <label>Codigo de barras</label>
            <input className="form-control" value={quickProduct.barcode} onChange={e => setQuickProduct(p => ({ ...p, barcode: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Nome do produto *</label>
            <input className="form-control" value={quickProduct.name} onChange={e => setQuickProduct(p => ({ ...p, name: e.target.value }))} required autoFocus />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Custo</label>
              <input className="form-control" type="number" step="0.01" value={quickProduct.costPrice} onChange={e => setQuickProduct(p => ({ ...p, costPrice: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Preco de venda *</label>
              <input className="form-control" type="number" step="0.01" value={quickProduct.sellPrice} onChange={e => setQuickProduct(p => ({ ...p, sellPrice: e.target.value }))} required />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Estoque inicial</label>
              <input className="form-control" type="number" value={quickProduct.stock} onChange={e => setQuickProduct(p => ({ ...p, stock: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Categoria</label>
              <input className="form-control" value={quickProduct.category} onChange={e => setQuickProduct(p => ({ ...p, category: e.target.value }))} />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setQuickProductOpen(false)}>Cancelar</button>
            <button type="submit" className="btn btn-primary">Cadastrar Produto</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
