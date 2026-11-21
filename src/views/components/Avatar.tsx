import { useState, useSyncExternalStore } from "react";
import { getGhLogin, subscribeGhLogin } from "../../github/login";
import { useSettings } from "../../store/hooks";

export const CLAUDE_ORANGE = "#D97757";

export function isClaudeAuthor(name: string): boolean {
  return name.trim().replace(/^@/, "").toLowerCase() === "claude";
}

/** Claude spark: uneven rays radiating from the centre, as [angle in degrees, length]. */
const CLAUDE_RAYS: readonly (readonly [number, number])[] = [
  [0, 10], [33, 8.5], [62, 10], [95, 9], [128, 10], [160, 8], [190, 10], [222, 9], [252, 10], [285, 8.5], [318, 9.5],
];

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <g fill={CLAUDE_ORANGE}>
        {CLAUDE_RAYS.map(([angle, length], i) => (
          <rect key={i} x={11} y={12 - length} width={2} height={length} rx={1} transform={`rotate(${angle} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

/** Author avatar: Claude mark for `@claude`, GitHub picture for the user's own name, initial otherwise. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const settings = useSettings();
  const login = useSyncExternalStore(subscribeGhLogin, getGhLogin);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const base = `kt-avatar${className ? ` ${className}` : ""}`;

  if (isClaudeAuthor(name)) {
    return <span className={`${base} kt-avatar-claude`} title="Claude"><ClaudeMark /></span>;
  }
  const who = name.trim().replace(/^@/, "").toLowerCase();
  const isSelf = login !== undefined && (who === settings.displayName.trim().toLowerCase() || (!!login && who === login.toLowerCase()));
  const url = isSelf && login ? `https://github.com/${encodeURIComponent(login)}.png?size=64` : null;
  if (url && url !== failedUrl) {
    return (
      <span className={`${base} kt-avatar-img`} title={name}>
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      </span>
    );
  }
  return <span className={base} title={name}>{name.charAt(0).toUpperCase()}</span>;
}
