const getPaymentTransactionIssue = (transaction, now = new Date()) => {
  if (transaction.error) return 'provider_error';
  if (transaction.status === 'paid' && !transaction.saleId) return 'paid_without_sale';
  if (transaction.status === 'processing' && !transaction.saleId) return 'finalization_in_progress';
  if (
    transaction.status === 'pending'
    && transaction.expiresAt
    && new Date(transaction.expiresAt).getTime() < now.getTime()
  ) return 'expired_pending';
  return null;
};

module.exports = {
  getPaymentTransactionIssue,
};
