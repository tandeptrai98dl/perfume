/**
 * Order module public API. Foundation (M2): state machine, `transitionOrder`, order events and
 * codes. Streams add their blocks below: checkout `placeOrder` (checkout stream), admin queries
 * and commands (admin stream), customer queries (account stream).
 */
export {
  canTransition,
  customerCanCancel,
  DEDUCTED_STATUSES,
  isTerminal,
  nextStatuses,
  ORDER_STATUSES,
  RESERVING_STATUSES,
  type OrderStatus,
  type TransitionActor,
} from './state-machine';
export {
  lockOrder,
  recordOrderEvent,
  transitionOrder,
  type OrderActor,
  type TransitionInput,
  type TransitionResult,
} from './transition';
export { generateOrderCode, ORDER_CODE_PATTERN } from './codes';
