//! File manager domain (docs/recon/panel-api.md §6). All paths are
//! server-relative (start with `/`). The panel jails them agent-side.

use std::path::Path;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::auth::AuthManager;
use super::error::PanelError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub is_dir: bool,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub mode: Option<String>,
    /// Live wire field is `modified` (the recon's `modifiedAt` was wrong).
    #[serde(default)]
    pub modified: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedUrl {
    url: String,
}

fn enc(s: &str) -> String {
    urlencoding::encode(s).into_owned()
}

pub async fn list(auth: &AuthManager, id: &str, path: &str) -> Result<Vec<FileEntry>, PanelError> {
    auth.authed_json::<Vec<FileEntry>, ()>(
        Method::GET,
        &format!("/servers/{id}/files/list?path={}", enc(path)),
        None,
    )
    .await
}

pub async fn read(auth: &AuthManager, id: &str, path: &str) -> Result<String, PanelError> {
    // `/contents` returns the raw file text as the envelope `data` string
    // (verified live — the recon's `{ content }` shape was wrong).
    auth.authed_json::<String, ()>(
        Method::GET,
        &format!("/servers/{id}/files/contents?path={}", enc(path)),
        None,
    )
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WriteBody<'a> {
    path: &'a str,
    content: &'a str,
}

pub async fn write(auth: &AuthManager, id: &str, path: &str, content: &str) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/write"),
        Some(&WriteBody { path, content }),
    )
    .await
    .map(|_| ())
}

#[derive(Serialize)]
struct PathsBody<'a> {
    paths: &'a [String],
}

pub async fn delete(auth: &AuthManager, id: &str, paths: &[String]) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/delete"),
        Some(&PathsBody { paths }),
    )
    .await
    .map(|_| ())
}

#[derive(Serialize)]
struct RenameBody<'a> {
    from: &'a str,
    to: &'a str,
}

pub async fn rename(auth: &AuthManager, id: &str, from: &str, to: &str) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/rename"),
        Some(&RenameBody { from, to }),
    )
    .await
    .map(|_| ())
}

#[derive(Serialize)]
struct PathBody<'a> {
    path: &'a str,
}

pub async fn mkdir(auth: &AuthManager, id: &str, path: &str) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/mkdir"),
        Some(&PathBody { path }),
    )
    .await
    .map(|_| ())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CompressBody<'a> {
    paths: &'a [String],
    #[serde(skip_serializing_if = "Option::is_none")]
    destination: Option<&'a str>,
}

pub async fn compress(
    auth: &AuthManager,
    id: &str,
    paths: &[String],
    destination: Option<&str>,
) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/compress"),
        Some(&CompressBody { paths, destination }),
    )
    .await
    .map(|_| ())
}

pub async fn decompress(auth: &AuthManager, id: &str, path: &str) -> Result<(), PanelError> {
    auth.authed_json::<serde_json::Value, _>(
        Method::POST,
        &format!("/servers/{id}/files/decompress"),
        Some(&PathBody { path }),
    )
    .await
    .map(|_| ())
}

/// Download a file to `dest`. Resolves the panel's relative signed URL
/// (which lacks the `/api/v1` prefix) against the API base. Returns bytes.
pub async fn download(
    auth: &AuthManager,
    id: &str,
    path: &str,
    dest: &Path,
) -> Result<u64, PanelError> {
    let signed: SignedUrl = auth
        .authed_json::<SignedUrl, ()>(
            Method::GET,
            &format!("/servers/{id}/files/download-url?path={}", enc(path)),
            None,
        )
        .await?;
    let url = resolve_signed_url(auth.origin(), &signed.url);
    auth.download_to(&url, dest).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadResult {
    #[serde(default)]
    pub bytes: u64,
    #[serde(default)]
    pub path: String,
}

/// Upload a local file's bytes to `dest_dir` (a server directory). Enforced
/// ≤32 MiB by the client layer.
pub async fn upload(
    auth: &AuthManager,
    id: &str,
    dest_dir: &str,
    bytes: &[u8],
) -> Result<UploadResult, PanelError> {
    auth.upload_bytes(
        &format!("/servers/{id}/files/upload?path={}", enc(dest_dir)),
        bytes,
    )
    .await
}

/// The download-url endpoint returns either an absolute URL (S3) or a
/// panel-relative path WITHOUT the `/api/v1` prefix. Resolve accordingly.
fn resolve_signed_url(origin: &str, url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("{}/api/v1{}", origin.trim_end_matches('/'), url)
    }
}

#[cfg(test)]
mod tests {
    use super::resolve_signed_url;

    #[test]
    fn resolves_relative_signed_url_with_api_prefix() {
        assert_eq!(
            resolve_signed_url("https://api.refx.gg", "/servers/s1/files/download?path=%2Fx&exp=1&sig=a"),
            "https://api.refx.gg/api/v1/servers/s1/files/download?path=%2Fx&exp=1&sig=a"
        );
    }

    #[test]
    fn passes_absolute_url_through() {
        let s3 = "https://bucket.r2.example/obj?sig=z";
        assert_eq!(resolve_signed_url("https://api.refx.gg", s3), s3);
    }
}
