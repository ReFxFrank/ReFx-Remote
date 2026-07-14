//! Native Windows passkey (WebAuthn) assertion via `webauthn.dll`.
//!
//! This is the ONLY module in the crate permitted to use `unsafe`. It exists
//! because a Tauri WebView cannot run `navigator.credentials.get()` for the
//! `refx.gg` relying party: the WebView's origin is `tauri.localhost`, and the
//! browser refuses to assert for a different registrable domain. So we call the
//! OS WebAuthn API directly and let the *app* claim origin `https://<rpId>`,
//! which the backend's `expectedOrigins` accepts (it always includes
//! `https://<rpId>`). No attestation or signature is verified here — the server
//! does that in `verifyAuthentication`; we only marshal the ceremony.
//!
//! Input is the backend's `PublicKeyCredentialRequestOptionsJSON`; output is a
//! `@simplewebauthn`-shaped `AuthenticationResponseJSON` value ready to POST to
//! `/auth/mfa/webauthn/login/verify`.
#![allow(unsafe_code)]

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use windows::core::PCWSTR;
use windows::Win32::Networking::WindowsWebServices::{
    WebAuthNAuthenticatorGetAssertion, WebAuthNFreeAssertion, WebAuthNGetErrorName,
    WEBAUTHN_AUTHENTICATOR_ATTACHMENT_ANY,
    WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS,
    WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_1, WEBAUTHN_CLIENT_DATA,
    WEBAUTHN_CLIENT_DATA_CURRENT_VERSION, WEBAUTHN_CREDENTIAL, WEBAUTHN_CREDENTIALS,
    WEBAUTHN_CREDENTIAL_CURRENT_VERSION, WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
    WEBAUTHN_HASH_ALGORITHM_SHA_256, WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
    WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED, WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
};
use windows::Win32::UI::WindowsAndMessaging::{GetDesktopWindow, GetForegroundWindow};

/// Why a passkey ceremony failed. Kept narrow so the caller can give the user
/// the right sentence (cancel is not an error worth alarming over).
#[derive(Debug)]
pub enum WebauthnError {
    /// The options JSON from the backend didn't parse, or a credential id
    /// wasn't valid base64url. A bug/protocol mismatch, not user error.
    BadOptions(String),
    /// The user dismissed the Windows Hello prompt.
    Cancelled,
    /// The OS ceremony failed for some other reason (no credential, timeout,
    /// hardware error). Carries the OS error name for diagnostics.
    Ceremony(String),
}

impl std::fmt::Display for WebauthnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebauthnError::BadOptions(m) => write!(f, "bad passkey options: {m}"),
            WebauthnError::Cancelled => write!(f, "passkey prompt cancelled"),
            WebauthnError::Ceremony(m) => write!(f, "passkey ceremony failed: {m}"),
        }
    }
}

/// A single entry of the backend's `allowCredentials`. We only need the id;
/// `type` and `transports` are advisory and the OS derives its own.
#[derive(Debug, Deserialize)]
struct AllowCredential {
    id: String,
}

/// The subset of `PublicKeyCredentialRequestOptionsJSON` we consume.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestOptions {
    /// base64url; passed through verbatim into clientDataJSON.challenge.
    challenge: String,
    #[serde(default)]
    timeout: Option<u32>,
    #[serde(default)]
    rp_id: Option<String>,
    #[serde(default)]
    allow_credentials: Vec<AllowCredential>,
    #[serde(default)]
    user_verification: Option<String>,
}

