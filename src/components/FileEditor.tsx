import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";

function languageFor(name: string): Extension[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".json")) return [json()];
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return [yaml()];
  return [];
}

/** Imperative handle the parent uses on save. */
export type EditorApi = {
  /** Current buffer text. */
  get: () => string;
  /** Reset the dirty baseline to the current buffer (call after a save). */
  markSaved: () => void;
};

type Props = {
  name: string;
  initial: string;
  onChange: (dirty: boolean) => void;
  bindApi: (api: EditorApi) => void;
};

/** A CodeMirror 6 editor. Built ONCE per opened file (keyed only on the file
 * identity) — callbacks are held in refs so parent re-renders never rebuild
 * the view and drop keystrokes. Dirty is tracked against a mutable baseline
 * so save/undo behave correctly. */
export default function FileEditor({ name, initial, onChange, bindApi }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  const bindApiRef = useRef(bindApi);
  onChangeRef.current = onChange;
  bindApiRef.current = bindApi;

  useEffect(() => {
    if (!host.current) return;
    let baseline = initial;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        ...languageFor(name),
        oneDark,
        EditorView.theme({
          "&": { height: "100%", fontSize: "13px" },
          ".cm-scroller": { fontFamily: '"Cascadia Code", "Consolas", monospace' },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString() !== baseline);
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    bindApiRef.current({
      get: () => view.state.doc.toString(),
      markSaved: () => {
        baseline = view.state.doc.toString();
        onChangeRef.current(false);
      },
    });
    return () => view.destroy();
    // Rebuild only when the opened file changes — NOT on callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, initial]);

  return <div ref={host} className="h-full overflow-hidden rounded border border-white/[0.06]" />;
}
