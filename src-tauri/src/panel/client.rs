//! Bare HTTP client for the panel: origin + `/api/v1`, envelope unwrap,
//! flat-error mapping, rate-limit awareness. Auth/token logic lives in
//! `auth.rs` — this layer just takes an optional bearer per call.

use std::time::Duration;

use reqwest::{Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::error::PanelError;
use super::models::{Envelope, ErrorBody, PageMeta};

pub const DEFAULT_ORIGIN: &str = "https://api.refx.gg";

#[derive(Clone)]
pub struct PanelClient {
    http: Client,
    /// e.g. `https://api.refx.gg` — no trailing slash.
    origin: String,
    /// e.g. `https://api.refx.gg/api/v1` — no trailing slash.
    base: String,
}

impl PanelClient {
    /// `origin` is scheme+host, e.g. `https://api.refx.gg`. HTTPS is
    /// required except for localhost (local compose stack in dev).
    pub fn new(origin: &str) -> Result<Self, PanelError> {
        let origin = origin.trim_end_matches('/');
        let url = reqwest::Url::parse(origin)
            .map_err(|e| PanelError::Other(format!("bad panel origin: {e}")))?;
        let is_local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
        if url.scheme() != "https" && !is_local {
            return Err(PanelError::Other(
                "panel origin must be https".into(),
            ));
        }
        let http = Client::builder()
            .user_agent(format!(
                "ReFxDesktop/{} (Windows NT; x64)",
                env!("CARGO_PKG_VERSION")
            ))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .https_only(!is_local)
            .build()?;
        Ok(Self {
            http,
            origin: origin.to_string(),
            base: format!("{origin}/api/v1"),
        })
    }

    /// Panel origin (scheme+host), for building the console websocket URL.
    pub fn origin(&self) -> &str {
        &self.origin
    }

    pub fn from_env() -> Result<Self, PanelError> {
        let origin =
            std::env::var("REFX_API_ORIGIN").unwrap_or_else(|_| DEFAULT_ORIGIN.to_string());
        Self::new(&origin)
    }

    /// JSON request → envelope-unwrapped `data`.
    pub async fn json<T, B>(
        &self,
        method: Method,
        path: &str,
        bearer: Option<&str>,
        body: Option<&B>,
    ) -> Result<T, PanelError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        self.json_with_meta(method, path, bearer, body)
            .await
            .map(|(data, _)| data)
    }

    /// Like [`Self::json`] but also returns the pagination `meta` block
    /// (present only on paginated responses).
    pub async fn json_with_meta<T, B>(
        &self,
        method: Method,
        path: &str,
        bearer: Option<&str>,
        body: Option<&B>,
    ) -> Result<(T, Option<PageMeta>), PanelError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let res = self.send(method, path, bearer, body).await?;
        let status = res.status();
        let text = res.text().await?;
        let env: Envelope<T> = serde_json::from_str(&text)
            .map_err(|e| PanelError::Decode(format!("{status} {path}: {e}")))?;
        let data = env
            .data
            .ok_or_else(|| PanelError::Decode(format!("{status} {path}: envelope had no data")))?;
        Ok((data, env.meta))
    }

    /// Request where success is a bodyless 2xx (e.g. logout → 204).
    pub async fn no_content<B>(
        &self,
        method: Method,
        path: &str,
        bearer: Option<&str>,
        body: Option<&B>,
    ) -> Result<(), PanelError>
    where
        B: Serialize + ?Sized,
    {
        self.send(method, path, bearer, body).await.map(|_| ())
    }

    async fn send<B>(
        &self,
        method: Method,
        path: &str,
        bearer: Option<&str>,
        body: Option<&B>,
    ) -> Result<Response, PanelError>
    where
        B: Serialize + ?Sized,
    {
        debug_assert!(path.starts_with('/'));
        let mut req = self.http.request(method, format!("{}{}", self.base, path));
        if let Some(token) = bearer {
            req = req.bearer_auth(token);
        }
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await?;
        if res.status().is_success() {
            return Ok(res);
        }
        Err(Self::map_error(res).await)
    }

    /// Map a non-2xx response to a PanelError using the flat error body
    /// (`{ statusCode, error, message, path, timestamp, code? }`).
    async fn map_error(res: Response) -> PanelError {
        let status = res.status();
        let retry_after = res
            .headers()
            .get("retry-after")
            .or_else(|| res.headers().get("x-ratelimit-reset"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        let body: ErrorBody = match res.text().await {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => ErrorBody::default(),
        };
        let message = body.message.joined();

        // The panel's global exception filter rebuilds every error body and
        // DROPS interceptor-added fields like `code` — the real
        // password-change 403 is `{ error: "ForbiddenException", message:
        // "Password change required" }`. Match the message; keep the `code`
        // check as belt-and-braces in case the filter changes.
        if body.code.as_deref() == Some("PASSWORD_CHANGE_REQUIRED")
            || (status == StatusCode::FORBIDDEN
                && message.eq_ignore_ascii_case("password change required"))
        {
            return PanelError::PasswordChangeRequired;
        }
        match status {
            StatusCode::UNAUTHORIZED => PanelError::Unauthorized { message },
            StatusCode::FORBIDDEN => PanelError::Forbidden { message },
            StatusCode::NOT_FOUND => PanelError::NotFound { message },
            StatusCode::BAD_REQUEST | StatusCode::UNPROCESSABLE_ENTITY => PanelError::Validation {
                messages: body.message.list(),
            },
            StatusCode::CONFLICT => PanelError::Conflict { message },
            StatusCode::TOO_MANY_REQUESTS => PanelError::RateLimited {
                retry_after_secs: retry_after,
            },
            s if s.is_server_error() => PanelError::Server {
                status: s.as_u16(),
                message,
            },
            s => PanelError::Server {
                status: s.as_u16(),
                message,
            },
        }
    }
}
