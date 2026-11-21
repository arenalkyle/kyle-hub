import { Modal, Notice, TFile } from "obsidian";
import { StrictMode, useEffect, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PRIORITY_LABELS } from "../core/defaults";
import { fromLink } from "../core/links";
import type { Priority } from "../core/types";
import type KyleTicketsPlugin from "../main";
import { PluginContext, usePlugin } from "./PluginContext";
import { Dot, Icon, PriorityIcon, StatusIcon } from "./components/icons";
import { PickerContainerContext } from "./components/Picker";
import { AssigneePicker } from "./components/pickers/AssigneePicker";
import { DatePicker } from "./components/pickers/DatePicker";
import { IssuePicker } from "./components/pickers/IssuePicker";
import { LabelPicker } from "./components/pickers/LabelPicker";
import { MilestonePicker } from "./components/pickers/MilestonePicker";
import { PriorityPicker } from "./components/pickers/PriorityPicker";
import { ProjectPicker } from "./components/pickers/ProjectPicker";
import { StatusPicker } from "./components/pickers/StatusPicker";

export interface NewIssueDefaults {
  status?: string;
  project?: string;
  parent?: string;
  priority?: Priority;
  assignee?: string;
  labels?: string[];
  milestone?: string;
}

type PickerKind = "status" | "priority" | "assignee" | "labels" | "project" | "milestone" | "due" | "parent";

