const { roundMoney } = require('./inventoryService');

const clampInteger = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const toIsoDate = date => date.toISOString().slice(0, 10);

const startOfToday = (now) => {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const roundNumber = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
};

const getRiskLevel = (stock, daysCover) => {
  if (stock <= 0) return 'out';
  if (daysCover <= 7) return 'critical';
  if (daysCover <= 15) return 'attention';
  return 'monitor';
};

const buildInventoryReport = (db, establishmentId, options = {}) => {
  const now = options.now ? new Date(options.now) : new Date();
  const periodDays = clampInteger(options.periodDays, 30, 7, 365);
  const salesWindowDays = clampInteger(options.salesWindowDays, 90, 30, 180);
  const ruptureRiskDays = clampInteger(options.ruptureRiskDays, 15, 3, 60);
  const today = startOfToday(now);
  const periodStart = addDays(today, -(periodDays - 1));
  const periodEnd = now;
  const salesWindowStart = addDays(today, -(salesWindowDays - 1));

  const settings = db.prepare(`
    SELECT lowStockThreshold FROM tenant_settings WHERE establishmentId = ?
  `).get(establishmentId) || {};
  const lowStockThreshold = Number.isInteger(Number(settings.lowStockThreshold))
    ? Math.max(0, Number(settings.lowStockThreshold))
    : 5;

  const products = db.prepare(`
    SELECT id, name, category, stock, costPrice, sellPrice
    FROM products
    WHERE establishmentId = ?
    ORDER BY name
  `).all(establishmentId).map(product => ({
    ...product,
    stock: Number(product.stock || 0),
    costPrice: Number(product.costPrice || 0),
    sellPrice: Number(product.sellPrice || 0),
    category: product.category || 'Geral',
  }));

  const stockSummary = products.reduce((summary, product) => {
    const costValue = product.stock * product.costPrice;
    const retailValue = product.stock * product.sellPrice;
    summary.productCount += 1;
    summary.inventoryUnits += product.stock;
    summary.inventoryCostValue += costValue;
    summary.inventoryRetailValue += retailValue;
    if (product.stock <= 0) summary.outOfStockCount += 1;
    return summary;
  }, {
    productCount: 0,
    inventoryUnits: 0,
    inventoryCostValue: 0,
    inventoryRetailValue: 0,
    outOfStockCount: 0,
  });

  const salesSummaryRow = db.prepare(`
    SELECT
      COUNT(*) AS salesCount,
      COALESCE(SUM(totalAmount), 0) AS revenue,
      COALESCE(AVG(totalAmount), 0) AS averageTicket
    FROM sales
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt <= ?
  `).get(establishmentId, periodStart.toISOString(), periodEnd.toISOString());

  const unitsSoldRow = db.prepare(`
    SELECT COALESCE(SUM(si.quantity), 0) AS unitsSold
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.establishmentId = ? AND s.createdAt >= ? AND s.createdAt <= ?
  `).get(establishmentId, periodStart.toISOString(), periodEnd.toISOString());

  const productSales = db.prepare(`
    SELECT
      si.productId,
      MAX(si.name) AS name,
      MAX(COALESCE(p.category, 'Geral')) AS category,
      MAX(COALESCE(p.stock, 0)) AS currentStock,
      MAX(COALESCE(p.costPrice, 0)) AS currentCostPrice,
      MAX(COALESCE(p.sellPrice, 0)) AS currentSellPrice,
      SUM(si.quantity) AS quantitySold,
      SUM(si.totalPrice) AS revenue,
      SUM(
        COALESCE(
          ABS(sm.quantity) * COALESCE(sm.unitCost, 0),
          si.quantity * COALESCE(p.costPrice, 0),
          0
        )
      ) AS estimatedCost
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    LEFT JOIN products p ON p.id = si.productId AND p.establishmentId = s.establishmentId
    LEFT JOIN stock_movements sm
      ON sm.establishmentId = s.establishmentId
      AND sm.referenceId = s.id
      AND sm.productId = si.productId
      AND sm.type = 'sale'
    WHERE s.establishmentId = ? AND s.createdAt >= ? AND s.createdAt <= ?
    GROUP BY si.productId
    ORDER BY revenue DESC
  `).all(establishmentId, periodStart.toISOString(), periodEnd.toISOString()).map(row => {
    const revenue = roundMoney(row.revenue || 0);
    const estimatedCost = roundMoney(row.estimatedCost || 0);
    const grossProfit = roundMoney(revenue - estimatedCost);
    return {
      productId: row.productId,
      name: row.name,
      category: row.category || 'Geral',
      quantitySold: Number(row.quantitySold || 0),
      revenue,
      estimatedCost,
      grossProfit,
      grossMarginPct: revenue > 0 ? roundNumber((grossProfit / revenue) * 100, 1) : 0,
      currentStock: Number(row.currentStock || 0),
      currentCostPrice: Number(row.currentCostPrice || 0),
      currentSellPrice: Number(row.currentSellPrice || 0),
    };
  });

  const salesByDayRows = db.prepare(`
    SELECT substr(createdAt, 1, 10) AS date, COUNT(*) AS salesCount, COALESCE(SUM(totalAmount), 0) AS revenue
    FROM sales
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt <= ?
    GROUP BY substr(createdAt, 1, 10)
  `).all(establishmentId, periodStart.toISOString(), periodEnd.toISOString());
  const unitsByDayRows = db.prepare(`
    SELECT substr(s.createdAt, 1, 10) AS date, COALESCE(SUM(si.quantity), 0) AS unitsSold
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.establishmentId = ? AND s.createdAt >= ? AND s.createdAt <= ?
    GROUP BY substr(s.createdAt, 1, 10)
  `).all(establishmentId, periodStart.toISOString(), periodEnd.toISOString());
  const trendMap = new Map();
  for (let i = 0; i < periodDays; i += 1) {
    const date = toIsoDate(addDays(periodStart, i));
    trendMap.set(date, { date, revenue: 0, salesCount: 0, unitsSold: 0 });
  }
  salesByDayRows.forEach(row => {
    const bucket = trendMap.get(row.date);
    if (!bucket) return;
    bucket.revenue = roundMoney(row.revenue || 0);
    bucket.salesCount = Number(row.salesCount || 0);
  });
  unitsByDayRows.forEach(row => {
    const bucket = trendMap.get(row.date);
    if (!bucket) return;
    bucket.unitsSold = Number(row.unitsSold || 0);
  });

  const windowSalesRows = db.prepare(`
    SELECT
      si.productId,
      SUM(si.quantity) AS sold,
      SUM(si.totalPrice) AS revenue,
      MAX(s.createdAt) AS lastSaleAt
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.saleId
    WHERE s.establishmentId = ? AND s.createdAt >= ? AND s.createdAt <= ?
    GROUP BY si.productId
  `).all(establishmentId, salesWindowStart.toISOString(), periodEnd.toISOString());
  const windowSalesMap = new Map(windowSalesRows.map(row => [row.productId, {
    sold: Number(row.sold || 0),
    revenue: roundMoney(row.revenue || 0),
    lastSaleAt: row.lastSaleAt || null,
  }]));

  const lowStockProducts = [];
  const stagnantProducts = [];
  const ruptureRisks = [];
  for (const product of products) {
    const salesWindow = windowSalesMap.get(product.id) || { sold: 0, revenue: 0, lastSaleAt: null };
    const inventoryCostValue = roundMoney(product.stock * product.costPrice);
    const inventoryRetailValue = roundMoney(product.stock * product.sellPrice);
    const common = {
      productId: product.id,
      name: product.name,
      category: product.category,
      currentStock: product.stock,
      costPrice: roundMoney(product.costPrice),
      sellPrice: roundMoney(product.sellPrice),
      inventoryCostValue,
      inventoryRetailValue,
      soldLastWindow: salesWindow.sold,
      revenueLastWindow: salesWindow.revenue,
      lastSaleAt: salesWindow.lastSaleAt,
    };

    if (product.stock <= lowStockThreshold && (salesWindow.sold > 0 || product.stock <= 0)) {
      lowStockProducts.push(common);
    }

    if (product.stock > 0 && salesWindow.sold <= 0) {
      stagnantProducts.push(common);
      continue;
    }

    if (salesWindow.sold > 0) {
      const dailyAverage = salesWindow.sold / salesWindowDays;
      const daysCover = product.stock > 0 ? product.stock / dailyAverage : 0;
      if (product.stock <= 0 || daysCover <= ruptureRiskDays) {
        const targetDays = Math.max(30, ruptureRiskDays * 2);
        ruptureRisks.push({
          ...common,
          dailyAverage: roundNumber(dailyAverage, 2),
          daysCover: roundNumber(daysCover, 1),
          riskLevel: getRiskLevel(product.stock, daysCover),
          suggestedRestock: Math.max(0, Math.ceil((dailyAverage * targetDays) - product.stock)),
        });
      }
    }
  }

  lowStockProducts.sort((a, b) => a.currentStock - b.currentStock || b.soldLastWindow - a.soldLastWindow);
  stagnantProducts.sort((a, b) => b.inventoryCostValue - a.inventoryCostValue);
  ruptureRisks.sort((a, b) => a.daysCover - b.daysCover || b.soldLastWindow - a.soldLastWindow);

  const categoryMap = new Map();
  for (const product of products) {
    const category = product.category || 'Geral';
    const current = categoryMap.get(category) || {
      category,
      productCount: 0,
      stockUnits: 0,
      inventoryCostValue: 0,
      inventoryRetailValue: 0,
      quantitySold: 0,
      revenue: 0,
      grossProfit: 0,
    };
    current.productCount += 1;
    current.stockUnits += product.stock;
    current.inventoryCostValue += product.stock * product.costPrice;
    current.inventoryRetailValue += product.stock * product.sellPrice;
    categoryMap.set(category, current);
  }
  for (const sale of productSales) {
    const category = sale.category || 'Geral';
    const current = categoryMap.get(category) || {
      category,
      productCount: 0,
      stockUnits: 0,
      inventoryCostValue: 0,
      inventoryRetailValue: 0,
      quantitySold: 0,
      revenue: 0,
      grossProfit: 0,
    };
    current.quantitySold += sale.quantitySold;
    current.revenue += sale.revenue;
    current.grossProfit += sale.grossProfit;
    categoryMap.set(category, current);
  }

  const movementSummary = db.prepare(`
    SELECT
      type,
      COUNT(*) AS movementCount,
      COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END), 0) AS quantityIn,
      COALESCE(SUM(CASE WHEN quantity < 0 THEN ABS(quantity) ELSE 0 END), 0) AS quantityOut,
      COALESCE(SUM(quantity), 0) AS netQuantity,
      COALESCE(SUM(ABS(quantity) * COALESCE(unitCost, 0)), 0) AS estimatedValue
    FROM stock_movements
    WHERE establishmentId = ? AND createdAt >= ? AND createdAt <= ?
    GROUP BY type
    ORDER BY type
  `).all(establishmentId, periodStart.toISOString(), periodEnd.toISOString()).map(row => ({
    type: row.type,
    movementCount: Number(row.movementCount || 0),
    quantityIn: Number(row.quantityIn || 0),
    quantityOut: Number(row.quantityOut || 0),
    netQuantity: Number(row.netQuantity || 0),
    estimatedValue: roundMoney(row.estimatedValue || 0),
  }));

  const estimatedCost = roundMoney(productSales.reduce((sum, item) => sum + item.estimatedCost, 0));
  const grossProfit = roundMoney(productSales.reduce((sum, item) => sum + item.grossProfit, 0));
  const revenue = roundMoney(Number(salesSummaryRow.revenue || 0));
  const potentialGrossMargin = roundMoney(stockSummary.inventoryRetailValue - stockSummary.inventoryCostValue);

  return {
    generatedAt: now.toISOString(),
    period: {
      days: periodDays,
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
    },
    settings: {
      lowStockThreshold,
      ruptureRiskDays,
      salesWindowDays,
    },
    summary: {
      productCount: stockSummary.productCount,
      inventoryUnits: stockSummary.inventoryUnits,
      inventoryCostValue: roundMoney(stockSummary.inventoryCostValue),
      inventoryRetailValue: roundMoney(stockSummary.inventoryRetailValue),
      potentialGrossMargin,
      outOfStockCount: stockSummary.outOfStockCount,
      lowStockCount: lowStockProducts.length,
      ruptureRiskCount: ruptureRisks.length,
      stagnantCount: stagnantProducts.length,
      salesCount: Number(salesSummaryRow.salesCount || 0),
      revenue,
      unitsSold: Number(unitsSoldRow.unitsSold || 0),
      averageTicket: roundMoney(salesSummaryRow.averageTicket || 0),
      estimatedCost,
      grossProfit,
      grossMarginPct: revenue > 0 ? roundNumber((grossProfit / revenue) * 100, 1) : 0,
    },
    salesTrend: [...trendMap.values()],
    categoryBreakdown: [...categoryMap.values()]
      .map(item => ({
        ...item,
        inventoryCostValue: roundMoney(item.inventoryCostValue),
        inventoryRetailValue: roundMoney(item.inventoryRetailValue),
        revenue: roundMoney(item.revenue),
        grossProfit: roundMoney(item.grossProfit),
      }))
      .sort((a, b) => b.inventoryCostValue - a.inventoryCostValue),
    marginByProduct: productSales.sort((a, b) => b.grossProfit - a.grossProfit),
    lowStockProducts,
    ruptureRisks,
    stagnantProducts: stagnantProducts.slice(0, 30),
    movementSummary,
  };
};

module.exports = {
  buildInventoryReport,
  clampInteger,
};
