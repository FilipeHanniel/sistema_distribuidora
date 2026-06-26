const PLAN_CATALOG = {
  basic: {
    key: 'basic',
    label: 'Basico',
    description: 'Operacao inicial para um estabelecimento pequeno.',
    limits: {
      maxUsers: 6,
      maxOperators: 5,
      maxProducts: 500,
      maxPaymentAccounts: 3,
    },
    features: {
      fiscal: true,
      aiReports: true,
      mercadoPagoPix: true,
      mercadoPagoPoint: false,
    },
  },
  premium: {
    key: 'premium',
    label: 'Premium',
    description: 'Operacao com equipe maior e mais contas de recebimento.',
    limits: {
      maxUsers: 16,
      maxOperators: 15,
      maxProducts: 3000,
      maxPaymentAccounts: 6,
    },
    features: {
      fiscal: true,
      aiReports: true,
      mercadoPagoPix: true,
      mercadoPagoPoint: true,
    },
  },
  enterprise: {
    key: 'enterprise',
    label: 'Enterprise',
    description: 'Operacao personalizada sem limites praticos no sistema.',
    limits: {
      maxUsers: null,
      maxOperators: null,
      maxProducts: null,
      maxPaymentAccounts: null,
    },
    features: {
      fiscal: true,
      aiReports: true,
      mercadoPagoPix: true,
      mercadoPagoPoint: true,
    },
  },
};

const VALID_SUBSCRIPTION_STATUSES = ['active', 'overdue', 'suspended'];

function normalizePlan(plan) {
  return PLAN_CATALOG[plan] ? plan : 'basic';
}

function getPlanDefinition(plan) {
  return PLAN_CATALOG[normalizePlan(plan)];
}

function getPlanCatalogList() {
  return Object.values(PLAN_CATALOG);
}

function normalizeSubscriptionStatus(status) {
  return VALID_SUBSCRIPTION_STATUSES.includes(status) ? status : 'active';
}

function getPlanLimit(plan, resource) {
  const definition = getPlanDefinition(plan);
  return Object.prototype.hasOwnProperty.call(definition.limits, resource)
    ? definition.limits[resource]
    : null;
}

function checkPlanLimit(plan, resource, currentCount, increment = 1) {
  const limit = getPlanLimit(plan, resource);
  if (limit === null || limit === undefined) {
    return {
      allowed: true,
      limit,
      currentCount,
      nextCount: currentCount + increment,
    };
  }

  const nextCount = currentCount + increment;
  return {
    allowed: nextCount <= limit,
    limit,
    currentCount,
    nextCount,
  };
}

function getSubscriptionAccess(status) {
  const normalized = normalizeSubscriptionStatus(status);
  return {
    status: normalized,
    canOperate: normalized !== 'suspended',
    message: normalized === 'suspended'
      ? 'Assinatura suspensa. Regularize a conta para continuar operando.'
      : null,
  };
}

module.exports = {
  PLAN_CATALOG,
  VALID_SUBSCRIPTION_STATUSES,
  normalizePlan,
  getPlanDefinition,
  getPlanCatalogList,
  normalizeSubscriptionStatus,
  getPlanLimit,
  checkPlanLimit,
  getSubscriptionAccess,
};
