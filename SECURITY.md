# Security

ChannelVault is a single-user desktop tool. It runs a small HTTP server on
`127.0.0.1` and never listens on the network. The threat it defends against is
the user's own browser: a hostile web page open in another tab that tries to
drive the local API.

## What the app does to protect you

- **No CORS grant.** The server never sends `Access-Control-Allow-*` headers, so
  a cross-origin page cannot read any response.
- **Custom header on every API call.** Requests without `X-ChannelVault` are
  refused, whatever the method. A web page cannot attach a custom header
  cross-origin without a preflight the server denies, nor through `<img>`,
  `<iframe>` or a navigation. The dashboard and the Tampermonkey userscript send
  it; nothing else can.
- **Host allowlist.** Only `localhost`, `127.0.0.1` and `[::1]` are accepted as
  the `Host` header, which blocks DNS rebinding.
- **Strict video ids.** Every route and body that takes a YouTube id enforces
  the 11 character URL-safe shape before it reaches the filesystem.
- **Sanitised scraped links.** Creator links captured from a channel's About
  panel keep only `http`/`https`, both when stored and when rendered.
- **Bounded decoders.** Network images are size-capped before Pillow decodes
  them, and `ffprobe`/`ffmpeg`/`yt-dlp` subprocess calls all carry timeouts.
- **Reproducible releases.** Python dependencies are pinned exactly, GitHub
  Actions are pinned to commit SHAs, and each release ships a build provenance
  attestation you can check with
  `gh attestation verify channelvault-linux-x86_64 --repo Cotions/ChannelVault`.

## What it does not do

- No login. Anyone with a shell on your machine can talk to the port. That is
  the same trust boundary as your home directory.
- No TLS. Traffic never leaves the loopback interface.
- No sandboxing of `yt-dlp`, `ffmpeg` or `ffprobe`. Those tools parse untrusted
  media and are installed from your distribution or pip; keep them updated. They
  are the most exposed code in the stack.

## Reporting a vulnerability

Open a private security advisory on GitHub
(Security tab, "Report a vulnerability") or email the maintainer listed in the
repository profile. Please do not file public issues for security reports.
Expect an acknowledgement within a week.
