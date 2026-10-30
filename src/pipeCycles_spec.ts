import * as Strongbus from './';
import type {Logger, StrongbusLogRecord} from './types/logger';

type TestEventMap = {
  foo: string;
  bar: boolean;
};

type TestBus = Strongbus.Bus<TestEventMap>;

const noop = (): void => undefined;

describe('piping into a bus that already pipes into this one', () => {
  let records: (StrongbusLogRecord & {level: string})[];
  let logger: Logger;

  beforeEach(() => {
    records = [];
    const recordAt = (level: string) => (r: StrongbusLogRecord): void => {
      records.push({...r, level});
    };
    logger = {
      info: recordAt('info'),
      warn: recordAt('warn'),
      error: recordAt('error'),
      debug: recordAt('debug')
    };
  });

  function createBus(name: string): TestBus {
    return new Strongbus.Bus<TestEventMap>({name, logger});
  }

  function cycleRecords(): (StrongbusLogRecord & {level: string})[] {
    return records.filter(r => r.code === Strongbus.StrongbusLogCode.CyclicPipe);
  }

  describe('given a direct cycle', () => {
    let a: TestBus;
    let b: TestBus;
    let heardByA: string[];
    let heardByB: string[];

    beforeEach(() => {
      a = createBus('a');
      b = createBus('b');
      heardByA = [];
      heardByB = [];
      a.on('foo', (payload) => heardByA.push(payload));
      b.on('foo', (payload) => heardByB.push(payload));
      a.pipe(b);
    });

    it('does not create the edge, and returns the bus that was passed in', () => {
      expect(b.pipe(a)).toBe(a);

      b.emit('foo', 'from b');
      expect(heardByB).toEqual(['from b']);
      expect(heardByA).toEqual([]);
      a.emit('foo', 'from a');
      expect(heardByA).toEqual(['from a']);
      expect(heardByB).toEqual(['from b', 'from a']);
    });

    it('logs one warning, naming both buses and pointing at the docs', () => {
      b.pipe(a);

      expect(cycleRecords().length).toBe(1);
      const {message, level} = cycleRecords()[0];
      expect(level).toBe('warn');
      expect(message).toContain(b.name);
      expect(message).toContain(a.name);
      expect(message).toContain('pipe_limitations.md');
    });

    it('can still be introspected and emitted on afterwards', () => {
      b.pipe(a);

      expect(a.getListenerCount()).toBe(2);
      expect(b.getListenerCount()).toBe(1);
      expect(a.hasListeners({scope: Strongbus.ListenerScope.DOWNSTREAM})).toBeTrue();
      expect(b.hasListeners({scope: Strongbus.ListenerScope.DOWNSTREAM})).toBeFalse();
      expect(() => a.emit('foo', 'x')).not.toThrow();
      expect(() => b.emit('foo', 'y')).not.toThrow();
    });

    it('leaves no trace on either bus: no unsound-path warning, no lifecycle hooks, no activity', () => {
      const idleA = createBus('idleA');
      const idleB = createBus('idleB');
      const didAdd = jasmine.createSpy('didAddListener');
      idleB.hook(Strongbus.Lifecycle.didAddListener, didAdd);
      idleA.pipe(idleB);
      idleA.on('foo', noop);
      didAdd.calls.reset();
      records.length = 0;

      idleB.pipe(idleA);

      expect(didAdd).not.toHaveBeenCalled();
      expect(idleB.hasListeners()).toBeFalse();
      expect(idleB.active).toBeFalse();
      expect(records.map(r => r.code)).toEqual([Strongbus.StrongbusLogCode.CyclicPipe]);
    });

    it('also refuses the edge when it is incognito', () => {
      b.pipe(a, {incognito: true});

      expect(cycleRecords().length).toBe(1);
      expect(a.getListenerCount({includeIncognito: true})).toBe(2);
      expect(b.hasListeners({scope: Strongbus.ListenerScope.DOWNSTREAM, includeIncognito: true})).toBeFalse();
    });

    it('also refuses the edge when the existing edge is incognito', () => {
      const c = createBus('c');
      const d = createBus('d');
      c.pipe(d, {incognito: true});

      d.pipe(c);

      expect(cycleRecords().length).toBe(1);
      expect(c.getListenerCount({includeIncognito: true})).toBe(0);
    });

    it('also refuses the edge when it comes through a filtered pipe, without calling the filter', () => {
      const filter = jasmine.createSpy('filter').and.returnValue(true);

      expect(b.pipe(filter).pipe(a)).toBe(a);

      expect(cycleRecords().length).toBe(1);
      a.emit('foo', 'x');
      b.emit('foo', 'y');
      expect(filter).not.toHaveBeenCalled();
    });

    it('lets the edge be created once the edge that would close the cycle is removed', () => {
      b.pipe(a);
      expect(cycleRecords().length).toBe(1);

      a.unpipe(b);
      b.pipe(a);
      expect(cycleRecords().length).toBe(1);
      b.emit('foo', 'from b');
      expect(heardByA).toEqual(['from b']);

      // and now it is a -> b that would close the cycle
      a.pipe(b);
      expect(cycleRecords().length).toBe(2);
    });
  });

  describe('given a longer cycle', () => {
    it('refuses the edge that closes a chain of three', () => {
      const [a, b, c] = ['a', 'b', 'c'].map(createBus);
      a.pipe(b);
      b.pipe(c);

      expect(c.pipe(a)).toBe(a);

      expect(cycleRecords().length).toBe(1);
      expect(c.getListenerCount()).toBe(0);
      expect(a.getListenerCount()).toBe(0);
    });

    it('refuses the edge that closes a cycle through a diamond', () => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(createBus);
      a.pipe(b);
      a.pipe(c);
      b.pipe(d);
      c.pipe(d);

      d.pipe(a);
      d.pipe(b);
      d.pipe(c);

      expect(cycleRecords().length).toBe(3);
    });

    it('refuses the edge that closes a very long chain without overflowing the stack', () => {
      const chain = Array.from({length: 1500}, (_, i) => createBus(`bus${i}`));
      for(let i = 1; i < chain.length; i++) {
        chain[i - 1].pipe(chain[i]);
      }
      records.length = 0;

      chain[chain.length - 1].pipe(chain[0]);

      expect(cycleRecords().length).toBe(1);
    });
  });

  describe('given graphs that are not cycles', () => {
    it('allows a diamond, and relays through it', () => {
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(createBus);
      const heard: string[] = [];
      d.on('foo', (payload) => heard.push(payload));
      a.pipe(b);
      a.pipe(c);
      // unfiltered bridges block passthrough, so relay needs a filter on each outbound edge
      b.pipe(Strongbus.ASSUMED_SOUND_EDGE).pipe(d);
      c.pipe(Strongbus.ASSUMED_SOUND_EDGE).pipe(d);

      a.emit('foo', 'x');

      expect(cycleRecords()).toEqual([]);
      expect(heard.length).toBe(2);
      expect(a.getListenerCount()).toBe(1);
    });

    it('does not complain about piping the same edge twice, or a bus into itself', () => {
      const [a, b] = ['a', 'b'].map(createBus);
      a.pipe(b);

      expect(a.pipe(b)).toBe(b);
      expect(a.pipe(a)).toBe(a);

      expect(cycleRecords()).toEqual([]);
    });

  });
});
