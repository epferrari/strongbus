import {Bus} from '../../strongbus';
import { ControlSurface } from './controlSurface';
import { EmittingSurface } from './emittingSurface';
import { IntrospectionSurface } from './introspectionSurface';
import { MonitoringSurface } from './monitoringSurface';
import { SubscriptionSurface } from './subscriptionSurface';

type TestEvents = {
  echo: string;
};

/**
 * Mimics carriers (e.g. worker proxies) that expose brands via `get` but do not
 * implement `has` — so `BRAND in proxy` is false even when `proxy[BRAND]` works.
 */
function proxyWithoutHasTrap<T extends object>(target: T): T {
  return new Proxy({} as T, {
    get(_ignored, key, receiver) {
      return Reflect.get(target, key, receiver);
    }
  });
}

describe('surface brand unwrap', () => {
  let bus: Bus<TestEvents>;

  beforeEach(() => {
    bus = new Bus<TestEvents>({name: 'surfaceUnwrap.spec'});
  });

  describe('given a Proxy carrier with get but no has trap', () => {
    it('SubscriptionSurface unwraps the branded bus', () => {
      const carrier = proxyWithoutHasTrap({
        [SubscriptionSurface.BRAND]: bus
      });
      expect(SubscriptionSurface.BRAND in carrier).toBe(false);

      const received: string[] = [];
      SubscriptionSurface(carrier).on('echo', payload => received.push(payload));
      bus.emit('echo', 'hello');
      expect(received).toEqual(['hello']);
    });

    it('MonitoringSurface unwraps the branded bus', () => {
      const carrier = proxyWithoutHasTrap({
        [MonitoringSurface.BRAND]: bus
      });
      expect(MonitoringSurface.BRAND in carrier).toBe(false);

      const states: boolean[] = [];
      MonitoringSurface(carrier).monitor(active => states.push(active));
      bus.on('echo', () => undefined);
      expect(states).toEqual([true]);
    });

    it('IntrospectionSurface unwraps the branded bus', () => {
      const carrier = proxyWithoutHasTrap({
        [IntrospectionSurface.BRAND]: bus
      });
      expect(IntrospectionSurface.BRAND in carrier).toBe(false);

      bus.on('echo', () => undefined);
      expect(IntrospectionSurface(carrier).hasListeners()).toBe(true);
    });

    it('EmittingSurface unwraps the branded bus', () => {
      const carrier = proxyWithoutHasTrap({
        [EmittingSurface.BRAND]: bus
      });
      expect(EmittingSurface.BRAND in carrier).toBe(false);

      const received: string[] = [];
      bus.on('echo', payload => received.push(payload));
      EmittingSurface(carrier).emit('echo', 'via-emit');
      expect(received).toEqual(['via-emit']);
    });

    it('ControlSurface unwraps the branded bus', () => {
      const carrier = proxyWithoutHasTrap({
        [ControlSurface.BRAND]: bus
      });
      expect(ControlSurface.BRAND in carrier).toBe(false);

      let destroyed = false;
      bus.hook('willDestroy', () => {
        destroyed = true;
      });
      ControlSurface(carrier).destroy();
      expect(destroyed).toBe(true);
    });
  });

  describe('given a Proxy that returns stubs for unknown keys', () => {
    it('does not treat a stub as the SubscriptionSurface', () => {
      const interceptors: Record<PropertyKey, unknown> = {
        [SubscriptionSurface.BRAND]: bus
      };
      const carrier = new Proxy({} as SubscriptionSurface.Branded<TestEvents>, {
        get(_target, key): unknown {
          if(key in interceptors) {
            return interceptors[key];
          }
          return (): void => undefined;
        }
      });

      const received: string[] = [];
      SubscriptionSurface(carrier).on('echo', payload => received.push(payload));
      bus.emit('echo', 'not-a-stub');
      expect(received).toEqual(['not-a-stub']);
    });

    it('falls back to the argument when the brand slot is only a stub', () => {
      const carrier = new Proxy(bus, {
        get(target, key, receiver): unknown {
          if(key === SubscriptionSurface.BRAND) {
            return (): void => undefined;
          }
          return Reflect.get(target, key, receiver);
        }
      });

      const received: string[] = [];
      SubscriptionSurface(carrier as SubscriptionSurface<TestEvents>).on(
        'echo',
        payload => received.push(payload)
      );
      bus.emit('echo', 'from-bus');
      expect(received).toEqual(['from-bus']);
    });
  });

  it('still unwraps plain branded objects', () => {
    const carrier: SubscriptionSurface.Branded<TestEvents> = {
      [SubscriptionSurface.BRAND]: bus
    };
    const received: string[] = [];
    SubscriptionSurface(carrier).on('echo', payload => received.push(payload));
    bus.emit('echo', 'plain');
    expect(received).toEqual(['plain']);
  });

  it('returns a Bus passed directly', () => {
    expect(SubscriptionSurface(bus)).toBe(bus);
    expect(MonitoringSurface(bus)).toBe(bus);
    expect(IntrospectionSurface(bus)).toBe(bus);
    expect(EmittingSurface(bus)).toBe(bus);
    expect(ControlSurface(bus)).toBe(bus);
  });
});
