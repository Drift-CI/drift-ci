# Reverse-proxy hardening

A reverse proxy (nginx, Caddy, Traefik) handles TLS, custom domains,
and load balancing in front of the drift-ci dashboard container. This
guide covers the headers and env vars that need to line up so
sign-in, OAuth, webhooks, and the same-origin protection all behave
correctly behind a proxy.

If you only want to evaluate drift-ci on `localhost`, you don't need
any of this — start with [self-hosting.md](./self-hosting.md) and come
back when you're ready to put a real domain in front of it.

## What the dashboard expects

The dashboard is a Next.js standalone server listening on
`0.0.0.0:3000` inside the container. It does **not** terminate TLS
itself. The proxy does. Three things in particular depend on the
proxy doing the right thing:

1. **The `Host` header** — drift-ci's same-origin check
   ([packages/dashboard/src/lib/origin.ts](../packages/dashboard/src/lib/origin.ts))
   compares `Origin` against the request URL's host. If the proxy
   rewrites `Host`, state-changing requests from the browser get
   rejected as cross-origin.
2. **HTTPS termination + `X-Forwarded-Proto`** — the session cookie is
   marked `Secure` in production, so it's only sent over HTTPS. If
   the browser thinks the site is HTTP, the cookie won't come back and
   sign-in appears to silently fail.
3. **The OAuth callback URL** — drift-ci derives the redirect URI
   from `request.url` by default, which inside the container is the
   internal `http://0.0.0.0:3000` address, not your public domain.
   You must override it with `DRIFT_OAUTH_REDIRECT_URI` whenever you
   run behind a proxy.

The rest of this doc walks through how to satisfy those three
requirements with concrete proxy config.

## The mandatory headers

Whatever proxy you pick, it must forward these to the dashboard:

| Header | Value | Why |
| --- | --- | --- |
| `Host` | The original public host (`drift.example.com`) | Origin check, cookie domain, link generation. |
| `X-Forwarded-Proto` | `https` (when TLS-terminated upstream) | So the dashboard knows it's behind HTTPS even though the upstream connection is HTTP. |
| `X-Forwarded-For` | Original client IP, comma-appended | Audit log + rate-limit per-IP keys. |
| `X-Real-IP` | Original client IP | Same as above, useful for proxies that prefer this name. |

Never let untrusted clients spoof these — the proxy must **strip**
inbound `X-Forwarded-*` from the public side before adding its own.

## OAuth and redirect URIs

Both `/login/github` and `/login/github/callback` derive the OAuth
redirect URI like this:

```ts
const explicit = process.env.DRIFT_OAUTH_REDIRECT_URI;
if (explicit) return explicit;
const url = new URL(request.url);
return `${url.origin}/login/github/callback`;
```

Inside the container `request.url` is the internal upstream URL —
`http://0.0.0.0:3000/login/github`. GitHub will hand the user back
to that URL, which is unreachable from the browser, and sign-in 502s.

**Fix:** set `DRIFT_OAUTH_REDIRECT_URI` to the public callback URL:

```env
DRIFT_OAUTH_REDIRECT_URI=https://drift.example.com/login/github/callback
```

The same URL goes into the GitHub OAuth App's "Authorization callback
URL" field. They must match exactly — GitHub rejects callbacks that
don't.

## Cookie security

The session cookie ([packages/dashboard/src/lib/session.ts](../packages/dashboard/src/lib/session.ts))
is set with:

- `HttpOnly` — JS can't read it.
- `SameSite=Lax` — survives the OAuth callback redirect, blocks
  most CSRF.
- `Secure` — when `NODE_ENV === 'production'`, which the official
  Docker image sets by default.

`Secure` cookies require an HTTPS connection or the browser silently
drops them. If you're testing without TLS, either:

- Test against `http://localhost:3000` directly (loopback exempts
  `Secure`), or
- Set `NODE_ENV=development` temporarily — but **never** do this in
  production; it disables the `Secure` flag entirely.

## nginx

```nginx
# /etc/nginx/sites-available/drift.example.com
server {
    listen 80;
    server_name drift.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name drift.example.com;

    ssl_certificate     /etc/letsencrypt/live/drift.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/drift.example.com/privkey.pem;

    # Strip any inbound X-Forwarded-* the client tried to spoof,
    # then add our own.
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host  $host;

    # Webhooks can be larger than the default 1m. Pick a number that
    # fits your largest expected payload.
    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_redirect off;
    }
}
```

Then in your `.env`:

```env
DRIFT_OAUTH_REDIRECT_URI=https://drift.example.com/login/github/callback
```

## Caddy

Caddy handles TLS automatically, so the config is shorter:

```caddyfile
drift.example.com {
    reverse_proxy 127.0.0.1:3000 {
        # Caddy sets X-Forwarded-For / X-Forwarded-Proto / X-Forwarded-Host
        # by default. Host is preserved unless explicitly overridden,
        # which is exactly what we want.
    }

    # Webhooks can be larger than Caddy's default ~10MB; bump only if
    # your payloads warrant it.
    request_body {
        max_size 5MB
    }
}
```

In `.env`:

```env
DRIFT_OAUTH_REDIRECT_URI=https://drift.example.com/login/github/callback
```

## Traefik (Docker labels)

If you're already on Traefik, attach labels to the dashboard service
in `docker-compose.yml`:

```yaml
  dashboard:
    # ...existing config from packages/dashboard/docker-compose.yml...
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.drift.rule=Host(`drift.example.com`)"
      - "traefik.http.routers.drift.entrypoints=websecure"
      - "traefik.http.routers.drift.tls.certresolver=letsencrypt"
      - "traefik.http.services.drift.loadbalancer.server.port=3000"
      # Traefik forwards Host + sets X-Forwarded-* by default.
```

Same `DRIFT_OAUTH_REDIRECT_URI` requirement.

## Testing the proxy

After bringing the proxy up, three quick checks confirm the headers
flow correctly:

1. **Cookie path** — sign in, then in DevTools verify the
   `drift_session` cookie has `Secure` set and a `Path=/`.
2. **Origin check** — visit `/admin/tokens` and click "Mint token".
   If the request is rejected with `403 cross-origin`, the proxy is
   not forwarding `Host` correctly.
3. **OAuth round-trip** — sign out, sign back in via GitHub. If the
   browser ends up on `http://0.0.0.0:3000/...` after the GitHub
   redirect, `DRIFT_OAUTH_REDIRECT_URI` is unset or wrong.

For the webhook receiver, GitHub's "Recent Deliveries" panel
(Settings → Webhooks → your hook) shows the response body — drift-ci
returns `200 ok` on a verified delivery and `401 bad signature` on a
secret mismatch, so a misconfigured `GITHUB_WEBHOOK_SECRET` is
visible there.

## What we don't currently do

- **No built-in rate limit at the proxy layer.** The dashboard has
  per-key token-bucket limits inside the app
  ([packages/dashboard/src/lib/rate-limit.ts](../packages/dashboard/src/lib/rate-limit.ts)),
  which are enough for the API endpoints. If you're worried about
  L4 floods, add a proxy-level limit too — they compose cleanly.
- **No automatic HSTS / CSP headers.** Add them at the proxy if your
  threat model wants them. drift-ci doesn't depend on either.
- **No multi-replica session affinity needed.** Sessions are signed
  cookies (no server-side store) and the rate-limit bucket is
  best-effort — both replicas of the dashboard can serve the same
  user. If you scale out, swap the in-memory rate-limit store for
  Redis (the interface in `lib/rate-limit.ts` is pluggable).
