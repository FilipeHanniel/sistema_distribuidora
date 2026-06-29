const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 7;

const utcDay = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const normalizeGraceDays = (value, fallback = DEFAULT_GRACE_DAYS) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(90, Math.max(0, parsed));
};

const evaluateSubscription = ({
  dueDate,
  currentStatus = 'active',
  statusReason = null,
  graceDays = DEFAULT_GRACE_DAYS,
  now = new Date(),
}) => {
  const normalizedGraceDays = normalizeGraceDays(graceDays);
  const dueDay = utcDay(dueDate);
  const today = utcDay(now);
  const manualSuspension = currentStatus === 'suspended' && statusReason !== 'past_due';

  if (manualSuspension) {
    return {
      status: 'suspended',
      reason: statusReason || 'manual',
      manualSuspension: true,
      graceDays: normalizedGraceDays,
      daysUntilDue: null,
      daysPastDue: null,
      suspensionDate: null,
    };
  }

  if (dueDay === null || today === null) {
    return {
      status: currentStatus === 'suspended' ? 'suspended' : 'active',
      reason: currentStatus === 'suspended' ? statusReason : null,
      manualSuspension: false,
      graceDays: normalizedGraceDays,
      daysUntilDue: null,
      daysPastDue: null,
      suspensionDate: null,
    };
  }

  const daysPastDue = Math.floor((today - dueDay) / DAY_MS);
  const suspensionDay = dueDay + (normalizedGraceDays + 1) * DAY_MS;
  const suspensionDate = new Date(suspensionDay).toISOString();

  if (daysPastDue <= 0) {
    return {
      status: 'active',
      reason: null,
      manualSuspension: false,
      graceDays: normalizedGraceDays,
      daysUntilDue: Math.abs(daysPastDue),
      daysPastDue: 0,
      suspensionDate,
    };
  }

  if (daysPastDue <= normalizedGraceDays) {
    return {
      status: 'overdue',
      reason: 'past_due',
      manualSuspension: false,
      graceDays: normalizedGraceDays,
      daysUntilDue: 0,
      daysPastDue,
      suspensionDate,
    };
  }

  return {
    status: 'suspended',
    reason: 'past_due',
    manualSuspension: false,
    graceDays: normalizedGraceDays,
    daysUntilDue: 0,
    daysPastDue,
    suspensionDate,
  };
};

module.exports = {
  DAY_MS,
  DEFAULT_GRACE_DAYS,
  evaluateSubscription,
  normalizeGraceDays,
};
