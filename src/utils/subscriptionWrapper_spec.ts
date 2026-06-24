import {subscriptionWrapper} from './subscriptionWrapper';

describe('subscriptionWrapper', () => {
  it('invokes the dispose callback when the subscription is called directly', () => {
    const dispose = jasmine.createSpy('dispose');
    const sub = subscriptionWrapper(dispose);

    sub();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('invokes the dispose callback when .unsubscribe() is called', () => {
    const dispose = jasmine.createSpy('dispose');
    const sub = subscriptionWrapper(dispose);

    sub.unsubscribe();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('aliases .unsubscribe to the dispose callback', () => {
    const dispose = jasmine.createSpy('dispose');
    const sub = subscriptionWrapper(dispose);

    expect(sub.unsubscribe).toBe(dispose);
  });

  it('returns the value produced by the dispose callback', () => {
    const dispose = jasmine.createSpy('dispose').and.returnValue('disposed');
    const sub = subscriptionWrapper(dispose);

    expect(sub() as unknown).toBe('disposed');
  });

  it('does not dedupe invocations itself; dispose runs once per call', () => {
    const dispose = jasmine.createSpy('dispose');
    const sub = subscriptionWrapper(dispose);

    sub();
    sub();
    sub.unsubscribe();

    expect(dispose).toHaveBeenCalledTimes(3);
  });
});
