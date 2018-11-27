import TypedMsgBus from './';

type MessageA = {thing: string};
type MessageB = {thing: number};
type TestTypeMap = {
  A: MessageA;
  B: MessageB;
  C: string;
};

type HandlerA = (msg: MessageA) => void;

describe('TypedMsgBus', () => {
  let bus: TypedMsgBus<TestTypeMap>;

  beforeEach(() => {
    bus = new TypedMsgBus<TestTypeMap>();
  });

  describe('#on', () => {
    it('subscribes handler to an event as a key of its typemap', () => {
      const handleA = jasmine.createSpy('onEventA') as HandlerA;
      bus.on('A', handleA);

      bus.emit('A', {thing: 'thang'});

      expect(handleA).toHaveBeenCalledWith({thing: 'thang'});
    });

    it('returns an unsubscribe function', () => {
      const unsub = bus.on('A', () => { return; });
      expect(bus.hasListeners).toBeTruthy();

      unsub();
      expect(bus.hasListeners).toBeFalsy();
    });

    describe('given the splat operator to listen on', () => {
      describe('and given an event is raised', () => {
        it('invokes the supplied handler with no arguments', () => {
          const handleEvery = jasmine.createSpy('onEveryEvent');
          bus.on('*', handleEvery);
          bus.emit('A', {thing: 'flam'});
          expect(handleEvery).toHaveBeenCalledTimes(1);
          expect(handleEvery.calls.mostRecent().args.length).toBe(0);
          bus.emit('B', {thing: 1});
          expect(handleEvery).toHaveBeenCalledTimes(2);
          expect(handleEvery.calls.mostRecent().args.length).toBe(0);
        });
      });
    });

    describe('given a list of events to listen on', () => {
      let handleAny: jasmine.Spy;
      beforeEach(() => {
        handleAny = jasmine.createSpy('onAnyEvent');
        bus.on(['A', 'B'], handleAny);
      });
      describe('given one of the events in the list is raised', () => {
        it('invokes the supplied handler with no arguments ', () => {
          bus.emit('A', {thing: 'flam'});
          expect(handleAny).toHaveBeenCalledTimes(1);
          expect(handleAny.calls.mostRecent().args.length).toBe(0);
          bus.emit('B', {thing: 5});
          expect(handleAny).toHaveBeenCalledTimes(2);
          expect(handleAny.calls.mostRecent().args.length).toBe(0);
        });
      });

      describe('given an event not in the list is raised', () => {
        it('does not invoke the handler', () => {
          bus.emit('C', 'batman');
          expect(handleAny).toHaveBeenCalledTimes(0);
        });
      });
    });
  });

  describe('given an event is raised that has no listeners', () => {
    const mightThrow = (b: any) => () => b.emit('A', 'no', 'listeners');

    describe('given the instance was created with options.allowUnhandledEvents = true (default)', () => {
      it('throws an error', () => {
        expect(mightThrow(bus)).not.toThrow();
      });
    });

    describe('given the instance was created with options.allowUnhandledEvents = false', () => {
      it('does not throw an error', () => {
        bus = new TypedMsgBus<TestTypeMap>({allowUnhandledEvents: false});
        expect(mightThrow(bus)).toThrow();
      });
    });
  });
});
