/** Stub service interfaces; modules fill these in as they land (tickets 1.2, term 2.1, logs 4.x, brain 7.x). */
export interface TicketService {}
export interface SessionService {}
export interface LogService {}
export interface BrainService {}

/** Typed map of cross-module services. A module's service is absent while that module is off. */
export interface Services {
  tickets: TicketService;
  sessions: SessionService;
  logs: LogService;
  brain: BrainService;
}

export class ServiceRegistry {
  private impls = new Map<keyof Services, unknown>();

  register<K extends keyof Services>(key: K, impl: Services[K]): void {
    this.impls.set(key, impl);
  }

  get<K extends keyof Services>(key: K): Services[K] | undefined {
    return this.impls.get(key) as Services[K] | undefined;
  }

  unregister(key: keyof Services): void {
    this.impls.delete(key);
  }
}
