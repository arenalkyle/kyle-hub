import { memo, useState } from "react";
import { humanizeEvent, type EventIcon } from "../../core/activity";
import { relativeTime } from "../../core/time";
import type { FeedEntry } from "../../core/types";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/icons";
import { Markdown } from "../components/Markdown";

const PAGE = 50;
const EVENT_ICON: Record<EventIcon, string> = {
  create: "plus-circle", status: "circle-dot", priority: "signal", assignee: "user",
  label: "tag", link: "link", calendar: "calendar", edit: "pencil", other: "dot",
};

const Entry = memo(function Entry({ entry, sourcePath, now }: { entry: FeedEntry; sourcePath: string; now: number }) {
  const rel = relativeTime(entry.time, new Date(now)) ?? entry.time;
  if (entry.type === "event") {
    const h = humanizeEvent(entry.text);
    return (
      <div className="kt-event">
        <span className="kt-event-icon"><Icon name={EVENT_ICON[h.icon]} size={12} /></span>
        <span className="kt-event-text">@{entry.author} {h.phrase}</span>
        <span className="kt-event-time" title={entry.time}>· {rel}</span>
      </div>
    );
  }
  return (
    <div className="kt-comment">
      <div className="kt-comment-head">
        <Avatar name={entry.author} className="kt-comment-avatar" />
        <span className="kt-comment-author">{entry.author}</span>
        <span className="kt-comment-time" title={entry.time}>{rel}</span>
      </div>
      {entry.body !== "" && <Markdown md={entry.body} sourcePath={sourcePath} className="kt-comment-body" />}
    </div>
  );
});

/** Chronological feed; only the newest `PAGE * n` entries are mounted so 200+ entries stay cheap. */
export function ActivityFeed({ feed, sourcePath }: { feed: readonly FeedEntry[]; sourcePath: string }) {
  const [shown, setShown] = useState(PAGE);
  const now = Math.floor(Date.now() / 60000) * 60000;
  const start = Math.max(0, feed.length - shown);
  return (
    <section className="kt-activity">
      <h3 className="kt-section-title">Activity</h3>
      {start > 0 && (
        <button type="button" className="kt-link-btn" onClick={() => setShown((n) => n + PAGE)}>
          Show {Math.min(PAGE, start)} earlier ({start} hidden)
        </button>
      )}
      {feed.slice(start).map((e, i) => (
        <Entry key={start + i} entry={e} sourcePath={sourcePath} now={now} />
      ))}
    </section>
  );
}
