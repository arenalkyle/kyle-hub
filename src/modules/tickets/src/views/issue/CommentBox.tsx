import type { EditorView } from "@codemirror/view";
import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useSettings } from "../../store/hooks";
import { MarkdownEditor } from "./MarkdownEditor";

export function CommentBox({ onPost }: { onPost: (body: string) => Promise<void> }) {
  const view = useRef<EditorView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const settings = useSettings();

  const post = async (body: string) => {
    if (busy || body.trim() === "") return;
    setBusy(true);
    try {
      await onPost(body);
      const v = view.current;
      v?.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kh-tickets-comment-box">
      <Avatar name={settings.displayName} className="kh-tickets-comment-avatar" />
      <div className="kh-tickets-comment-box-main">
        <MarkdownEditor viewRef={view} value="" placeholder="Leave a comment…" onChange={setText} onSubmit={(b) => void post(b)} />
        <div className="kh-tickets-comment-actions">
          <span className="kh-tickets-comment-hint">Ctrl+Enter to post</span>
          <button type="button" className="mod-cta" disabled={busy || text.trim() === ""} onClick={() => void post(view.current?.state.doc.toString() ?? "")}>
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
