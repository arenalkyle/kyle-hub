import type { EditorView } from "@codemirror/view";
import { memo, useRef, useState } from "react";
import { humanizeEvent, type EventIcon } from "../../../../../core/domain/activity";
import { relativeTime } from "../../../../../core/domain/time";
import type { ActivityEvent, Comment, FeedEntry } from "../../../../../core/domain/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/icons";
import { Markdown } from "../components/Markdown";
import { MarkdownEditor } from "./MarkdownEditor";

const PAGE = 50;
const EVENT_ICON: Record<EventIcon, string> = {
  create: "plus-circle", status: "circle-dot", priority: "signal", assignee: "user",
  label: "tag", link: "link", calendar: "calendar", edit: "pencil", other: "dot",
};

export interface CommentActions {
  onReply: (parentId: string, body: string) => Promise<void>;
  onEdit: (commentId: string, body: string) => Promise<void>;
}

type Item =
  | { kind: "event"; entry: ActivityEvent; key: string }
  | { kind: "thread"; root: Comment; replies: Comment[]; key: string };

/** Top-level comments with their replies attached; events stay in file order. Orphan replies show top-level. */
function buildItems(feed: readonly FeedEntry[]): Item[] {
  const ids = new Set(feed.flatMap((f) => (f.type === "comment" ? [f.id] : [])));
  const threads = new Map<string, Comment[]>();
  const items: Item[] = [];
  feed.forEach((f, i) => {
    if (f.type === "event") {
      items.push({ kind: "event", entry: f, key: `e${i}` });
    } else if (f.replyTo && f.replyTo !== f.id && ids.has(f.replyTo)) {
      const list = threads.get(f.replyTo) ?? [];
      list.push(f);
      threads.set(f.replyTo, list);
    } else {
      items.push({ kind: "thread", root: f, replies: [], key: f.id });
    }
  });
  for (const it of items) if (it.kind === "thread") it.replies = threads.get(it.root.id) ?? [];
  return items;
}

/** Inline Markdown composer (reply / edit); the editor mounts once so focus survives re-renders. */
function InlineComposer({ initial, placeholder, submitLabel, onSubmit, onCancel }: {
  initial: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const view = useRef<EditorView | null>(null);
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async (body: string) => {
    if (busy || body.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit(body);
      onCancel();
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="kh-tickets-comment-composer">
      <MarkdownEditor
        viewRef={view}
        value={initial}
        placeholder={placeholder}
        autoFocus
        onChange={setText}
        onSubmit={(b) => void submit(b)}
        onCancel={onCancel}
      />
      <div className="kh-tickets-comment-actions">
        <span className="kh-tickets-comment-hint">Ctrl+Enter to save, Esc to cancel</span>
        <button type="button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="mod-cta"
          disabled={busy || text.trim() === ""}
          onClick={() => void submit(view.current?.state.doc.toString() ?? text)}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

const CommentView = memo(function CommentView({ c, sourcePath, now, actions, canReply }: {
  c: Comment;
  sourcePath: string;
  now: number;
  actions: CommentActions;
  canReply: boolean;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "reply">("view");
  const rel = relativeTime(c.time, new Date(now)) ?? c.time;
  return (
    <div className={`kh-tickets-comment${c.replyTo ? " kh-tickets-comment-reply" : ""}`}>
      <div className="kh-tickets-comment-head">
        <Avatar name={c.author} className="kh-tickets-comment-avatar" />
        <span className="kh-tickets-comment-author">{c.author}</span>
        <span className="kh-tickets-comment-time" title={c.time}>{rel}</span>
        {c.edited && <span className="kh-tickets-comment-edited" title="This comment was edited">(edited)</span>}
        {mode === "view" && (
          <span className="kh-tickets-comment-tools">
            <button type="button" className="kh-tickets-link-btn" onClick={() => setMode("edit")}>Edit</button>
          </span>
        )}
      </div>
      {mode === "edit" ? (
        <InlineComposer
          initial={c.body}
          placeholder="Edit comment…"
          submitLabel="Save"
          onSubmit={(b) => actions.onEdit(c.id, b)}
          onCancel={() => setMode("view")}
        />
      ) : (
        c.body !== "" && <Markdown md={c.body} sourcePath={sourcePath} className="kh-tickets-comment-body" />
      )}
      {canReply && mode === "view" && (
        <button type="button" className="kh-tickets-link-btn kh-tickets-comment-reply-btn" onClick={() => setMode("reply")}>Reply</button>
      )}
      {mode === "reply" && (
        <InlineComposer
          initial=""
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={(b) => actions.onReply(c.id, b)}
          onCancel={() => setMode("view")}
        />
      )}
    </div>
  );
});

const EventView = memo(function EventView({ entry, now }: { entry: ActivityEvent; now: number }) {
  const rel = relativeTime(entry.time, new Date(now)) ?? entry.time;
  const h = humanizeEvent(entry.text);
  return (
    <div className="kh-tickets-event">
      <span className="kh-tickets-event-icon"><Icon name={EVENT_ICON[h.icon]} size={12} /></span>
      <span className="kh-tickets-event-text">@{entry.author} {h.phrase}</span>
      <span className="kh-tickets-event-time" title={entry.time}>· {rel}</span>
    </div>
  );
});

/** Chronological feed; only the newest `PAGE * n` top-level items are mounted so 200+ entries stay cheap. */
export function ActivityFeed({ feed, sourcePath, actions }: { feed: readonly FeedEntry[]; sourcePath: string; actions: CommentActions }) {
  const [shown, setShown] = useState(PAGE);
  const now = Math.floor(Date.now() / 60000) * 60000;
  const items = buildItems(feed);
  const start = Math.max(0, items.length - shown);
  return (
    <section className="kh-tickets-activity">
      <h3 className="kh-tickets-section-title">Activity</h3>
      {start > 0 && (
        <button type="button" className="kh-tickets-link-btn" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, start)} earlier ({start} hidden)
        </button>
      )}
      {items.slice(start).map((it) =>
        it.kind === "event" ? (
          <EventView key={it.key} entry={it.entry} now={now} />
        ) : (
          <div className="kh-tickets-thread" key={it.key}>
            <CommentView c={it.root} sourcePath={sourcePath} now={now} actions={actions} canReply />
            {it.replies.length > 0 && (
              <div className="kh-tickets-thread-replies">
                {it.replies.map((r) => (
                  <CommentView key={r.id} c={r} sourcePath={sourcePath} now={now} actions={actions} canReply={false} />
                ))}
              </div>
            )}
          </div>
        ),
      )}
    </section>
  );
}
