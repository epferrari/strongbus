import * as Strongbus from './';
import type {Logger} from './types/logger';

type TestEventMap = {
  foo: string;
  bar: boolean;
};

const EVENTS: (keyof TestEventMap)[] = ['foo', 'bar'];
const SCOPES = [Strongbus.ListenerScope.ANY, Strongbus.ListenerScope.OWN, Strongbus.ListenerScope.DOWNSTREAM];

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
};

type TestBus = Strongbus.Bus<TestEventMap>;

function createBus(name: string = 'bus'): TestBus {
  return new Strongbus.Bus<TestEventMap>({name, logger: silentLogger});
}

/** Everything a caller can ask a bus about its listeners, as plain data. */
function snapshot(bus: TestBus): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for(const scope of SCOPES) {
    for(const includeIncognito of [false, true]) {
      const options = {scope, includeIncognito};
      const key = `scope ${scope}, incognito ${includeIncognito}`;
      result[`${key}: total`] = bus.getListenerCount(options);
      result[`${key}: hasListeners`] = bus.hasListeners(options);
      for(const event of EVENTS) {
        result[`${key}: ${event}`] = bus.getListenerCountFor(event, options);
        result[`${key}: ${event} handlers`] = bus.getListenersFor(event, options).size;
      }
    }
  }
  return result;
}

function snapshotAll(buses: TestBus[]): Record<string, unknown>[] {
  const snapshots = buses.map(snapshot);
  // `hasListeners` answers without building the listener maps, so check it against the counts
  buses.forEach((bus) => {
    for(const scope of SCOPES) {
      for(const includeIncognito of [false, true]) {
        const options = {scope, includeIncognito};
        expect(bus.hasListeners(options))
          .withContext(`bus "${bus.name}" hasListeners vs count, scope ${scope}, incognito ${includeIncognito}`)
          .toBe(bus.getListenerCount(options) > 0);
      }
    }
  });
  return snapshots;
}

/** Drops every bus's cached listener maps so the next read recounts from scratch. */
function invalidateAll(buses: TestBus[]): void {
  for(const bus of buses) {
    const introspection = (bus as any).introspection;
    introspection.invalidateCombinedListenerCache();
    introspection.invalidateOwnListenerCache();
  }
}

/**
 * Reads every bus (warming its caches, as an app would), then compares that with a read
 * after all caches were dropped.
 */
function expectCachesToMatchFreshCount(buses: TestBus[], context: string = ''): void {
  const cached = snapshotAll(buses);
  invalidateAll(buses);
  const fresh = snapshotAll(buses);
  buses.forEach((bus, i) => {
    expect(cached[i]).withContext(`${context}bus "${bus.name}"`.trim()).toEqual(fresh[i]);
  });
}

