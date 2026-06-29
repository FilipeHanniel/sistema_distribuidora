const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

class InventoryError extends Error {
  constructor(message, status = 400, code = 'inventory_error') {
    super(message);
    this.name = 'InventoryError';
    this.status = status;
    this.code = code;
  }
}

const normalizeSupplierPayload = payload => {
  const name = String(payload?.name || '').trim();
  if (!name) throw new InventoryError('Informe o nome do fornecedor.');

  const document = String(payload?.document || '').replace(/\D/g, '');
  if (document && ![11, 14].includes(document.length)) {
    throw new InventoryError('O CPF ou CNPJ do fornecedor deve possuir 11 ou 14 digitos.');
  }

  return {
    name,
    legalName: String(payload?.legalName || '').trim() || null,
    document: document || null,
    email: String(payload?.email || '').trim() || null,
    phone: String(payload?.phone || '').trim() || null,
    contactName: String(payload?.contactName || '').trim() || null,
    notes: String(payload?.notes || '').trim() || null,
    active: payload?.active === false || Number(payload?.active) === 0 ? 0 : 1,
  };
};

const normalizePurchaseItems = (db, establishmentId, rawItems) => {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new InventoryError('Adicione ao menos um produto a compra.');
  }

  const grouped = new Map();
  for (const rawItem of rawItems) {
    const productId = String(rawItem?.productId || '').trim();
    const quantity = Number(rawItem?.quantity);
    const unitCost = Number(rawItem?.unitCost);
    if (!productId) throw new InventoryError('Selecione o produto de todos os itens.');
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InventoryError('A quantidade de cada item deve ser um numero inteiro positivo.');
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new InventoryError('O custo unitario de cada item deve ser valido.');
    }

    const product = db.prepare(`
      SELECT id, name, stock, costPrice
      FROM products
      WHERE id = ? AND establishmentId = ?
    `).get(productId, establishmentId);
    if (!product) throw new InventoryError('Um dos produtos nao pertence a este estabelecimento.', 404);

    const current = grouped.get(productId) || {
      productId,
      productName: product.name,
      quantity: 0,
      totalCost: 0,
    };
    current.quantity += quantity;
    current.totalCost = roundMoney(current.totalCost + quantity * unitCost);
    grouped.set(productId, current);
  }

  return [...grouped.values()].map(item => ({
    ...item,
    unitCost: roundMoney(item.totalCost / item.quantity),
  }));
};

const getPurchaseWithItems = (db, purchaseId, establishmentId) => {
  const purchase = db.prepare(`
    SELECT p.*, s.name AS supplierName
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplierId
    WHERE p.id = ? AND p.establishmentId = ?
  `).get(purchaseId, establishmentId);
  if (!purchase) return null;
  return {
    ...purchase,
    items: db.prepare('SELECT * FROM purchase_items WHERE purchaseId = ? ORDER BY productName').all(purchaseId),
  };
};

