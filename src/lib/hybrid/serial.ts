// Runs calls to fn one at a time. Firebase AI Logic creates a new Chrome session per on-device call
// and destroys the previous one, so two overlapping calls would kill each other's session.
export function oneAtATime<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let last: Promise<unknown> = Promise.resolve();
  return (...args: A) => {
    const run = last.then(() => fn(...args));
    last = run.catch(() => undefined);
    return run;
  };
}
