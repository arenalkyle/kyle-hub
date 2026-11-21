import { Component, MarkdownRenderer } from "obsidian";
import { memo, useEffect, useRef } from "react";
import { usePlugin } from "../PluginContext";
import { linkIssueIds } from "../idLinks";

export interface MarkdownProps {
  md: string;
  sourcePath: string;
  className?: string;
}

/** Renders Markdown with Obsidian's renderer; the render Component lives and dies with the effect. */
export const Markdown = memo(function Markdown({ md, sourcePath, className }: MarkdownProps) {
  const plugin = usePlugin();
  const { app } = plugin;
  const prefix = plugin.data.settings.prefix;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const component = new Component();
    component.load();
    const holder = document.createElement("div");
    void MarkdownRenderer.render(app, md, holder, sourcePath, component).then(() => {
      if (cancelled) return;
      el.replaceChildren(...Array.from(holder.childNodes));
      linkIssueIds(el, prefix, (id) => plugin.store.pathOf(id) !== undefined);
    });
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
      if (href) void app.workspace.openLinkText(href, sourcePath, e.ctrlKey || e.metaKey);
    };
    el.addEventListener("click", onClick);
    return () => {
      cancelled = true;
      el.removeEventListener("click", onClick);
      component.unload();
      el.replaceChildren();
    };
  }, [app, plugin, md, sourcePath, prefix]);
  return <div ref={ref} className={`kt-md markdown-rendered ${className ?? ""}`} />;
});
