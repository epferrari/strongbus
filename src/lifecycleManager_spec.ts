import {LifecycleManager} from './lifecycleManager';
import {StrongbusLogger} from './strongbusLogger';
import type {LifecycleHost} from './types/lifecycleHost';

type TestEventMap = {
  foo: string;
};

describe('LifecycleManager', () => {
  let host: jasmine.SpyObj<LifecycleHost<TestEventMap>>;
  let manager: LifecycleManager<TestEventMap>;
  let order: string[];
  let logger: StrongbusLogger<TestEventMap>;
  let lifecycleOptions: {coalesceDownstreamLifecycleEvents: boolean};

  beforeEach(() => {
    order = [];
    logger = new StrongbusLogger<TestEventMap>({
      name: 'test',
      provider: console,
      thresholds: {info: 100, warn: 500, error: Infinity},
      verbose: false
    });
    lifecycleOptions = {coalesceDownstreamLifecycleEvents: false};
    host = jasmine.createSpyObj('host', [
      'hasListeners',
      'getListenerCount',
      'getListenerCountFor',
      'getOwnListenerCount',
      'accountForDownstreamListeners',
      'accountForRemovedDownstreamListeners'
    ]);
    host.hasListeners.and.returnValue(false);
    host.getListenerCount.and.returnValue(0);
    host.getListenerCountFor.and.returnValue(0);
    host.getOwnListenerCount.and.returnValue(0);

    manager = new LifecycleManager<TestEventMap>({
      host,
      options: lifecycleOptions,
      logger
    });

    manager.hook('willAddListener', (event) => order.push(`willAdd:${event}`));
    manager.hook('didAddListener', (event) => order.push(`didAdd:${event}`));
    manager.hook('willRemoveListener', (event) => order.push(`willRemove:${event}`));
    manager.hook('didRemoveListener', (event) => order.push(`didRemove:${event}`));
    manager.hook('willActivate', () => order.push('willActivate'));
    manager.hook('active', () => order.push('active'));
    manager.hook('willIdle', () => order.push('willIdle'));
    manager.hook('idle', () => order.push('idle'));
  });

  it('brackets activation when the first own listener is added', () => {
    host.hasListeners.and.returnValue(true);

    manager.ownListenerWillAdd('foo');
    manager.ownListenerDidAdd('foo');

    expect(order).toEqual([
      'willActivate',
      'willAdd:foo',
      'didAdd:foo',
      'active'
    ]);
    expect(manager.active).toBeTrue();
  });

  it('brackets idle when the last own listener is removed', () => {
    host.getListenerCountFor.and.returnValue(1);
    host.getListenerCount.and.returnValue(1);
    host.hasListeners.and.returnValues(true, false);
    manager.ownListenerDidAdd('foo');

    order.length = 0;
    manager.ownListenerWillRemove('foo');
    manager.ownListenerDidRemove('foo');

    expect(order).toEqual([
      'willIdle',
      'willRemove:foo',
      'didRemove:foo',
      'idle'
    ]);
    expect(manager.active).toBeFalse();
  });

  it('coalesces downstream attach hooks when configured', () => {
    const coalescing = new LifecycleManager<TestEventMap>({
      host,
      options: {coalesceDownstreamLifecycleEvents: true},
      logger
    });
    coalescing.hook('willAddListener', (event) => order.push(`willAdd:${event}`));
    coalescing.hook('didAddListener', (event) => order.push(`didAdd:${event}`));
    coalescing.hook('willActivate', () => order.push('willActivate'));
    coalescing.hook('active', () => order.push('active'));

    host.hasListeners.and.returnValue(true);
    coalescing.onDownstreamAttached([
      {event: 'foo', count: 2}
    ]);

    expect(order).toEqual([
      'willActivate',
      'willAdd:foo',
      'didAdd:foo',
      'active'
    ]);
    expect(host.accountForDownstreamListeners).toHaveBeenCalledOnceWith('foo', 2);
  });

  it('interleaves add hooks per listener when not coalescing', () => {
    host.hasListeners.and.returnValue(true);
    order.length = 0;

    manager.onDownstreamAttached([
      {event: 'foo', count: 2}
    ]);

    expect(order).toEqual([
      'willActivate',
      'willAdd:foo',
      'didAdd:foo',
      'active',
      'willAdd:foo',
      'didAdd:foo'
    ]);
    expect(host.accountForDownstreamListeners).toHaveBeenCalledTimes(2);
    expect(host.accountForDownstreamListeners).toHaveBeenCalledWith('foo', 1);
  });

  it('does not bracket idle when detach snapshot is not the last downstream demand', () => {
    host.hasListeners.and.returnValue(true);
    manager.ownListenerDidAdd('foo');
    order.length = 0;

    host.getOwnListenerCount.and.returnValue(0);
    host.getListenerCount.and.returnValue(2);
    host.hasListeners.and.returnValues(true, true);

    manager.onDownstreamDetached([
      {event: 'foo', count: 1}
    ]);

    expect(order).toEqual([
      'willRemove:foo',
      'didRemove:foo'
    ]);
  });

  it('brackets idle before the last listener remove when detach snapshot is the last downstream demand', () => {
    host.hasListeners.and.returnValue(true);
    manager.ownListenerDidAdd('foo');
    order.length = 0;

    host.getOwnListenerCount.and.returnValue(0);
    host.getListenerCount.and.returnValue(2);
    host.hasListeners.and.returnValues(true, false);

    manager.onDownstreamDetached([
      {event: 'foo', count: 2}
    ]);

    expect(order).toEqual([
      'willRemove:foo',
      'didRemove:foo',
      'willIdle',
      'willRemove:foo',
      'didRemove:foo',
      'idle'
    ]);
  });
});