function PropButton(props: {
  kind: PickerKind;
  label: string;
  icon: ReactNode;
  active: boolean;
  disabled?: boolean;
  onOpen: (kind: PickerKind, el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className={`kt-prop-btn${props.active ? " is-active" : ""}`}
      disabled={props.disabled}
      onClick={(e) => props.onOpen(props.kind, e.currentTarget)}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

function NewIssueForm({ defaults, close }: { defaults: NewIssueDefaults; close: () => void }) {
  const plugin = usePlugin();
  const { store, data } = plugin;
  const { settings } = data;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState(defaults.status ?? settings.defaultStatus);
  const [priority, setPriority] = useState<Priority>(defaults.priority ?? "none");
  const [assignee, setAssignee] = useState<string | undefined>(defaults.assignee);
  const [labels, setLabels] = useState<string[]>(defaults.labels ?? []);
  const [project, setProject] = useState<string | undefined>(defaults.project);
  const [milestone, setMilestone] = useState<string | undefined>(defaults.milestone);
  const [due, setDue] = useState<string | undefined>();
  const [parent, setParent] = useState<string | undefined>(defaults.parent);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ kind: PickerKind; anchor: HTMLElement } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  const statusDef = settings.statuses.find((s) => s.name === status);
  const closePicker = () => setOpen(null);
  const openPicker = (kind: PickerKind, anchor: HTMLElement) =>
    setOpen((o) => (o?.kind === kind ? null : { kind, anchor }));

  const create = async () => {
    const t = title.trim();
    if (!t) {
      new Notice("Give the issue a title first.");
      titleRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const issue = await store.createIssue({
        title: t,
        description,
        status,
        priority,
        assignee,
        tags: labels,
        project,
        milestone: project ? milestone : undefined,
        due,
        parent,
      });
      const frag = document.createDocumentFragment();
      frag.append(`Created ${issue.id} `);
      const a = document.createElement("a");
      a.textContent = "Open";
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const path = store.pathOf(issue.id);
        const f = path ? plugin.app.vault.getAbstractFileByPath(path) : null;
        if (f instanceof TFile) void plugin.app.workspace.getLeaf(false).openFile(f);
      });
      frag.append(a);
      new Notice(frag, 8000);
      if (more) {
        setTitle("");
        setDescription("");
        titleRef.current?.focus();
      } else {
        close();
      }
    } catch (err) {
      new Notice(`Could not create issue: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const isOpen = (k: PickerKind) => open?.kind === k;
  const anchor = open?.anchor ?? null;
  const tagColor = (l: string) => settings.labelColors[l] ?? "var(--text-faint)";

  return (
    <div
      className="kt-new-issue"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void create();
        }
      }}
    >
      <input
        ref={titleRef}
        className="kt-new-title"
        placeholder="Issue title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="kt-new-desc"
        placeholder="Add description..."
        rows={6}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="kt-prop-row">
        <PropButton
          kind="status"
          label={status}
          active={isOpen("status")}
          onOpen={openPicker}
          icon={<StatusIcon category={statusDef?.category ?? "backlog"} color={statusDef?.color} />}
        />
        <PropButton
          kind="priority"
          label={priority === "none" ? "Priority" : PRIORITY_LABELS[priority]}
          active={isOpen("priority")}
          onOpen={openPicker}
          icon={<PriorityIcon priority={priority} />}
        />
        <PropButton
          kind="assignee"
          label={assignee ?? "Assignee"}
          active={isOpen("assignee")}
          onOpen={openPicker}
          icon={<Icon name="user" />}
        />
        <PropButton
          kind="labels"
          label={labels.length === 0 ? "Labels" : labels.length === 1 ? labels[0]! : `${labels.length} labels`}
          active={isOpen("labels")}
          onOpen={openPicker}
          icon={labels.length ? <Dot color={tagColor(labels[0]!)} /> : <Icon name="tag" />}
        />
        <PropButton
          kind="project"
          label={project ? fromLink(project) : "Project"}
          active={isOpen("project")}
          onOpen={openPicker}
          icon={<Icon name="box" />}
        />
        <PropButton
          kind="milestone"
          label={milestone ?? "Milestone"}
          active={isOpen("milestone")}
          disabled={!project}
          onOpen={openPicker}
          icon={<Icon name="milestone" />}
        />
        <PropButton
          kind="due"
          label={due ?? "Due date"}
          active={isOpen("due")}
          onOpen={openPicker}
          icon={<Icon name="calendar" />}
        />
        <PropButton
          kind="parent"
          label={parent ?? "Parent issue"}
          active={isOpen("parent")}
          onOpen={openPicker}
          icon={<Icon name="git-branch" />}
        />
      </div>
      <div className="kt-new-footer">
        <label className="kt-more">
          <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
          <span>Create more</span>
        </label>
        <button type="button" className="mod-cta" disabled={busy} onClick={() => void create()}>
          Create issue
        </button>
      </div>

      {open?.kind === "status" && (
        <StatusPicker anchor={anchor} value={status} onChange={setStatus} onClose={closePicker} />
      )}
      {open?.kind === "priority" && (
        <PriorityPicker anchor={anchor} value={priority} onChange={setPriority} onClose={closePicker} />
      )}
      {open?.kind === "assignee" && (
        <AssigneePicker anchor={anchor} value={assignee} onChange={setAssignee} onClose={closePicker} />
      )}
      {open?.kind === "labels" && (
        <LabelPicker anchor={anchor} value={labels} onChange={setLabels} onClose={closePicker} />
      )}
      {open?.kind === "project" && (
        <ProjectPicker
          anchor={anchor}
          value={project}
          onChange={(p) => {
            setProject(p);
            setMilestone(undefined);
          }}
          onClose={closePicker}
        />
      )}
      {open?.kind === "milestone" && (
        <MilestonePicker anchor={anchor} project={project} value={milestone} onChange={setMilestone} onClose={closePicker} />
      )}
      {open?.kind === "due" && <DatePicker anchor={anchor} value={due} onChange={setDue} onClose={closePicker} />}
      {open?.kind === "parent" && (
        <IssuePicker anchor={anchor} value={parent} onChange={setParent} onClose={closePicker} placeholder="Set parent issue..." />
      )}
    </div>
  );
}

export class NewIssueModal extends Modal {
  private root: Root | null = null;

  constructor(private readonly plugin: KyleTicketsPlugin, private readonly defaults: NewIssueDefaults = {}) {
    super(plugin.app);
  }

  override onOpen(): void {
    this.modalEl.addClass("kt-new-issue-modal");
    this.titleEl.setText("New issue");
    this.contentEl.addClass("kt-root");
    this.root = createRoot(this.contentEl);
    this.root.render(
      <StrictMode>
        <PluginContext.Provider value={this.plugin}>
          <PickerContainerContext.Provider value={this.containerEl}>
            <NewIssueForm defaults={this.defaults} close={() => this.close()} />
          </PickerContainerContext.Provider>
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
