export interface TitleInputs {
  manual?: string;
  osc?: string;
  /** Phase 3 inserts the first prompt here (between terminal title and profile name). */
  firstPrompt?: string;
  profileName: string;
}

const clean = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/** Title priority: manual name > terminal (OSC) title > first prompt > profile name. */
export function resolveTitle(i: TitleInputs): string {
  return clean(i.manual) ?? clean(i.osc) ?? clean(i.firstPrompt) ?? i.profileName;
}

/** Compact "time since" label: 5s, 12m, 3h, 2d. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
