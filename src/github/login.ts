/** GitHub login reported by `gh auth status`, set once at startup so views never shell out per render. */
let login: string | undefined;
const listeners = new Set<() => void>();

export function getGhLogin(): string | undefined {
  return login;
}

export function setGhLogin(next: string | undefined): void {
  if (next === login) return;
  login = next;
  for (const l of [...listeners]) l();
}

export function subscribeGhLogin(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
