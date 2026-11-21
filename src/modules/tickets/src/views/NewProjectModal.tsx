import { Modal, Notice } from "obsidian";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PROJECT_STATUS_LABELS, validateProjectName } from "../../../../core/domain/projects";
import type { ProjectStatus } from "../../../../core/domain/types";
import type KyleTicketsPlugin from "../main";
import { useProjects } from "../store/hooks";
import { PluginContext, usePlugin } from "./PluginContext";
import { Icon, ProjectGlyph, ProjectStatusIcon } from "./components/icons";
import { DatePicker } from "./components/pickers/DatePicker";
import { ProjectIconPicker } from "./components/pickers/ProjectIconPicker";
import { ProjectStatusPicker } from "./components/pickers/ProjectStatusPicker";
import { DEFAULT_PROJECT_COLOR } from "./project/ProjectPage";

type PickerKind = "icon" | "status" | "target";

function NewProjectForm({ close }: { close: () => void }) {
  const plugin = usePlugin();
  const projects = useProjects();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | undefined>();
  const [color, setColor] = useState(DEFAULT_PROJECT_COLOR);
  const [status, setStatus] = useState<ProjectStatus>("backlog");
  const [lead, setLead] = useState("");
  const [target, setTarget] = useState<string | undefined>();
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ kind: PickerKind; anchor: HTMLElement } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => nameRef.current?.focus(), []);

  const error = name.trim() === "" ? null : validateProjectName(name, projects.map((p) => p.name));
  const toggle = (kind: PickerKind, anchor: HTMLElement) => setOpen((o) => (o?.kind === kind ? null : { kind, anchor }));
  const closePicker = () => setOpen(null);

  const create = async () => {
    const err = validateProjectName(name, projects.map((p) => p.name));
    if (err) {
      new Notice(err);
      nameRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const p = await plugin.store.createProject({
        name: name.trim(),
        icon,
        color,
        status,
        lead: lead.trim() || undefined,
        target,
        description,
      });
      close();
      plugin.openProject(p.name);
    } catch (e) {
      new Notice(`Could not create project: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="kt-new-issue kt-new-project"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void create();
        }
      }}
    >
      <div className="kt-new-project-name">
        <button type="button" className="kt-project-icon-btn" title="Icon" onClick={(e) => toggle("icon", e.currentTarget)}>
          <ProjectGlyph icon={icon} color={color} size={22} />
        </button>
        <input
          ref={nameRef}
          className={`kt-new-title${error ? " kt-invalid" : ""}`}
          placeholder="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
              e.preventDefault();
              void create();
            }
          }}
        />
      </div>
      {error && <div className="kt-field-error">{error}</div>}
      <textarea className="kt-new-desc" placeholder="Add description…" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="kt-prop-row">
        <button type="button" className={`kt-prop-btn${open?.kind === "status" ? " is-active" : ""}`} onClick={(e) => toggle("status", e.currentTarget)}>
          <ProjectStatusIcon status={status} />
          <span>{PROJECT_STATUS_LABELS[status]}</span>
        </button>
        <label className="kt-prop-btn" title="Lead">
          <Icon name="user" />
          <input className="kt-project-lead-input" placeholder="Lead" value={lead} onChange={(e) => setLead(e.target.value)} />
        </label>
        <button type="button" className={`kt-prop-btn${open?.kind === "target" ? " is-active" : ""}`} onClick={(e) => toggle("target", e.currentTarget)}>
          <Icon name="calendar" />
          <span>{target ?? "Target date"}</span>
        </button>
        <label className="kt-prop-btn kt-project-color" title="Color">
          <Icon name="palette" />
          <input type="color" className="kt-set-color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
      </div>
      <div className="kt-new-footer">
        <span />
        <button type="button" className="mod-cta" disabled={busy} onClick={() => void create()}>
          Create project
        </button>
      </div>
      {open?.kind === "icon" && <ProjectIconPicker anchor={open.anchor} value={icon} color={color} onChange={setIcon} onClose={closePicker} />}
      {open?.kind === "status" && <ProjectStatusPicker anchor={open.anchor} value={status} onChange={setStatus} onClose={closePicker} />}
      {open?.kind === "target" && <DatePicker anchor={open.anchor} value={target} onChange={setTarget} onClose={closePicker} />}
    </div>
  );
}

export class NewProjectModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly plugin: KyleTicketsPlugin) {
    super(plugin.app);
  }

  override onOpen(): void {
    this.modalEl.addClass("kt-new-issue-modal");
    this.titleEl.setText("New project");
    this.contentEl.addClass("kt-root");
    this.root = createRoot(this.contentEl);
    this.root.render(
      <StrictMode>
        <PluginContext.Provider value={this.plugin}>
          <NewProjectForm close={() => this.close()} />
        </PluginContext.Provider>
      </StrictMode>,
    );
  }

  override onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }
}
