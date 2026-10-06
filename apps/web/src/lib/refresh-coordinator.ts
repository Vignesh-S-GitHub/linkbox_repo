/** Deduplicates refreshes and prevents an older response overwriting a local mutation. */
export class RefreshCoordinator<T> {
  private current: { controller: AbortController; promise: Promise<void> } | null = null;
  constructor(private readonly load: (signal: AbortSignal) => Promise<T>, private readonly apply: (result: T) => void,
    private readonly failed: () => void, private readonly settled: () => void) {}
  refresh(): Promise<void> {
    if (this.current) return this.current.promise;
    const controller = new AbortController();
    const flight = { controller, promise: Promise.resolve() };
    this.current = flight;
    flight.promise = Promise.resolve().then(() => this.load(controller.signal)).then(result => {
      if (this.current === flight && !controller.signal.aborted) this.apply(result);
    }).catch(() => { if (this.current === flight && !controller.signal.aborted) this.failed(); })
      .finally(() => { if (this.current === flight) { this.current = null; this.settled(); } });
    return flight.promise;
  }
  cancel() { this.current?.controller.abort(); this.current = null; }
}
