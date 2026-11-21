import type { EditorView } from "@codemirror/view";
import { useRef, useState } from "react";
import { MarkdownEditor } from "./MarkdownEditor";

export function CommentBox({ onPost }: { onPost: (body: string) => Promise<void> }) {
  const view = useRef<EditorView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="kt-comment-box">
      <MarkdownEditor viewRef={view} value="" placeholder="Leave a comment…" onChange={setText} onSubmit={(b) => void post(b)} />
      <div className="kt-comment-actions">
        <span className="kt-comment-hint">Ctrl+Enter to post</span>
        <button type="button" className="mod-cta" disabled={busy || text.trim() === ""} onClick={() => void post(view.current?.state.doc.toString() ?? "")}>
          Comment
        </button>
      </div>
    </div>
  );
}
