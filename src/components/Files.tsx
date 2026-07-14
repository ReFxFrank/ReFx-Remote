import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, errorMessage, type FileEntry } from "../lib/ipc";
import { fromMb } from "../lib/format";
import FileEditor, { type EditorApi } from "./FileEditor";
import { ConfirmDialog, PromptDialog } from "./Dialog";

const TEXT_EXT = new Set([
  "properties", "yml", "yaml", "json", "toml", "cfg", "conf", "txt", "log",
  "sh", "md", "ini", "xml", "env", "js", "ts", "html", "css", "sk", "lang",
]);
const EDIT_MAX = 2 * 1024 * 1024; // refuse to open very large files in the editor
const ARCHIVE_RE = /\.(zip|tar|tar\.gz|tgz|rar|7z)$/i;

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}
function isText(name: string): boolean {
  return TEXT_EXT.has(ext(name));
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return fromMb(bytes / 1024 / 1024);
}
function joinPath(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}
function parentPath(dir: string): string {
  if (dir === "/") return "/";
  const trimmed = dir.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

type Editing = { path: string; name: string; content: string };
type FileDialog =
  | { kind: "newFolder" }
  | { kind: "rename"; entry: FileEntry }
  | { kind: "delete"; entry: FileEntry }
  | { kind: "discard" };

export default function Files({ serverId, canWrite }: { serverId: string; canWrite: boolean }) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<FileDialog | null>(null);
  const editorApi = useRef<EditorApi | null>(null);
  // Monotonic id so an earlier, slower directory listing can't overwrite a
  // later one (out-of-order responses would render the wrong folder).
  const loadSeq = useRef(0);

  const load = useCallback(
    async (p: string) => {
      const seq = ++loadSeq.current;
      setLoading(true);
      setError(null);
      try {
        const list = await ipc.filesList(serverId, p);
        if (seq !== loadSeq.current) return; // superseded by a newer navigation
        list.sort(
          (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
        );
        setEntries(list);
      } catch (e) {
        if (seq === loadSeq.current) setError(errorMessage(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    },
    [serverId],
  );

  useEffect(() => {
    void load(path);
  }, [load, path]);

  // Reset to root when switching servers.
  useEffect(() => {
    setPath("/");
    setEditing(null);
  }, [serverId]);

  function flash(msg: string) {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 2500);
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openFile(entry: FileEntry) {
    if (entry.isDir) {
      setPath(entry.path || joinPath(path, entry.name));
      return;
    }
    if (!isText(entry.name) || entry.size > EDIT_MAX) {
      flash(
        entry.size > EDIT_MAX
          ? "That file is too large to edit here — download it instead."
          : "That looks like a binary file — download it instead.",
      );
      return;
    }
    await run(async () => {
      const p = entry.path || joinPath(path, entry.name);
      const content = await ipc.filesRead(serverId, p);
      setDirty(false);
      setEditing({ path: p, name: entry.name, content });
    });
  }

  async function saveFile() {
    if (!editing || !editorApi.current) return;
    await run(async () => {
      await ipc.filesWrite(serverId, editing.path, editorApi.current!.get());
      editorApi.current!.markSaved(); // reset the dirty baseline to what's on disk
      flash("Saved.");
    });
  }

  function newFolder() {
    setDialog({ kind: "newFolder" });
  }
  async function doNewFolder(name: string) {
    setDialog(null);
    await run(async () => {
      await ipc.filesMkdir(serverId, joinPath(path, name));
      await load(path);
    });
  }

  async function upload() {
    await run(async () => {
      const bytes = await ipc.filesUpload(serverId, path);
      if (bytes != null) {
        flash(`Uploaded ${fmtSize(bytes)}.`);
        await load(path);
      }
    });
  }

  async function download(entry: FileEntry) {
    await run(async () => {
      const saved = await ipc.filesDownload(
        serverId,
        entry.path || joinPath(path, entry.name),
        entry.name,
      );
      if (saved) flash("Downloaded.");
    });
  }

  function rename(entry: FileEntry) {
    setDialog({ kind: "rename", entry });
  }
  async function doRename(entry: FileEntry, to: string) {
    setDialog(null);
    if (to === entry.name) return;
    await run(async () => {
      const from = entry.path || joinPath(path, entry.name);
      await ipc.filesRename(serverId, from, joinPath(path, to));
      await load(path);
    });
  }

  function remove(entry: FileEntry) {
    setDialog({ kind: "delete", entry });
  }
  async function doRemove(entry: FileEntry) {
    setDialog(null);
    await run(async () => {
      const p = entry.path || joinPath(path, entry.name);
      await ipc.filesDelete(serverId, [p]);
      await load(path);
    });
  }

  async function decompress(entry: FileEntry) {
    await run(async () => {
      await ipc.filesDecompress(serverId, entry.path || joinPath(path, entry.name));
      await load(path);
      flash("Extracted.");
    });
  }

  // ── Editor view ────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[rgba(7,11,18,0.55)]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-sm">
          <span className="truncate font-mono text-foreground/85">
            {editing.path}
            {dirty && <span className="ml-2 text-warning">●</span>}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveFile()}
              disabled={busy || !canWrite || !dirty}
              className="rounded btn-primary px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => {
                if (dirty) setDialog({ kind: "discard" });
                else setEditing(null);
              }}
              className="rounded border border-white/10 px-3 py-1 text-xs text-foreground/85 hover:border-primary/50"
            >
              Close
            </button>
          </div>
        </div>
        {error && <p className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>}
        <div className="min-h-0 flex-1">
          <FileEditor
            name={editing.name}
            initial={editing.content}
            onChange={setDirty}
            bindApi={(api) => (editorApi.current = api)}
          />
        </div>
        {dialog?.kind === "discard" && (
          <ConfirmDialog
            title="Discard changes?"
            body="You have unsaved changes to this file. Close without saving?"
            confirmLabel="Discard"
            danger
            onConfirm={() => {
              setDialog(null);
              setEditing(null);
            }}
            onCancel={() => setDialog(null)}
          />
        )}
      </div>
    );
  }

  // ── Browser view ─────────────────────────────────────────────────────────
  const segments = path === "/" ? [] : path.replace(/^\//, "").split("/");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.06] bg-[rgba(7,11,18,0.55)]">
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <button onClick={() => setPath("/")} className="hover:text-foreground">
            /
          </button>
          {segments.map((seg, i) => {
            const to = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={to} className="flex items-center gap-1">
                <span className="text-muted-foreground/70">/</span>
                <button onClick={() => setPath(to)} className="truncate hover:text-foreground">
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {path !== "/" && (
            <button onClick={() => setPath(parentPath(path))} className="text-muted-foreground hover:text-foreground">
              ↑ Up
            </button>
          )}
          <button onClick={() => void load(path)} className="text-muted-foreground hover:text-foreground">
            Refresh
          </button>
          {canWrite && (
            <>
              <button onClick={() => void newFolder()} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                New folder
              </button>
              <button onClick={() => void upload()} disabled={busy} className="rounded btn-ghost px-2 py-1 disabled:opacity-40">
                Upload
              </button>
            </>
          )}
        </div>
      </div>

      {notice && <p className="border-b border-white/[0.06] bg-white/[0.03] px-3 py-1 text-xs text-success">{notice}</p>}
      {error && <p className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">This folder is empty.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {entries.map((e) => (
                <tr key={e.name} className="group border-b border-white/[0.05] hover:bg-white/[0.03]">
                  <td className="w-full px-3 py-1.5">
                    <button
                      onClick={() => void openFile(e)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-muted-foreground">{e.isDir ? "📁" : "📄"}</span>
                      <span className={e.isDir ? "text-foreground" : "text-foreground/85"}>{e.name}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-muted-foreground">
                    {e.isDir ? "" : fmtSize(e.size)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <span className="flex items-center justify-end gap-2 text-xs opacity-0 transition group-hover:opacity-100">
                      {!e.isDir && (
                        <button onClick={() => void download(e)} className="text-muted-foreground hover:text-foreground">
                          Download
                        </button>
                      )}
                      {canWrite && !e.isDir && ARCHIVE_RE.test(e.name) && (
                        <button onClick={() => void decompress(e)} className="text-muted-foreground hover:text-foreground">
                          Extract
                        </button>
                      )}
                      {canWrite && (
                        <button onClick={() => void rename(e)} className="text-muted-foreground hover:text-foreground">
                          Rename
                        </button>
                      )}
                      {canWrite && (
                        <button onClick={() => void remove(e)} className="text-destructive/80 hover:text-destructive">
                          Delete
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {dialog?.kind === "newFolder" && (
        <PromptDialog
          title="New folder"
          label="Folder name"
          confirmLabel="Create"
          onSubmit={(name) => void doNewFolder(name)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <PromptDialog
          title="Rename"
          label="New name"
          initialValue={dialog.entry.name}
          confirmLabel="Rename"
          onSubmit={(to) => void doRename(dialog.entry, to)}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.entry.name}?`}
          body="This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void doRemove(dialog.entry)}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