describe('listener introspection across pipes', () => {
  const noop = (): void => undefined;
  const all = {includeIncognito: true};

  describe('given an upstream that has already been read', () => {
    it('sees an incognito listener added to the downstream afterwards', () => {
      const a = createBus('a');
      const b = createBus('b');
      a.pipe(b);
      expect(a.getListenerCount(all)).toBe(0);

      b.on('foo', noop, {incognito: true});

      expect(a.getListenerCount(all)).toBe(1);
      expect(a.getListenerCount()).toBe(0);
      expectCachesToMatchFreshCount([a, b]);
    });

    it('stops seeing an incognito listener removed from the downstream', () => {
      const a = createBus('a');
      const b = createBus('b');
      a.pipe(b);
      const off = b.on('foo', noop, {incognito: true});
      expect(a.getListenerCount(all)).toBe(1);

      off();

      expect(a.getListenerCount(all)).toBe(0);
      expectCachesToMatchFreshCount([a, b]);
    });

    it('sees listeners the downstream gains through a new edge one hop further down', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      c.on('foo', noop);
      a.pipe(b);
      expect(a.getListenerCount()).toBe(0);

      b.pipe(c);

      expect(a.getListenerCount()).toBe(1);
      expectCachesToMatchFreshCount([a, b, c]);
    });

    it('stops seeing listeners once the edge one hop further down is removed', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      c.on('foo', noop);
      a.pipe(b);
      b.pipe(c);
      expect(a.getListenerCount()).toBe(1);

      b.unpipe(c);

      expect(a.getListenerCount()).toBe(0);
      expect(a.hasListeners()).toBeFalse();
      expectCachesToMatchFreshCount([a, b, c]);
    });

    it('sees listeners added and removed at the far end of a long chain', () => {
      const chain = [createBus('a'), createBus('b'), createBus('c'), createBus('d'), createBus('e')];
      for(let i = 1; i < chain.length; i++) {
        chain[i - 1].pipe(chain[i]);
      }
      const [head, , , , tail] = chain;
      snapshotAll(chain); // warm every cache

      const off = tail.on('foo', noop);
      expect(head.getListenerCountFor('foo')).toBe(1);
      const offIncognito = tail.on('bar', noop, {incognito: true});
      expect(head.getListenerCountFor('bar', all)).toBe(1);
      expect(head.getListenerCountFor('bar')).toBe(0);
      expectCachesToMatchFreshCount(chain);

      off();
      offIncognito();
      expect(head.getListenerCount(all)).toBe(0);
      expectCachesToMatchFreshCount(chain);
    });
  });

  describe('given an incognito edge', () => {
    it('sees listeners added to the downstream afterwards when asking for incognito', () => {
      const a = createBus('a');
      const b = createBus('b');
      a.pipe(b, {incognito: true});
      expect(a.getListenerCount(all)).toBe(0);

      b.on('foo', noop);

      expect(a.getListenerCount(all)).toBe(1);
      expect(a.getListenerCount()).toBe(0);
      expectCachesToMatchFreshCount([a, b]);
    });

    it('still reflects removals through an incognito edge in the middle of a chain', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      a.pipe(b, {incognito: true});
      b.pipe(c);
      const off = c.on('foo', noop);
      expect(a.getListenerCount(all)).toBe(1);

      off();

      expect(a.getListenerCount(all)).toBe(0);
      expectCachesToMatchFreshCount([a, b, c]);
    });
  });

  describe('given several paths to the same downstream', () => {
    it('counts the downstream once and follows edge removals on either path', () => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(createBus);
      a.pipe(b);
      a.pipe(c);
      b.pipe(d);
      c.pipe(d);
      const buses = [a, b, c, d];
      snapshotAll(buses); // warm every cache

      d.on('foo', noop, {incognito: true});
      d.on('bar', noop);
      expect(a.getListenerCount(all)).toBe(2);
      expectCachesToMatchFreshCount(buses);

      b.unpipe(d);
      expect(a.getListenerCount(all)).toBe(2);
      c.unpipe(d);
      expect(a.getListenerCount(all)).toBe(0);
      expectCachesToMatchFreshCount(buses);
    });
  });

  describe('given the downstream is torn down', () => {
    it('stops seeing its listeners after clear()', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      a.pipe(b);
      b.pipe(c);
      c.on('foo', noop);
      c.on('bar', noop, {incognito: true});
      expect(a.getListenerCount(all)).toBe(2);

      c.clear();

      expect(a.getListenerCount(all)).toBe(0);
      expectCachesToMatchFreshCount([a, b, c]);
    });

    it('stops seeing the listeners behind a bus that severs its downstream edges', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      a.pipe(b);
      b.pipe(c);
      c.on('foo', noop);
      expect(a.getListenerCount()).toBe(1);

      b.clear({scope: Strongbus.ListenerScope.DOWNSTREAM});

      expect(a.getListenerCount()).toBe(0);
      expectCachesToMatchFreshCount([a, b, c]);
    });

    it('stops seeing the listeners behind a destroyed bus', () => {
      const a = createBus('a');
      const b = createBus('b');
      const c = createBus('c');
      a.pipe(b);
      b.pipe(c);
      c.on('foo', noop);
      expect(a.getListenerCount()).toBe(1);

      b.destroy();

      expect(a.getListenerCount()).toBe(0);
      expectCachesToMatchFreshCount([a, b, c]);
    });
  });

  describe('given random changes to the graph', () => {
    function mulberry32(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
    const BUS_COUNT = 6;
    const STEPS = 150;

    for(const seed of SEEDS) {
      it(`keeps every bus's cached answers equal to a fresh count (seed ${seed})`, () => {
        const random = mulberry32(seed);
        const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
        const buses = Array.from({length: BUS_COUNT}, (_, i) => createBus(`bus${i}`));
        const subscriptions: Strongbus.Subscription[] = [];
        const edges: {from: TestBus; to: TestBus}[] = [];
        snapshotAll(buses); // warm every cache

        for(let step = 0; step < STEPS; step++) {
          const roll = random();
          const description = `seed ${seed}, step ${step}`;
          if(roll < 0.3) {
            // a fresh function each time: the default duplicate strategy would collapse a shared one
            const sub = pick(buses).on(pick(EVENTS), () => undefined, {incognito: random() < 0.4});
            subscriptions.push(sub);
          } else if(roll < 0.45 && subscriptions.length) {
            subscriptions.splice(Math.floor(random() * subscriptions.length), 1)[0]();
          } else if(roll < 0.7) {
            // any pair: edges that would close a cycle are refused, and unpiping them is a no-op
            const from = pick(buses);
            const to = pick(buses);
            const options = {incognito: random() < 0.3};
            if(random() < 0.3) {
              from.pipe(Strongbus.ASSUMED_SOUND_EDGE).pipe(to, options);
            } else {
              from.pipe(to, options);
            }
            edges.push({from, to});
          } else if(roll < 0.85 && edges.length) {
            const {from, to} = edges.splice(Math.floor(random() * edges.length), 1)[0];
            from.unpipe(to);
          } else if(roll < 0.88) {
            pick(buses).clear({
              scope: pick(SCOPES),
              includeIncognito: random() < 0.5
            });
          } else if(roll < 0.9) {
            pick(buses).destroy();
          }
          // the previous step's fresh read left every cache warm, so any stale entry shows up here
          expectCachesToMatchFreshCount(buses, `${description}, `);
        }
      });
    }
  });
});
