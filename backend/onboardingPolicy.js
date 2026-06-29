const buildOnboardingStatus = ({
  establishment = {},
  activeManagers = 0,
  managerUsername = null,
  settingsConfigured = false,
  productCount = 0,
  paymentAccountCount = 0,
  fiscalModeDefined = false,
}) => {
  const steps = [
    {
      key: 'identity',
      label: 'Identidade e codigo de acesso',
      complete: Boolean(String(establishment.name || '').trim() && String(establishment.loginCode || '').trim()),
      required: true,
      action: 'edit_establishment',
    },
    {
      key: 'manager',
      label: 'Gestor ativo para o primeiro acesso',
      complete: activeManagers > 0,
      required: true,
      action: 'manage_users',
    },
    {
      key: 'contact',
      label: 'Responsavel e contato cadastrados',
      complete: Boolean(
        String(establishment.ownerName || '').trim()
        && (String(establishment.email || '').trim() || String(establishment.phone || '').trim())
      ),
      required: true,
      action: 'edit_establishment',
    },
    {
      key: 'subscription',
      label: 'Plano e vencimento definidos',
      complete: Boolean(establishment.plan && establishment.subscriptionDueDate),
      required: true,
      action: 'edit_subscription',
    },
    {
      key: 'settings',
      label: 'Configuracoes iniciais criadas',
      complete: settingsConfigured,
      required: true,
      action: 'edit_establishment',
    },
    {
      key: 'catalog',
      label: 'Primeiro produto cadastrado pelo gestor',
      complete: productCount > 0,
      required: false,
      action: 'manager_setup',
    },
    {
      key: 'receiving',
      label: 'Conta de recebimento configurada',
      complete: paymentAccountCount > 0,
      required: false,
      action: 'manager_setup',
    },
    {
      key: 'fiscal',
      label: 'Modo fiscal definido',
      complete: fiscalModeDefined,
      required: false,
      action: 'manager_setup',
    },
  ];

  const requiredSteps = steps.filter(step => step.required);
  const requiredComplete = requiredSteps.filter(step => step.complete).length;
  const completedSteps = steps.filter(step => step.complete).length;
  const ready = requiredComplete === requiredSteps.length;
  const operational = ready && productCount > 0;

  return {
    status: operational ? 'operational' : ready ? 'ready' : 'needs_attention',
    ready,
    operational,
    requiredComplete,
    requiredTotal: requiredSteps.length,
    completedSteps,
    totalSteps: steps.length,
    progress: Math.round((completedSteps / steps.length) * 100),
    managerUsername,
    nextStep: steps.find(step => !step.complete) || null,
    steps,
  };
};

module.exports = { buildOnboardingStatus };
