export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,9}$/;

/** Returns an error message, or null when valid. */
export function validatePrefix(prefix: string): string | null {
  return PREFIX_RE.test(prefix) ? null : "Use 1-10 uppercase letters/digits, starting with a letter.";
}

/** Strip surrounding slashes and whitespace; collapse repeated slashes. */
export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

/** Returns an error message, or null when valid. Expects a normalized folder. */
export function validateFolder(folder: string): string | null {
  if (folder.length === 0) return "Folder is required.";
  if (/[:*?"<>|]/.test(folder)) return 'Folder cannot contain : * ? " < > |';
  if (folder.split("/").some((s) => s.trim() === "" || s === "." || s === "..")) {
    return "Folder has an invalid path segment.";
  }
  if (folder.split("/")[0] === ".obsidian") return "Folder cannot be inside .obsidian.";
  return null;
}
