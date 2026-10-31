import type { TransactionRecord } from './transaction.types';

export type Direction = 'IN' | 'OUT' | 'SELF';

export function presentTransaction(tx: TransactionRecord) {
  return {
    id: tx._id,
    type: tx.type,
    status: tx.status,
    unique_reference: tx.unique_reference,
    source: tx.source,
    destination: tx.destination,
    fx: tx.fx,
    failure: tx.failure,
    created_at: new Date(tx.created_at).toISOString(),
    completed_at: tx.completed_at ? new Date(tx.completed_at).toISOString() : null,
  };
}

/** Direction of a transaction from the point of view of one wallet. */
export function directionFor(tx: TransactionRecord, walletId: string): Direction {
  const isSource = tx.source.wallet_id === walletId;
  const isDestination = tx.destination.wallet_id === walletId;
  if (isSource && isDestination) {
    return 'SELF';
  }
  return isSource ? 'OUT' : 'IN';
}
