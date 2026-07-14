# Windows code signing (Authenticode) — runbook

This is the step-by-step for the one release task that's **account-gated and only you can do**: signing the installer so Windows SmartScreen stops warning customers on first install.

Everything in the repo is already staged for it — `release.yml` passes the `AZURE_*` secrets through to the build. What's missing is an Azure Trusted Signing account (yours), its identifiers, and one small config file. This doc is the walk-through.

---

## What signing does and doesn't do

- **Authenticode (this doc)** proves *who published the installer* to Windows. Without it, downloading `ReFx Desktop_x.y.z_x64-setup.exe` triggers a blue **SmartScreen "Windows protected your PC"** wall — the highest-friction moment for a paid product.
- **The updater's minisign signature** (already set up) is a *different* signature that proves an *update* came from us; the app verifies it before applying. Auto-update works today without Authenticode — but the initial download is flagged.

They're independent. You want both.

### ⚠️ The one gotcha that will bite you: sign *during* the bundle, not after

Tauri computes the updater's minisign signature **over the installer bytes as it bundles them**. If you Authenticode-sign the installer in a *later* CI step, you change those bytes, and the minisign signature no longer matches → **installed clients reject every auto-update.**

So signing must run **inside** the Tauri bundle step, via `bundle.windows.signCommand`. Tauri runs that command on each artifact *before* it computes the updater signature, so both signatures end up correct. The wiring below does exactly this. **Do not** add a standalone "sign the .exe" step to `release.yml`.

---

## Recommended path: Azure Trusted Signing

Why this over a traditional certificate: no physical USB token, works headless in CI, and it's ~**$9.99/month** instead of hundreds/year for an EV cert. Its certificates chain to a Microsoft public-trust root that SmartScreen recognizes.

> **Lead time:** the identity-validation step (below) can take a few business days, and Trusted Signing requires your account/tenant to be **more than 30 days old** for public-trust profiles. Start early — this is the longest pole.

### 1. Create the Trusted Signing account
1. In the [Azure Portal](https://portal.azure.com), create a **Resource Group** (e.g. `refx-signing`) in a supported region (e.g. *East US*).
2. Create a **Trusted Signing Account** resource in that group. Note its **name** and **endpoint URL** (region-specific, e.g. `https://eus.codesigning.azure.net/`).

### 2. Create a certificate profile (identity validation)
1. In the Trusted Signing account → **Certificate profiles** → **Create**.
2. Choose **Public Trust**, then complete **identity validation** — Individual (your legal name) or Organization (business docs). This is the multi-day step.
3. Note the **certificate profile name**. The **publisher/subject** on the issued cert must match `bundle.publisher` in `tauri.conf.json` — currently `"ReFx Hosting"`. If your validated identity differs, update `publisher` to match, or validation/signing will mismatch.

### 3. Create a service principal for CI
1. Entra ID → **App registrations** → **New registration** (e.g. `refx-desktop-signer`).
2. Copy the **Directory (tenant) ID** and **Application (client) ID**.
3. **Certificates & secrets** → **New client secret** → copy the **value** (shown once).
4. On the Trusted Signing **account** → **Access control (IAM)** → assign the role **“Trusted Signing Certificate Profile Signer”** to that app registration.

### 4. Add the repo secrets
`release.yml` already references these — Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_CLIENT_SECRET` | the client secret **value** |

> As with the updater key, **I can't set these for you** — add them yourself in the GitHub UI so the secret values never pass through a chat.

### 5. Wire the signing command (the only code change)

Keep `tauri.conf.json` unsigned so local `npm run tauri build` still works, and layer the signing config in **only for the release build**.

**a.** Add a new file `src-tauri/tauri.signing.conf.json` (fill in *your* endpoint/account/profile from steps 1–2):

```json
{
  "bundle": {
    "windows": {
      "signCommand": "trusted-signing-cli -e https://eus.codesigning.azure.net/ -a <ACCOUNT_NAME> -c <CERT_PROFILE_NAME> %1"
    }
  }
}
```

`trusted-signing-cli` reads `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` from the environment (already exported in `release.yml`). `%1` is the artifact path Tauri substitutes per file.

**b.** In `.github/workflows/release.yml`, install the signer and point Tauri at the extra config. Add before the `tauri-apps/tauri-action` step:

```yaml
      - name: Install code-signing CLI
        run: cargo install trusted-signing-cli
```

and add this to the `with:` block of the `tauri-action` step:

```yaml
        with:
          # ...existing tagName / releaseName / etc...
          args: --config tauri.signing.conf.json
```

(The path is relative to `src-tauri/`, which is `tauri-action`'s working directory.)

That's it. On the next `git tag vX.Y.Z && git push`, CI signs the `.exe`, NSIS, and MSI during bundling, and the updater's `latest.json` signature is computed over the signed installer — both correct.

### 6. Verify a signed build
- Right-click the released `*-setup.exe` → **Properties → Digital Signatures** — a `ReFx Hosting` signature should be present and valid.
- Download it on a clean Windows box: no SmartScreen wall (public-trust certs are recognized immediately; if you ever switch to a plain OV cert, reputation builds over a few hundred installs).

---

## Alternative: a traditional OV/EV certificate

If you already hold (or prefer) a standard code-signing certificate:

- **EV cert** (hardware token / cloud HSM): instant SmartScreen reputation, but pricier and the private key lives on a token — awkward for headless CI.
- **OV cert** (`.pfx`): cheaper, but SmartScreen reputation accrues over time/installs.

Wire it the same way — via `signCommand` so the ordering gotcha is handled — pointing at `signtool`:

```json
{ "bundle": { "windows": {
  "signCommand": "signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /f cert.pfx /p %CSC_KEY_PASSWORD% %1"
} } }
```

Provide the `.pfx` (base64) and its password as secrets, decode the `.pfx` to disk in a CI step, and keep the `signCommand` in the release-only config file exactly as above.

---

## Status checklist

- [x] `release.yml` exports `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`
- [ ] Azure Trusted Signing account + certificate profile (identity validated)
- [ ] Service principal + “Certificate Profile Signer” role
- [ ] Three `AZURE_*` repo secrets added
- [ ] `src-tauri/tauri.signing.conf.json` created with your endpoint/account/profile
- [ ] `release.yml`: `cargo install trusted-signing-cli` step + `args: --config tauri.signing.conf.json`
- [ ] Cut a tag, confirm the installer's Digital Signatures tab
