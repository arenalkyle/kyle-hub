# One plugin; modules talk only through core services and the event bus

kyle-tickets and kyle-term are merged into one plugin, `kyle-hub`, with modules core, tickets, term, brain, command-center. Modules import only `core`; cross-module calls go through typed service interfaces (`hub.services.get("tickets")`, which returns `undefined` when that module is off) and a typed event bus. An ESLint `no-restricted-imports` rule enforces it in CI. command-center is read-only.

## Considered Options
- Direct module imports: simplest, but toggling a module off would break its importers.
- Event bus only: too indirect for request/response calls such as "create ticket".
