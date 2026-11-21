import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { useEffect, useRef } from "react";

export interface MarkdownEditorProps {
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  onChange?: (value: string) => void;
  /** Ctrl+Enter. */
  onSubmit?: (value: string) => void;
  /** Escape. */
  onCancel?: (value: string) => void;
  onBlur?: (value: string) => void;
  /** Receives the view so the owner can read or clear it. */
  viewRef?: { current: EditorView | null };
}

/** Reusable CodeMirror 6 Markdown editor, styled via `.kt-md-editor` and Obsidian variables. */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const text = (v: EditorView): string => v.state.doc.toString();
    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          cmPlaceholder(latest.current.placeholder ?? ""),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: (v) => {
                  latest.current.onSubmit?.(text(v));
                  return true;
                },
              },
              {
                key: "Escape",
                run: (v) => {
                  if (!latest.current.onCancel) return false;
                  latest.current.onCancel(text(v));
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange?.(text(u.view));
          }),
          EditorView.domEventHandlers({
            blur: (_e, v) => {
              latest.current.onBlur?.(text(v));
            },
          }),
        ],
      }),
    });
    const ref = latest.current.viewRef;
    if (ref) ref.current = view;
    if (latest.current.autoFocus) {
      view.focus();
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    }
    return () => {
      if (ref) ref.current = null;
      view.destroy();
    };
  }, []);

  return <div ref={host} className={`kt-md-editor ${props.className ?? ""}`} />;
}
