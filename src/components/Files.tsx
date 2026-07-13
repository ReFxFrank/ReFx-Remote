import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, errorMessage, type FileEntry } from "../lib/ipc";
import { fromMb } from "../lib/format";
import FileEditor, { type EditorApi } from "./FileEditor";

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

export default function Files({ serverId, canWrite }: { serverId: string; canWrite: boolean }) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [dirty, setDirty] = useState(false);
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

  async function newFolder() {
    const name = window.prompt("New folder name:");
    if (!name) return;
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

  async function rename(entry: FileEntry) {
    const to = window.prompt("Rename to:", entry.name);
    if (!to || to === entry.name) return;
    await run(async () => {
      const from = entry.path || joinPath(path, entry.name);
      await ipc.filesRename(serverId, from, joinPath(path, to));
      await load(path);
    });
  }

  async function remove(entry: FileEntry) {
    const p = entry.path || joinPath(path, entry.name);
    if (!window.confirm(`Delete "${entry.name}"? This can't be undone.`)) return;
    await run(async () => {
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-sm">
          <span className="truncate font-mono text-zinc-300">
            {editing.path}
            {dirty && <span className="ml-2 text-amber-400">●</span>}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void saveFile()}
              disabled={busy || !canWrite || !dirty}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={() => {
                if (dirty && !window.confirm("Discard unsaved changes?")) return;
                setEditing(null);
              }}
              className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-zinc-500"
            >
              Close
            </button>
          </div>
        </div>
        {error && <p className="border-b border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{error}</p>}
        <div className="min-h-0 flex-1">
          <FileEditor
            name={editing.name}
            initial={editing.content}
            onChange={setDirty}
            bindApi={(api) => (editorApi.current = api)}
          />
        </div>
      </div>
    );
  }

  // ── Browser view ─────────────────────────────────────────────────────────
  const segments = path === "/" ? [] : path.replace(/^\//, "").split("/");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1 text-xs text-zinc-400">
          <button onClick={() => setPath("/")} className="hover:text-zinc-200">
            /
          </button>
          {segments.map((seg, i) => {
            const to = "/" + segments.slice(0, i + 1).join("/");
            return (
              <span key={to} className="flex items-center gap-1">
                <span className="text-zinc-600">/</span>
                <button onClick={() => setPath(to)} className="truncate hover:text-zinc-200">
                  {seg}
                </button>
              </span>
            );
          })}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          {path !== "/" && (
            <button onClick={() => setPath(parentPath(path))} className="text-zinc-400 hover:text-zinc-200">
              ↑ Up
            </button>
          )}
          <button onClick={() => void load(path)} className="text-zinc-400 hover:text-zinc-200">
            Refresh
          </button>
          {canWrite && (
            <>
              <button onClick={() => void newFolder()} disabled={busy} className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40">
                New folder
              </button>
              <button onClick={() => void upload()} disabled={busy} className="rounded bg-zinc-700 px-2 py-1 text-zinc-100 hover:bg-zinc-600 disabled:opacity-40">
                Upload
              </button>
            </>
          )}
        </div>
      </div>

      {notice && <p className="border-b border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-emerald-300">{notice}</p>}
      {error && <p className="border-b border-red-900 bg-red-950/40 px-3 py-1.5 text-xs text-red-300">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-center text-sm text-zinc-500">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-zinc-500">This folder is empty.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {entries.map((e) => (
                <tr key={e.name} className="group border-b border-zinc-900 hover:bg-zinc-900/60">
                  <td className="w-full px-3 py-1.5">
                    <button
                      onClick={() => void openFile(e)}
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-zinc-500">{e.isDir ? "📁" : "📄"}</span>
                      <span className={e.isDir ? "text-zinc-200" : "text-zinc-300"}>{e.name}</span>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs text-zinc-500">
                    {e.isDir ? "" : fmtSize(e.size)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <span className="flex items-center justify-end gap-2 text-xs opacity-0 transition group-hover:opacity-100">
                      {!e.isDir && (
                        <button onClick={() => void download(e)} className="text-zinc-400 hover:text-zinc-200">
                          Download
                        </button>
                      )}
                      {canWrite && !e.isDir && ARCHIVE_RE.test(e.name) && (
                        <button onClick={() => void decompress(e)} className="text-zinc-400 hover:text-zinc-200">
                          Extract
                        </button>
                      )}
                      {canWrite && (
                        <button onClick={() => void rename(e)} className="text-zinc-400 hover:text-zinc-200">
                          Rename
                        </button>
                      )}
                      {canWrite && (
                        <button onClick={() => void remove(e)} className="text-red-400 hover:text-red-300">
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
    </div>
  );
}
