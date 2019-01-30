import {strEnum} from '../utils/strEnum';

export const Lifecycle = strEnum([
  'willActivate',
  'active',
  'willIdle',
  'idle',
  'willAddListener',
  'didAddListener',
  'willRemoveListener',
  'didRemoveListener'
]);
export type Lifecycle = keyof typeof Lifecycle;