# Architecture decision record index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](./0001-production-infrastructure.md) | **Superseded by ADR 0002** | Render Web Service + Render Postgres production infrastructure |
| [0002](./0002-vps-production-infrastructure.md) | **Accepted, amended by ADR 0003** | Self-managed VPS with Docker Compose, PostgreSQL, and Caddy |
| [0003](./0003-shared-host-npm-edge.md) | **Accepted** | Shared-host nginx-proxy-manager edge in front of internal Caddy |

ADR files are retained as historical records when superseded or amended. The newest accepted ADR governs the active production architecture where decisions overlap.
