import { Menu, Notice } from "obsidian";
import { useRef, useState, type ReactNode } from "react";
import { projectViewId } from "../../core/query";
import { PROJECT_STATUS_LABELS, issueInProject, projectProgress, validateProjectName } from "../../core/projects";
import type { Project, ProjectStatus } from "../../core/types";
import { ColorInput } from "../../settings/ColorInput";
import { confirmModal, withProgressNotice } from "../../settings/modals";
import { useIssues, useProjects, useSettings, useStoreReady } from "../../store/hooks";
import type { ProjectPatch } from "../../store/IssueStore";
import { usePlugin } from "../PluginContext";
import { Icon, ProjectGlyph, ProjectStatusIcon } from "../components/icons";
import { DatePicker } from "../components/pickers/DatePicker";
import { ProjectIconPicker } from "../components/pickers/ProjectIconPicker";
import { ProjectStatusPicker } from "../components/pickers/ProjectStatusPicker";
import { Description } from "../issue/Description";
import { TitleEditor } from "../issue/TitleEditor";
import { IssueCollection } from "../main/IssueCollection";
import { useViewState } from "../main/useViewState";
import { Milestones } from "./Milestones";

export const DEFAULT_PROJECT_COLOR = "#5e6ad2";

export interface ProjectPageProps {
  name: string;
  /** Called as soon as a rename starts (and again with the old name if it fails), so hosts can follow the project. */
  onRenamed: (name: string) => void;
  /** Called after the project was deleted. */
  onDeleted: () => void;
  /** Extra controls at the left of the header (e.g. sidebar toggle). */
  headerLeft?: ReactNode;
  /** Extra items for the "..." menu. */
  extraMenu?: (menu: Menu) => void;
}

