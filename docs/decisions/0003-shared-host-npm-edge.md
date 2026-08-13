# ADR 0003: Shared-host nginx-proxy-manager edge

- **Status:** Accepted
- **Date:** 2026-08-13
- **Amends:** ADR 0002 (Self-managed VPS production infrastructure)

## Context

ADR 0002 assumed a dedicated VPS where Caddy is the only public HTTP(S) service and binds host ports 80/443 directly.

The selected production VPS is shared. It already runs unrelated production services behind an existing nginx-proxy-manager (NPM) instance that owns host ports 80, 81, and 443. Binding those ports from LA Clothing's Caddy service would conflict with the live edge and could disrupt unrelated services.

## Decision

On this shared host, NPM remains the public HTTP(S) and TLS edge. LA Clothing keeps Caddy as an internal reverse proxy so the application still receives a proxy-owned `X-LA-Client-IP` header and `/shop` remains the upstream health target.

The repository topology is amended as follows:

- Caddy no longer publishes host ports 80/443 and serves plain HTTP on container port 80.
- Caddy joins the normal private `backend` network and a host-owned external Docker network selected by `EDGE_NETWORK_NAME`.
- Caddy has the stable edge-network alias `la-clothing-caddy`; NPM must forward the production hostname to `http://la-clothing-caddy:80` on that network.
- Caddy receives `EDGE_TRUSTED_PROXY_CIDR` and trusts only that CIDR for client-IP forwarding. The value must be scoped as tightly as the host topology allows.
- Caddy explicitly parses `X-Forwarded-For` and enables `trusted_proxies_strict`, so the address chain is evaluated right-to-left. NPM's default proxy configuration appends the connecting address to `X-Forwarded-For`, so strict parsing prevents a caller-controlled left-most value from becoming the trusted client IP.
- Caddy still overwrites `X-LA-Client-IP` before proxying to Next.js; production continues to use `BETTER_AUTH_IP_HEADER=x-la-client-ip`.
- NPM owns certificate issuance, HTTP-to-HTTPS redirect, and the public 80/443 listeners. NPM configuration is host-specific and is not managed by this repository.
- Cloudflare stays DNS-only for the initial launch unless a later reviewed change introduces Cloudflare proxy trust at the NPM edge.

The external edge network must already exist and NPM must already be attached before LA Clothing is started. The two host-specific values `EDGE_NETWORK_NAME` and `EDGE_TRUSTED_PROXY_CIDR` belong in the protected `deploy/vps/.env.production` file on the VPS.

## Security consequences

The trusted proxy CIDR is a security boundary. Any compromised container that can connect to Caddy from a trusted address range could attempt to spoof forwarded client-IP values. Prefer the smallest stable CIDR possible and, when operationally practical, a dedicated proxy-only bridge shared only by NPM and LA Clothing's Caddy service.

Do not trust all Docker private ranges and do not trust caller-supplied `X-LA-Client-IP`; Caddy must continue to overwrite that application-owned header.

## Operational consequences

Positive:

- LA Clothing can launch on the approved shared VPS without taking host ports away from existing services.
- TLS and public routing remain centralized in the edge already operating on the host.
- The application keeps the reviewed single-value client-IP trust boundary.

Trade-offs:

- public availability and TLS now depend on NPM, a shared component outside this repository;
- NPM route/certificate configuration must be backed up and monitored separately;
- the public edge shares failure and maintenance risk with unrelated services;
- a wrong edge-network/CIDR value can cause outage or incorrect rate-limit attribution.

## Revert path

If LA Clothing later moves to a dedicated VPS, revert to ADR 0002's direct-Caddy-edge model: restore Caddy host 80/443 publication and automatic HTTPS, remove the external edge network and NPM trusted-proxy settings, and point DNS directly at Caddy.

## References

- Caddy trusted proxies and strict client-IP parsing: https://caddyserver.com/docs/caddyfile/options
- Caddy reverse proxy header behavior: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy behind another proxy pattern: https://caddyserver.com/docs/caddyfile/patterns
- Nginx Proxy Manager default forwarded-header config: https://github.com/NginxProxyManager/nginx-proxy-manager/blob/develop/docker/rootfs/etc/nginx/conf.d/include/proxy.conf
