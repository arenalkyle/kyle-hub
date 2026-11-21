import { useState, useSyncExternalStore } from "react";
import { getGhLogin, subscribeGhLogin } from "../../github/login";
import { useSettings } from "../../store/hooks";

export const CLAUDE_ORANGE = "#D97757";

export function isClaudeAuthor(name: string): boolean {
  return name.trim().replace(/^@/, "").toLowerCase() === "claude";
}

function ClaudeMark() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true" focusable="false">
      <path fill={CLAUDE_ORANGE} d="M12 1.5C12.7 7.6 16.4 11.3 22.5 12 16.4 12.7 12.7 16.4 12 22.5 11.3 16.4 7.6 12.7 1.5 12 7.6 11.3 11.3 7.6 12 1.5Z" />
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
  const isSelf = login !== undefined && name.trim().toLowerCase() === settings.displayName.trim().toLowerCase();
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
