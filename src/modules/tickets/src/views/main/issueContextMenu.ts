import { Menu, type MenuItem as ObsidianMenuItem } from "obsidian";
import { createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { Issue, Settings } from "../../../../../core/domain/types";
import type KyleTicketsPlugin from "../../main";
import { Avatar } from "../components/Avatar";
import { PriorityIcon, StatusIcon } from "../components/icons";
import { PluginContext } from "../PluginContext";
import { buildIssueMenu, type MenuAction, type MenuIcon, type MenuItem } from "./issueMenuModel";

/** `MenuItem.setSubmenu` exists at runtime (Obsidian 1.4+) but is missing from the published typings. */
type WithSubmenu = ObsidianMenuItem & { setSubmenu(): Menu };

/** Replace the item's monochrome Lucide icon with the plugin's coloured icon (same components as the pickers). */
function applyIcon(item: ObsidianMenuItem, icon: MenuIcon, plugin: KyleTicketsPlugin, roots: Root[]): void {
  if (icon.kind === "lucide") {
    item.setIcon(icon.name);
    return;
  }
  item.setIcon("circle"); // creates the icon slot; contents are swapped below
  const slot = (item as unknown as { dom: HTMLElement }).dom.querySelector<HTMLElement>(".menu-item-icon");
  if (!slot) return;
  slot.empty();
  slot.addClass("kh-tickets-ctx-icon");
  if (icon.kind === "avatar") {
    const root = createRoot(slot);
    roots.push(root);
    root.render(createElement(StrictMode, null, createElement(PluginContext.Provider, { value: plugin }, createElement(Avatar, { name: icon.name }))));
  } else if (icon.kind === "status") {
    slot.innerHTML = renderToStaticMarkup(createElement(StatusIcon, { category: icon.category, color: icon.color }));
  } else {
    slot.innerHTML = renderToStaticMarkup(createElement(PriorityIcon, { priority: icon.priority }));
  }
}

/** Shows the issue context menu at the mouse position; `run` receives the chosen action. Status/Priority/Assignee open hover flyouts. */
export function showIssueContextMenu(
  evt: MouseEvent,
  issue: Issue,
  settings: Settings,
  plugin: KyleTicketsPlugin,
  assignees: string[],
  run: (action: MenuAction) => void,
): void {
  const roots: Root[] = [];
  const fill = (menu: Menu, e: MenuItem): void =>
    void menu.addItem((i) => {
      i.setTitle(e.label).onClick(() => run(e.action));
      applyIcon(i, e.icon, plugin, roots);
      if (e.checked !== undefined) i.setChecked(e.checked);
      if (e.danger) i.setWarning(true);
    });
  const menu = new Menu();
  for (const e of buildIssueMenu(issue, settings, assignees)) {
    if (e.type === "separator") menu.addSeparator();
    else if (e.type === "heading") menu.addItem((i) => i.setTitle(e.label).setIsLabel(true));
    else if (e.type === "item") fill(menu, e);
    else
      menu.addItem((i) => {
        i.setTitle(e.label);
        applyIcon(i, e.icon, plugin, roots);
        const sub = (i as WithSubmenu).setSubmenu();
        for (const c of e.children) fill(sub, c);
      });
  }
  menu.onHide(() => setTimeout(() => roots.forEach((r) => r.unmount()), 0));
  menu.showAtMouseEvent(evt);
}
