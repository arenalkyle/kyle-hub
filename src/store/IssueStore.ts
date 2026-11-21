import type { App, EventRef, TAbstractFile, TFile } from "obsidian";
import { asLink, buildIssueText, buildProjectText, type NewIssueInput, type NewProjectInput } from "../core/create";
import { diffToEvents } from "../core/diff";
import { nextId } from "../core/ids";
import {
  appendComment,
  appendEvent,
  applyPatch,
  parseIssue,
  serializeIssue,
  type IssuePatch,
} from "../core/issueFile";
import { fromLink } from "../core/links";
import { parseProject, serializeProject } from "../core/projectFile";
import type { Issue, Milestone, Project, ProjectStatus } from "../core/types";
import type { PluginData } from "../data";

export const EXTERNAL_DEBOUNCE_MS = 500;
/** Bulk updates over more files than this show a progress notice. */
export const BULK_PROGRESS_THRESHOLD = 20;

export interface StoreHost {
  app: App;
  data: PluginData;
  savePluginData(): Promise<void>;
  registerEvent(ref: EventRef): void;
}

export interface MalformedFile {
  path: string;
  error: string;
}

export interface ProjectPatch {
  status?: ProjectStatus;
  lead?: string | null;
  target?: string | null;
  color?: string | null;
  icon?: string | null;
  milestones?: Milestone[];
  description?: string;
}

type Kind = "issue" | "project";
type Listener = () => void;

const isFile = (f: TAbstractFile | null): f is TFile => !!f && "stat" in f;

/**
 * The only module that reads/writes ticket and project files from the plugin.
 * Keeps an in-memory index live from vault events and appends activity events
 * for field changes (own writes) and for external frontmatter edits (debounced).
 */
export class IssueStore {
  private readonly issuesByPath = new Map<string, Issue>();
  private readonly pathById = new Map<string, string>();
  private readonly projectsByPath = new Map<string, Project>();
  private readonly pathByName = new Map<string, string>();
  /** Last state an event diff was taken against, per issue path. */
  private readonly snapshots = new Map<string, Issue>();
  /** Content the store just wrote, per path; used to ignore its own modify events. */
  private readonly expected = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly malformed = new Map<string, string>();
  private readonly listeners = new Set<Listener>();
  private issuesCache: readonly Issue[] | null = null;
  private projectsCache: readonly Project[] | null = null;
  private malformedCache: readonly MalformedFile[] | null = null;
  private started = false;
  private loaded = false;

  constructor(
    private readonly host: StoreHost,
    private readonly debounceMs: number = EXTERNAL_DEBOUNCE_MS,
  ) {}

  // ---- lifecycle -------------------------------------------------------

  /** Index the vault and register listeners. Call from `workspace.onLayoutReady`. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { vault, metadataCache } = this.host.app;
    const reg = (r: EventRef): void => this.host.registerEvent(r);
    reg(vault.on("create", (f) => this.onCreateOrModify(f)));
    reg(vault.on("modify", (f) => this.onCreateOrModify(f)));
    reg(vault.on("delete", (f) => this.onDelete(f.path)));
    reg(vault.on("rename", (f, old) => this.onRename(f, old)));
    reg(metadataCache.on("changed", (f) => this.onCreateOrModify(f)));
    await this.reload();
  }

  /** Drop and rebuild the whole index (e.g. after the folder setting changes). */
  async reload(): Promise<void> {
    this.issuesByPath.clear();
    this.pathById.clear();
    this.projectsByPath.clear();
    this.pathByName.clear();
    this.snapshots.clear();
    this.malformed.clear();
    this.issuesCache = this.projectsCache = this.malformedCache = null;
    for (const file of this.host.app.vault.getMarkdownFiles()) {
      if (this.kindOf(file.path)) await this.ingest(file, true);
    }
    this.loaded = true;
    this.emit();
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.listeners.clear();
  }

  // ---- reads -----------------------------------------------------------