const receivePurchase = ({ db, purchaseId, establishmentId, userId, uuid, now = new Date().toISOString() }) => {
  const transaction = db.transaction(() => {
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ? AND establishmentId = ?')
      .get(purchaseId, establishmentId);
    if (!purchase) throw new InventoryError('Compra nao encontrada.', 404);
    if (purchase.status !== 'draft') {
      throw new InventoryError('Somente compras em rascunho podem ser recebidas.', 409, 'purchase_already_processed');
    }

    const items = db.prepare('SELECT * FROM purchase_items WHERE purchaseId = ?').all(purchaseId);
    if (items.length === 0) throw new InventoryError('A compra nao possui itens.');

    const updateProduct = db.prepare(`
      UPDATE products SET stock = ?, costPrice = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ?
    `);
    const updateItem = db.prepare(`
      UPDATE purchase_items SET previousCostPrice = ?, appliedCostPrice = ? WHERE id = ?
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, establishmentId, productId, productName, type, quantity,
        stockBefore, stockAfter, unitCost, referenceType, referenceId,
        notes, userId, createdAt
      ) VALUES (?, ?, ?, ?, 'purchase_receipt', ?, ?, ?, ?, 'purchase', ?, ?, ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare(`
        SELECT * FROM products WHERE id = ? AND establishmentId = ?
      `).get(item.productId, establishmentId);
      if (!product) {
        throw new InventoryError(`O produto "${item.productName}" nao esta mais disponivel.`, 409);
      }

      const stockBefore = Number(product.stock || 0);
      const previousCost = Number(product.costPrice || 0);
      const stockAfter = stockBefore + Number(item.quantity);
      const appliedCost = stockAfter > 0
        ? roundMoney(((stockBefore * previousCost) + (Number(item.quantity) * Number(item.unitCost))) / stockAfter)
        : roundMoney(item.unitCost);

      updateProduct.run(stockAfter, appliedCost, now, product.id, establishmentId);
      updateItem.run(previousCost, appliedCost, item.id);
      insertMovement.run(
        uuid(), establishmentId, product.id, product.name, Number(item.quantity),
        stockBefore, stockAfter, Number(item.unitCost), purchaseId,
        purchase.invoiceNumber ? `Nota ${purchase.invoiceNumber}` : 'Recebimento de compra',
        userId, now
      );
    }

    const result = db.prepare(`
      UPDATE purchases
      SET status = 'received', receivedAt = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ? AND status = 'draft'
    `).run(now, now, purchaseId, establishmentId);
    if (result.changes !== 1) throw new InventoryError('A compra ja foi processada.', 409);
  });

  transaction();
  return getPurchaseWithItems(db, purchaseId, establishmentId);
};

const cancelPurchase = ({ db, purchaseId, establishmentId, userId, uuid, now = new Date().toISOString() }) => {
  const transaction = db.transaction(() => {
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ? AND establishmentId = ?')
      .get(purchaseId, establishmentId);
    if (!purchase) throw new InventoryError('Compra nao encontrada.', 404);
    if (purchase.status !== 'received') {
      throw new InventoryError('Somente compras recebidas podem ser canceladas.', 409);
    }

    const items = db.prepare('SELECT * FROM purchase_items WHERE purchaseId = ?').all(purchaseId);
    const updateProduct = db.prepare(`
      UPDATE products SET stock = ?, costPrice = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ?
    `);
    const insertMovement = db.prepare(`
      INSERT INTO stock_movements (
        id, establishmentId, productId, productName, type, quantity,
        stockBefore, stockAfter, unitCost, referenceType, referenceId,
        notes, userId, createdAt
      ) VALUES (?, ?, ?, ?, 'purchase_reversal', ?, ?, ?, ?, 'purchase', ?, ?, ?, ?)
    `);

    for (const item of items) {
      const product = db.prepare(`
        SELECT * FROM products WHERE id = ? AND establishmentId = ?
      `).get(item.productId, establishmentId);
      if (!product) throw new InventoryError(`O produto "${item.productName}" nao esta mais disponivel.`, 409);

      const latest = db.prepare(`
        SELECT * FROM stock_movements
        WHERE establishmentId = ? AND productId = ?
        ORDER BY datetime(createdAt) DESC, rowid DESC
        LIMIT 1
      `).get(establishmentId, item.productId);
      if (!latest || latest.type !== 'purchase_receipt' || latest.referenceId !== purchaseId) {
        throw new InventoryError(
          `Nao e seguro cancelar: o estoque de "${item.productName}" foi movimentado depois do recebimento.`,
          409,
          'purchase_has_later_movements'
        );
      }

      const stockBefore = Number(product.stock || 0);
      const stockAfter = Number(latest.stockBefore);
      if (stockBefore !== Number(latest.stockAfter) || stockAfter < 0) {
        throw new InventoryError(`O saldo de "${item.productName}" nao permite o cancelamento seguro.`, 409);
      }

      const restoredCost = Number(item.previousCostPrice || 0);
      updateProduct.run(stockAfter, restoredCost, now, product.id, establishmentId);
      insertMovement.run(
        uuid(), establishmentId, product.id, product.name, -Number(item.quantity),
        stockBefore, stockAfter, Number(item.unitCost), purchaseId,
        purchase.invoiceNumber ? `Cancelamento da nota ${purchase.invoiceNumber}` : 'Cancelamento de compra',
        userId, now
      );
    }

    db.prepare(`
      UPDATE purchases
      SET status = 'cancelled', cancelledAt = ?, updatedAt = ?
      WHERE id = ? AND establishmentId = ? AND status = 'received'
    `).run(now, now, purchaseId, establishmentId);
  });

  transaction();
  return getPurchaseWithItems(db, purchaseId, establishmentId);
};

module.exports = {
  InventoryError,
  cancelPurchase,
  getPurchaseWithItems,
  normalizePurchaseItems,
  normalizeSupplierPayload,
  receivePurchase,
  roundMoney,
};
