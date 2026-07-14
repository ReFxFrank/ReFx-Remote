import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** How often to poll for updates while the app is running (6h). */
export const UPDATE_POLL_MS = 6 * 60 * 60 * 1000;

export type DownloadProgress = { downloaded: number; total: number | null };

/**
 * Check the configured updater endpoint. Returns the pending `Update` (whose
 * signature the plugin has already verified against the baked-in pubkey) or
 * null when we're already current. Throws only on a genuine transport/parse
 * failure — callers decide whether that's worth surfacing.
 */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}

/**
 * Download + install a verified update, reporting byte progress, then relaunch
 * into the new version. Tauri applies the update on top of the current install;
 * a tampered or unsigned artifact is rejected by `check()`/`downloadAndInstall`
 * before anything is written.
 */
export async function installUpdate(
  update: Update,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total: number | null = null;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? null;
        onProgress({ downloaded: 0, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress({ downloaded, total });
        break;
      case "Finished":
        onProgress({ downloaded: total ?? downloaded, total });
        break;
    }
  });
  await relaunch();
}