function LeadEditor({ value, onSave }: { value: string | undefined; onSave: (v: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null) {
    return (
      <button type="button" className="kt-prop-btn" onClick={() => setDraft(value ?? "")}>
        <Icon name="user" />
        <span>{value ? value : "Lead"}</span>
      </button>
    );
  }
  const commit = () => {
    const v = draft.trim();
    setDraft(null);
    if (v !== (value ?? "")) onSave(v === "" ? null : v);
  };
  return (
    <input
      autoFocus
      className="kt-project-lead-input"
      value={draft}
      placeholder="Lead"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

export function ProjectPage({ name, onRenamed, onDeleted, headerLeft, extraMenu }: ProjectPageProps) {
  const plugin = usePlugin();
  const projects = useProjects();
  const issues = useIssues();
  const settings = useSettings();
  const ready = useStoreReady();
  const [open, setOpen] = useState<{ kind: "status" | "due" | "icon"; anchor: HTMLElement } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const project: Project | undefined = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  // Shared by the Milestones section (click-to-filter) and the issue collection below it.
  const viewKey = projectViewId(project?.name ?? name);
  const viewState = useViewState(viewKey);

  if (!project) {
    return (
      <div className="kt-project kt-issue-state" ref={root}>
        {ready ? <div>This project no longer exists</div> : <div>Loading...</div>}
      </div>
    );
  }

  const fail = (what: string) => (e: unknown) => {
    console.error(`kyle-tickets: ${what} failed`, e);
    new Notice(`Could not ${what}${e instanceof Error ? `: ${e.message}` : "."}`);
  };
  const update = (patch: ProjectPatch) => void plugin.store.updateProject(project.name, patch).catch(fail("save the project"));
  const progress = projectProgress(issues, project.name, settings.statuses);
  const pct = Math.round(progress.ratio * 100);

  const rename = (next: string) => {
    const err = validateProjectName(next, projects.map((p) => p.name), project.name);
    if (err) {
      new Notice(err);
      return;
    }
    if (next.trim() === project.name) return;
    const old = project.name;
    onRenamed(next.trim());
    void withProgressNotice("renaming project", (onProgress) => plugin.store.renameProject(old, next, { onProgress })).catch((e) => {
      onRenamed(old);
      fail("rename the project")(e);
    });
  };

  const remove = async () => {
    const count = issues.filter((i) => issueInProject(i, project.name)).length;
    const ok = await confirmModal(
      plugin.app,
      "Delete project",
      `Delete project "${project.name}"? The file is moved to trash${count > 0 ? ` and ${count} issue${count === 1 ? "" : "s"} will be removed from it` : ""}.`,
      "Delete",
      true,
    );
    if (!ok) return;
    try {
      await withProgressNotice("clearing project", (onProgress) => plugin.store.deleteProject(project.name, { onProgress }));
      onDeleted();
    } catch (e) {
      fail("delete the project")(e);
    }
  };

  const path = plugin.store.pathOfProject(project.name) ?? "";
  const copyLink = () => {
    if (!path) return;
    const url = `obsidian://open?vault=${encodeURIComponent(plugin.app.vault.getName())}&file=${encodeURIComponent(path)}`;
    void navigator.clipboard.writeText(url).then(() => new Notice("Copied link"));
  };
  const close = () => setOpen(null);

  return (
    <div className="kt-project" ref={root}>
      <div className="kt-header kt-issue-header">
        {headerLeft}
        <nav className="kt-crumbs" aria-label="Breadcrumb">
          <span className="kt-crumb">Projects</span>
          <span className="kt-crumb-sep">›</span>
          <span className="kt-crumb is-current">{project.name}</span>
        </nav>
        <span className="kt-spacer" />
        <button
          type="button"
          className="clickable-icon"
          title="More"
          aria-label="More"
          onClick={(e) => {
            const m = new Menu();
            m.addItem((i) => i.setTitle("Copy link").setIcon("link").onClick(copyLink));
            extraMenu?.(m);
            m.addItem((i) => i.setTitle("Delete project").setIcon("trash").setWarning(true).onClick(() => void remove()));
            m.showAtMouseEvent(e.nativeEvent);
          }}
        >
          <Icon name="more-horizontal" size={16} />
        </button>
      </div>
      <div className="kt-issue-body">
        <div className="kt-issue-main">
          <div className="kt-issue-column">
            <div className="kt-project-title">
              <button
                type="button"
                className="kt-project-icon-btn"
                title="Change icon"
                onClick={(e) => setOpen({ kind: "icon", anchor: e.currentTarget })}
              >
                <ProjectGlyph icon={project.icon} color={project.color ?? DEFAULT_PROJECT_COLOR} size={26} />
              </button>
              <TitleEditor title={project.name} onSave={rename} extraClass="kt-project-name" />
            </div>
            <div className="kt-project-props">
              <button type="button" className="kt-prop-btn" onClick={(e) => setOpen({ kind: "status", anchor: e.currentTarget })}>
                <ProjectStatusIcon status={project.status} />
                <span>{PROJECT_STATUS_LABELS[project.status]}</span>
              </button>
              <LeadEditor value={project.lead} onSave={(lead) => update({ lead })} />
              <button type="button" className="kt-prop-btn" onClick={(e) => setOpen({ kind: "due", anchor: e.currentTarget })}>
                <Icon name="calendar" />
                <span>{project.target ?? "Target date"}</span>
              </button>
              <label className="kt-prop-btn kt-project-color" title="Color">
                <Icon name="palette" />
                <ColorInput value={project.color ?? DEFAULT_PROJECT_COLOR} title="Project color" onCommit={(color) => update({ color })} />
              </label>
            </div>
            <div className="kt-project-progress" title={`${progress.done} of ${progress.total} issues done`}>
              <div className="kt-progress-bar">
                <div className="kt-progress-fill" style={{ width: `${pct}%`, background: project.color ?? DEFAULT_PROJECT_COLOR }} />
              </div>
              <span className="kt-progress-text">
                {progress.done} / {progress.total} issues done{progress.total > 0 ? ` · ${pct}%` : ""}
              </span>
            </div>
            <Description
              description={project.description}
              sourcePath={path}
              onSave={(md) => update({ description: md.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "") })}
            />
            <Milestones project={project} color={project.color ?? DEFAULT_PROJECT_COLOR} filters={viewState.filters} onFiltersChange={viewState.setFilters} />
          </div>
          <div className="kt-project-issues">
            <IssueCollection scope={viewKey} viewKey={viewKey} title="Issues" project={project.name} embedded viewState={viewState} />
          </div>
        </div>
      </div>
      {open?.kind === "status" && (
        <ProjectStatusPicker anchor={open.anchor} value={project.status} onChange={(status: ProjectStatus) => update({ status })} onClose={close} />
      )}
      {open?.kind === "due" && <DatePicker anchor={open.anchor} value={project.target} onChange={(t) => update({ target: t ?? null })} onClose={close} />}
      {open?.kind === "icon" && (
        <ProjectIconPicker anchor={open.anchor} value={project.icon} color={project.color} onChange={(icon) => update({ icon: icon ?? null })} onClose={close} />
      )}
    </div>
  );
}
