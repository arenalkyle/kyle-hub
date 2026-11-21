import { Notice, TFile, type App } from "obsidian";
import type { Issue } from "../core/types";
import type { IssueStore } from "../store/IssueStore";
import { confirmModal } from "../settings/modals";

/** obsidian:// URI that opens the issue's file. */
export function issueLinkUri(app: App, path: string): string {
  return `obsidian://open?vault=${encodeURIComponent(app.vault.getName())}&file=${encodeURIComponent(path)}`;
}

export function copyText(text: string, what: string): void {
  void navigator.clipboard.writeText(text).then(() => new Notice(`Copied ${what}`));
}

/** Confirms, then deletes the issue file (moved to trash). Resolves to true when deleted. */
export async function deleteIssueConfirmed(app: App, store: IssueStore, issue: Issue, path: string): Promise<boolean> {
  if (!(app.vault.getAbstractFileByPath(path) instanceof TFile)) return false;
  const ok = await confirmModal(app, "Delete issue", `Delete ${issue.id} "${issue.title}"? The file is moved to trash.`, "Delete", true);
  if (ok) await store.deleteIssue(issue.id);
  return ok;
}