  on(event: "change", cb: Listener): () => void {
    void event;
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** True once the first full index has finished. */
  isReady(): boolean {
    return this.loaded;
  }

  getIssues(): readonly Issue[] {
    return (this.issuesCache ??= [...this.issuesByPath.values()]);
  }

  getProjects(): readonly Project[] {
    return (this.projectsCache ??= [...this.projectsByPath.values()]);
  }

  getIssue(id: string): Issue | undefined {
    const p = this.pathById.get(id);
    return p === undefined ? undefined : this.issuesByPath.get(p);
  }

  getProject(name: string): Project | undefined {
    const p = this.pathByName.get(name);
    return p === undefined ? undefined : this.projectsByPath.get(p);
  }

  childrenOf(id: string): Issue[] {
    return this.getIssues().filter((i) => i.parent !== undefined && fromLink(i.parent) === id);
  }

  /** Vault path of an issue file, for opening it. */
  pathOf(id: string): string | undefined {
    return this.pathById.get(id);
  }

  getMalformed(): readonly MalformedFile[] {
    return (this.malformedCache ??= [...this.malformed].map(([path, error]) => ({ path, error })));
  }

  // ---- writes ----------------------------------------------------------

  async createIssue(input: NewIssueInput, author?: string): Promise<Issue> {
    const { vault } = this.host.app;
    const { settings } = this.host.data;
    const now = new Date();
    const who = author ?? settings.displayName;
    // Allocate synchronously so concurrent creates never share a number.
    const alloc = nextId(this.host.data.idCounter, this.pathById.keys(), settings.prefix);
    this.host.data.idCounter = alloc.counter;
    const fileName = `${alloc.id}.md`;
    const base = buildIssueText(alloc.id, input, settings.defaultStatus, now);
    const text = appendEvent(parseIssue(base, fileName), { author: who, text: "created the issue" }, now);
    const path = `${this.dir("Issues")}/${fileName}`;
    await this.ensureFolder(this.dir("Issues"));
    this.expected.set(path, text);
    await vault.create(path, text);
    await this.host.savePluginData();
    const issue = parseIssue(text, fileName);
    this.setIssue(path, issue, true);
    this.emit();
    return issue;
  }

  async updateIssue(id: string, patch: IssuePatch, author?: string): Promise<Issue> {
    const { path, file } = this.requireIssueFile(id);
    const now = new Date();
    const who = author ?? this.host.data.settings.displayName;
    const norm: IssuePatch = { ...patch };
    if (typeof norm.project === "string") norm.project = asLink(norm.project);
    if (typeof norm.parent === "string") norm.parent = asLink(norm.parent);
    let written = "";
    await this.host.app.vault.process(file, (text) => {
      const before = parseIssue(text, file.name);
      const after = applyPatch(before, norm, now);
      const events = diffToEvents(before, after, who, now);
      // No-op patch: leave the file untouched.
      if (events.length === 0 && serializeIssue({ ...after, updated: before.updated }) === text) {
        written = text;
        return text;
      }
      let out = serializeIssue(after);
      for (const e of events) out = appendEvent(parseIssue(out, file.name), { author: e.author, text: e.text }, now);
      this.expected.set(path, out);
      written = out;
      return out;
    });
    const issue = parseIssue(written, file.name);
    this.setIssue(path, issue, true);
    this.emit();
    return issue;
  }

  /**
   * Applies `patch` (or a per-issue patch) to every issue matching `predicate`, one file at a
   * time; each write logs its own activity event. Returns the number of issues written.
   * A failure aborts the rest and rethrows; already-written files stay written.
   */
  async bulkUpdate(
    predicate: (issue: Issue) => boolean,
    patch: IssuePatch | ((issue: Issue) => IssuePatch),
    opts: { author?: string; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<number> {
    const targets = this.getIssues().filter(predicate).map((i) => i.id);
    opts.onProgress?.(0, targets.length);
    let done = 0;
    for (const id of targets) {
      const current = this.getIssue(id);
      if (!current) continue;
      await this.updateIssue(id, typeof patch === "function" ? patch(current) : patch, opts.author);
      done++;
      opts.onProgress?.(done, targets.length);
    }
    return done;
  }

  async addComment(id: string, body: string, author?: string): Promise<Issue> {
    const { path, file } = this.requireIssueFile(id);
    const now = new Date();
    const who = author ?? this.host.data.settings.displayName;
    let written = "";
    await this.host.app.vault.process(file, (text) => {
      const bumped = applyPatch(parseIssue(text, file.name), {}, now);
      written = appendComment(bumped, { author: who, body }, now);
      this.expected.set(path, written);
      return written;
    });
    const issue = parseIssue(written, file.name);
    this.setIssue(path, issue, true);
    this.emit();
    return issue;
  }

  async deleteIssue(id: string): Promise<void> {
    const { path, file } = this.requireIssueFile(id);
    await this.host.app.fileManager.trashFile(file);
    this.onDelete(path);
  }

  async createProject(input: NewProjectInput): Promise<Project> {
    if (this.pathByName.has(input.name)) throw new Error(`Project "${input.name}" already exists`);
    const fileName = `${input.name.replace(/[\\/:*?"<>|]/g, "-").trim()}.md`;
    const path = `${this.dir("Projects")}/${fileName}`;
    const text = buildProjectText(input);
    await this.ensureFolder(this.dir("Projects"));
    this.expected.set(path, text);
    await this.host.app.vault.create(path, text);
    const project = parseProject(text, fileName);
    this.setProject(path, project);
    this.emit();
    return project;
  }

  async updateProject(name: string, patch: ProjectPatch): Promise<Project> {
    const path = this.pathByName.get(name);
    const file = path === undefined ? null : this.host.app.vault.getAbstractFileByPath(path);
    if (path === undefined || !isFile(file)) throw new Error(`Unknown project "${name}"`);
    let written = "";
    await this.host.app.vault.process(file, (text) => {
      const p = parseProject(text, file.name);
      const bag = p as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) {
        if (v !== undefined) bag[k] = v === null ? undefined : v;
      }
      written = serializeProject(p);
      this.expected.set(path, written);
      return written;
    });
    const project = parseProject(written, file.name);
    this.setProject(path, project);
    this.emit();
    return project;
  }

  // ---- vault events ----------------------------------------------------

  private onCreateOrModify(f: TAbstractFile): void {
    if (!isFile(f) || !this.kindOf(f.path)) return;
    void this.refresh(f);
  }

  private onDelete(path: string): void {
    const kind = this.kindOf(path);
    if (!kind) return;
    this.dropPath(path, kind);
    this.emit();
  }

  private onRename(f: TAbstractFile, oldPath: string): void {
    const oldKind = this.kindOf(oldPath);
    if (oldKind) {
      const snap = this.snapshots.get(oldPath);
      this.dropPath(oldPath, oldKind);
      if (snap && this.kindOf(f.path) === "issue") this.snapshots.set(f.path, snap);
    }
    if (isFile(f) && this.kindOf(f.path)) void this.refresh(f);
    else this.emit();
  }

  private async refresh(file: TFile): Promise<void> {
    const text = await this.host.app.vault.read(file);
    const own = this.expected.get(file.path) === text;
    if (own) this.expected.delete(file.path);
    await this.ingest(file, own, text);
    if (!own && this.kindOf(file.path) === "issue") this.schedule(file.path);
    this.emit();
  }

  private schedule(path: string): void {
    const t = this.timers.get(path);
    if (t) clearTimeout(t);
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        void this.diffExternal(path);
      }, this.debounceMs),
    );
  }

  /** Diff the file against the last snapshot and log the differences as events. */
  private async diffExternal(path: string): Promise<void> {
    const file = this.host.app.vault.getAbstractFileByPath(path);
    if (!isFile(file)) return;
    const text = await this.host.app.vault.read(file);
    let current: Issue;
    try {
      current = parseIssue(text, file.name);
    } catch {
      return; // already reported by ingest
    }
    const snap = this.snapshots.get(path);
    if (!snap) {
      this.snapshots.set(path, current);
      return;
    }
    const now = new Date();
    const attributed =
      current.updatedBy && (current.updated !== snap.updated || current.updatedBy !== snap.updatedBy)
        ? current.updatedBy
        : "external";
    const events = diffToEvents(snap, current, attributed, now);
    if (events.length === 0) {
      this.snapshots.set(path, current);
      return;
    }
    let written: string | null = null;
    await this.host.app.vault.process(file, (cur) => {
      if (cur !== text) return cur; // edited again meanwhile; its own modify event re-diffs
      let out = cur;
      for (const e of events) out = appendEvent(parseIssue(out, file.name), { author: e.author, text: e.text }, now);
      this.expected.set(path, out);
      written = out;
      return out;
    });
    if (written !== null) {
      this.setIssue(path, parseIssue(written, file.name), true);
      this.emit();
    }
  }

  // ---- index internals -------------------------------------------------

  private async ingest(file: TFile, snapshot: boolean, known?: string): Promise<void> {
    const kind = this.kindOf(file.path);
    if (!kind) return;
    const text = known ?? (await this.host.app.vault.read(file));
    if (text.trim() === "") return; // freshly created, content follows in a modify event
    try {
      if (kind === "issue") this.setIssue(file.path, parseIssue(text, file.name), snapshot);
      else this.setProject(file.path, parseProject(text, file.name));
      this.setMalformed(file.path, null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`kyle-tickets: skipping malformed file ${file.path}: ${msg}`);
      this.dropPath(file.path, kind);
      this.setMalformed(file.path, msg);
    }
  }

  private setIssue(path: string, issue: Issue, snapshot: boolean): void {
    const old = this.issuesByPath.get(path);
    if (old && old.id !== issue.id && this.pathById.get(old.id) === path) this.pathById.delete(old.id);
    this.issuesByPath.set(path, issue);
    this.pathById.set(issue.id, path);
    if (snapshot || !this.snapshots.has(path)) this.snapshots.set(path, issue);
    this.issuesCache = null;
  }

  private setProject(path: string, project: Project): void {
    const old = this.projectsByPath.get(path);
    if (old && old.name !== project.name && this.pathByName.get(old.name) === path) this.pathByName.delete(old.name);
    this.projectsByPath.set(path, project);
    this.pathByName.set(project.name, path);
    this.projectsCache = null;
  }

  private dropPath(path: string, kind: Kind): void {
    this.expected.delete(path);
    const t = this.timers.get(path);
    if (t) clearTimeout(t);
    this.timers.delete(path);
    if (kind === "issue") {
      const old = this.issuesByPath.get(path);
      if (old && this.pathById.get(old.id) === path) this.pathById.delete(old.id);
      this.issuesByPath.delete(path);
      this.snapshots.delete(path);
      this.issuesCache = null;
    } else {
      const old = this.projectsByPath.get(path);
      if (old && this.pathByName.get(old.name) === path) this.pathByName.delete(old.name);
      this.projectsByPath.delete(path);
      this.projectsCache = null;
    }
    this.setMalformed(path, null);
  }

  private setMalformed(path: string, error: string | null): void {
    if (error === null) {
      if (!this.malformed.delete(path)) return;
    } else {
      this.malformed.set(path, error);
    }
    this.malformedCache = null;
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  private root(): string {
    return this.host.data.settings.folder.replace(/^\/+|\/+$/g, "");
  }

  private dir(sub: "Issues" | "Projects"): string {
    return `${this.root()}/${sub}`;
  }

  private kindOf(path: string): Kind | null {
    for (const [sub, kind] of [["Issues", "issue"], ["Projects", "project"]] as const) {
      const prefix = `${this.dir(sub)}/`;
      if (path.startsWith(prefix) && path.endsWith(".md") && !path.slice(prefix.length).includes("/")) return kind;
    }
    return null;
  }

  private requireIssueFile(id: string): { path: string; file: TFile } {
    const path = this.pathById.get(id);
    const file = path === undefined ? null : this.host.app.vault.getAbstractFileByPath(path);
    if (path === undefined || !isFile(file)) throw new Error(`Unknown issue "${id}"`);
    return { path, file };
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!this.host.app.vault.getAbstractFileByPath(path)) await this.host.app.vault.createFolder(path);
  }
}