/// Run the native passkey assertion for the given request options and return an
/// `AuthenticationResponseJSON` value. Blocking (shows a modal OS dialog) — call
/// via `spawn_blocking`.
pub fn get_assertion(options_json: &str) -> Result<Value, WebauthnError> {
    let opts: RequestOptions = serde_json::from_str(options_json)
        .map_err(|e| WebauthnError::BadOptions(format!("options JSON: {e}")))?;

    // rpId is required; the origin we assert is derived from it. The backend's
    // expectedOrigins always contains `https://<rpId>`, so this is guaranteed
    // to match for any real (non-localhost) deployment.
    let rp_id = opts
        .rp_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| WebauthnError::BadOptions("options missing rpId".into()))?
        .to_string();
    let origin = format!("https://{rp_id}");
    let rp_wide = to_wide(&rp_id);

    // clientDataJSON. Built once: these exact bytes are both hashed by the OS
    // (over the WEBAUTHN_CLIENT_DATA) and echoed to the server, so key order is
    // irrelevant as long as the two uses agree. serde handles escaping.
    let client_data = serde_json::to_string(&json!({
        "type": "webauthn.get",
        "challenge": opts.challenge,
        "origin": origin,
        "crossOrigin": false,
    }))
    .map_err(|e| WebauthnError::BadOptions(format!("clientData: {e}")))?;
    let client_data_bytes = client_data.into_bytes();

    let client_data_struct = WEBAUTHN_CLIENT_DATA {
        dwVersion: WEBAUTHN_CLIENT_DATA_CURRENT_VERSION,
        cbClientDataJSON: client_data_bytes.len() as u32,
        pbClientDataJSON: client_data_bytes.as_ptr() as *mut u8,
        pwszHashAlgId: WEBAUTHN_HASH_ALGORITHM_SHA_256,
    };

    // allowCredentials → decoded id buffers. These Vecs must outlive the call:
    // the WEBAUTHN_CREDENTIAL structs below hold raw pointers into them.
    let mut id_bufs: Vec<Vec<u8>> = Vec::with_capacity(opts.allow_credentials.len());
    for c in &opts.allow_credentials {
        // Some encoders emit padded base64url; tolerate it.
        let bytes = URL_SAFE_NO_PAD
            .decode(c.id.trim_end_matches('='))
            .map_err(|e| WebauthnError::BadOptions(format!("allowCredentials id: {e}")))?;
        id_bufs.push(bytes);
    }
    let creds: Vec<WEBAUTHN_CREDENTIAL> = id_bufs
        .iter()
        .map(|b| WEBAUTHN_CREDENTIAL {
            dwVersion: WEBAUTHN_CREDENTIAL_CURRENT_VERSION,
            cbId: b.len() as u32,
            pbId: b.as_ptr() as *mut u8,
            pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
        })
        .collect();

    let uv = match opts.user_verification.as_deref() {
        Some("required") => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
        Some("discouraged") => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
        // "preferred" or anything unrecognised → preferred (the backend uses it
        // and verifies with requireUserVerification: false).
        _ => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED,
    };

    // The options struct has ~20 fields (large-blob, HMAC-secret, hybrid, …) we
    // don't use. It isn't `Default`, and it's `#[repr(C)]` all-POD, so a zeroed
    // value is valid (null pointers, zero counts); we set only the v1 fields the
    // API reads for `dwVersion == …_VERSION_1`.
    // SAFETY: every field is an integer, a pointer, a PCWSTR, or a POD sub-struct
    // — all of which have a valid all-zero representation.
    let mut get_opts: WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS =
        unsafe { core::mem::zeroed() };
    get_opts.dwVersion = WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_1;
    get_opts.dwTimeoutMilliseconds = opts.timeout.unwrap_or(60_000);
    get_opts.CredentialList = WEBAUTHN_CREDENTIALS {
        cCredentials: creds.len() as u32,
        pCredentials: if creds.is_empty() {
            core::ptr::null_mut()
        } else {
            creds.as_ptr() as *mut WEBAUTHN_CREDENTIAL
        },
    };
    get_opts.dwAuthenticatorAttachment = WEBAUTHN_AUTHENTICATOR_ATTACHMENT_ANY;
    get_opts.dwUserVerificationRequirement = uv;

    // The modal Hello dialog needs a parent window. Our window is foreground
    // (the user just clicked the button); fall back to the desktop if not.
    // SAFETY: both are argument-free getters with no preconditions.
    let hwnd = unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            GetDesktopWindow()
        } else {
            fg
        }
    };

    // SAFETY: every pointer handed to the API points at a buffer still live in
    // this scope (client_data_bytes, id_bufs/creds, rp_wide, get_opts). The OS
    // consumes them synchronously and returns a heap assertion we must free.
    let assertion_ptr = unsafe {
        WebAuthNAuthenticatorGetAssertion(
            hwnd,
            PCWSTR(rp_wide.as_ptr()),
            &client_data_struct,
            Some(&get_opts as *const WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS),
        )
    }
    .map_err(map_ceremony_error)?;

    if assertion_ptr.is_null() {
        return Err(WebauthnError::Ceremony("no assertion returned".into()));
    }

    // SAFETY: on Ok the pointer is a valid, OS-owned WEBAUTHN_ASSERTION. We copy
    // every referenced byte into owned base64url strings before freeing it, and
    // never read through the pointer afterwards.
    let response = unsafe {
        let a = &*assertion_ptr;
        let auth_data = slice_from(a.pbAuthenticatorData, a.cbAuthenticatorData);
        let signature = slice_from(a.pbSignature, a.cbSignature);
        let cred_id = slice_from(a.Credential.pbId, a.Credential.cbId);
        let user_id = slice_from(a.pbUserId, a.cbUserId);

        let mut inner = Map::new();
        inner.insert(
            "clientDataJSON".into(),
            Value::String(URL_SAFE_NO_PAD.encode(&client_data_bytes)),
        );
        inner.insert(
            "authenticatorData".into(),
            Value::String(URL_SAFE_NO_PAD.encode(auth_data)),
        );
        inner.insert(
            "signature".into(),
            Value::String(URL_SAFE_NO_PAD.encode(signature)),
        );
        // userHandle is optional; omit when the authenticator returns none.
        if !user_id.is_empty() {
            inner.insert(
                "userHandle".into(),
                Value::String(URL_SAFE_NO_PAD.encode(user_id)),
            );
        }

        let id_b64 = URL_SAFE_NO_PAD.encode(cred_id);
        let out = json!({
            "id": id_b64,
            "rawId": id_b64,
            "type": "public-key",
            "response": Value::Object(inner),
            "clientExtensionResults": {},
        });

        WebAuthNFreeAssertion(assertion_ptr);
        out
    };

    Ok(response)
}

