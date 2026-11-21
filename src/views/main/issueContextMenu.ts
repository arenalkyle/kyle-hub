import { Menu } from "obsidian";
import type { Issue, Settings } from "../../core/types";
import { buildIssueMenu, type MenuAction } from "./issueMenuModel";

/** Shows the issue context menu at the mouse position; `run` receives the chosen action. */
export function showIssueContextMenu(evt: MouseEvent, issue: Issue, settings: Settings, run: (action: MenuAction) => void): void {
  const menu = new Menu();
  for (const e of buildIssueMenu(issue, settings)) {
    if (e.type === "separator") menu.addSeparator();
    else if (e.type === "heading") menu.addItem((i) => i.setTitle(e.label).setIsLabel(true));
    else
      menu.addItem((i) => {
        i.setTitle(e.label).setIcon(e.icon).onClick(() => run(e.action));
        if (e.checked !== undefined) i.setChecked(e.checked);
        if (e.danger) i.setWarning(true);
      });
  }
  menu.showAtMouseEvent(evt);
}
