export type AnyFn = (...args: unknown[]) => unknown;

/**
 * Minimal monkey-around: wraps `obj[key]`. The returned uninstaller restores the original when our
 * wrapper is still on top; otherwise (someone wrapped after us) the wrapper stays in the chain but
 * becomes a pure pass-through to `old`.
 */
export function around(obj: Record<string, unknown>, key: string, wrap: (old: AnyFn) => AnyFn): () => void {
  const old = obj[key] as AnyFn;
  let active = true;
  const inner = wrap(old);
  const wrapped: AnyFn = function (this: unknown, ...args: unknown[]) {
    return (active ? inner : old).apply(this, args);
  };
  obj[key] = wrapped;
  return () => {
    active = false;
    if (obj[key] === wrapped) obj[key] = old;
  };
}