/// UTF-16, null-terminated — the shape Win32 wide-string APIs expect.
fn to_wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Build a slice over an OS-owned buffer, tolerating the (len == 0, ptr == null)
/// case — `slice::from_raw_parts` requires a non-null pointer even for len 0.
///
/// SAFETY: caller guarantees `ptr` is valid for `len` bytes when `len > 0`.
unsafe fn slice_from<'a>(ptr: *const u8, len: u32) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        std::slice::from_raw_parts(ptr, len as usize)
    }
}

/// Map an `HRESULT` failure to a `WebauthnError`, singling out user-cancel so
/// the UI doesn't shout about it.
fn map_ceremony_error(e: windows::core::Error) -> WebauthnError {
    let hr = e.code();
    // Both codes mean "the user backed out": ERROR_CANCELLED wrapped as an
    // HRESULT, and the WebAuthn-specific NTE_USER_CANCELLED.
    const ERROR_CANCELLED_HR: i32 = 0x8007_04C7u32 as i32;
    const NTE_USER_CANCELLED: i32 = 0x8009_0036u32 as i32;
    if hr.0 == ERROR_CANCELLED_HR || hr.0 == NTE_USER_CANCELLED {
        return WebauthnError::Cancelled;
    }
    // SAFETY: WebAuthNGetErrorName returns a static, null-terminated wide string
    // owned by webauthn.dll; reading it to a String does not free or retain it.
    let name = unsafe {
        let p = WebAuthNGetErrorName(hr);
        p.to_string().unwrap_or_default()
    };
    let detail = if name.is_empty() { e.message() } else { name };
    WebauthnError::Ceremony(detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_options() {
        let json = r#"{"challenge":"abc123","rpId":"refx.gg","allowCredentials":[]}"#;
        let opts: RequestOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.challenge, "abc123");
        assert_eq!(opts.rp_id.as_deref(), Some("refx.gg"));
        assert!(opts.allow_credentials.is_empty());
        assert!(opts.user_verification.is_none());
        assert!(opts.timeout.is_none());
    }

    #[test]
    fn parses_full_options_camel_case() {
        let json = r#"{
            "challenge":"Y2hhbGxlbmdl",
            "timeout":60000,
            "rpId":"refx.gg",
            "userVerification":"preferred",
            "allowCredentials":[
                {"id":"AAEC","type":"public-key","transports":["internal"]},
                {"id":"AwQF","type":"public-key"}
            ]
        }"#;
        let opts: RequestOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.timeout, Some(60000));
        assert_eq!(opts.user_verification.as_deref(), Some("preferred"));
        assert_eq!(opts.allow_credentials.len(), 2);
        assert_eq!(opts.allow_credentials[0].id, "AAEC");
    }

    #[test]
    fn credential_ids_are_base64url_decodable() {
        // AAEC = [0,1,2], AwQF = [3,4,5] in base64url (no pad).
        assert_eq!(URL_SAFE_NO_PAD.decode("AAEC").unwrap(), vec![0, 1, 2]);
        assert_eq!(URL_SAFE_NO_PAD.decode("AwQF").unwrap(), vec![3, 4, 5]);
    }

    #[test]
    fn missing_challenge_is_rejected() {
        let json = r#"{"rpId":"refx.gg"}"#;
        assert!(serde_json::from_str::<RequestOptions>(json).is_err());
    }

    #[test]
    fn to_wide_is_null_terminated() {
        let w = to_wide("hi");
        assert_eq!(w, vec![b'h' as u16, b'i' as u16, 0]);
    }

    #[test]
    fn user_verification_maps_to_ordinals() {
        // Guard the constant values we branch on (backend sends these strings).
        assert_eq!(WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED, 1);
        assert_eq!(WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED, 2);
        assert_eq!(WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED, 3);
    }
}
