import {strEnum} from '../utils/strEnum';

export const Lifecycle = strEnum([
  'willActivate',
  'active',
  'willIdle',
  'idle',
  'willAddListener',
  'didAddListener',
  'willRemoveListener',
  'didRemoveListener',
  'willDestroy',
  'error'
]);
export type Lifecycle = keyof typeof Lifecycle;