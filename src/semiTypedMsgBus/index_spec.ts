import SemiTypedMsgBus from './';

type TestEvents = 'A'|'B'|'C';

describe('SemiTypedMsgBus', () => {
  let bus: SemiTypedMsgBus<TestEvents>;
  let onSingleEvent: jasmine.Spy;
  let onAnyEvent: jasmine.Spy;

  beforeEach(() => {
    bus = new SemiTypedMsgBus<TestEvents>();
    onSingleEvent = jasmine.createSpy('onSingleEvent');
    onAnyEvent = jasmine.createSpy('onAnyEvent');
    onSingleEvent.calls.reset();
  });

  describe('#on', () => {
    describe('given it subscribes to a single event', () => {
      it('invokes the listener with the arguments emitted', () => {
        bus.on('A', onSingleEvent);
        bus.emit('A', 'some', 'args');
        expect(onSingleEvent).toHaveBeenCalledWith('some', 'args');
      });
    });

    describe('given it subscribes to a list of events', () => {
      describe('and given an event in the list is emitted', () => {
        it('it invokes the listener with no args', () => {
          bus.on(['A', 'B', 'C'], onSingleEvent);
          bus.emit('A', 'some', 'a', 'args');
          expect(onSingleEvent.calls.mostRecent().args.length).toEqual(0);

          onSingleEvent.calls.reset();
          bus.emit('B', 'some', 'b', 'args');
          expect(onSingleEvent.calls.mostRecent().args.length).toEqual(0);

          onSingleEvent.calls.reset();
          bus.emit('B', 'some', 'c', 'args');
          expect(onSingleEvent.calls.mostRecent().args.length).toEqual(0);
        });
      });
    });

    describe('given it subscribes to the splat operator', () => {
      it('it invokes the listener with no args when any event is emitted', () => {
        bus.on('*', onAnyEvent);
        bus.emit('A', 'some', 'a', 'args');
        expect(onAnyEvent.calls.mostRecent().args.length).toEqual(0);
      });
    });

    it('returns an unsusbscribe function', () => {
      const unsub = bus.on('A', onSingleEvent);
      expect(bus.hasListeners).toBeTruthy();

      unsub();

      expect(bus.hasListeners).toBeFalsy();
    });
  });

  describe('given an event is raised that has no listeners', () => {
    const mightThrow = (b: any) => () => b.emit('A', 'no', 'listeners');

    describe('given the instance was created with options.allowUnhandledEvents = false', () => {
      it('throws an error', () => {
        bus = new SemiTypedMsgBus<TestEvents>({allowUnhandledEvents: false});
        expect(mightThrow(bus)).toThrow();
      });
    });

    describe('given the instance was created with options.allowUnhandledEvents = true (default)', () => {
      it('does not throw an error', () => {
        expect(mightThrow(bus)).not.toThrow();
      });
    });
  });
});
