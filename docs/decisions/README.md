# Architecture decision record index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](./0001-production-infrastructure.md) | **Superseded by ADR 0002** | Render Web Service + Render Postgres production infrastructure |
| [0002](./0002-vps-production-infrastructure.md) | **Accepted, amended by ADR 0003 & ADR 0004** | Self-managed VPS with Docker Compose, PostgreSQL, and Caddy |
| [0003](./0003-shared-host-npm-edge.md) | **Accepted, amended by ADR 0004** | Shared-host nginx-proxy-manager edge in front of internal Caddy |
| [0004](./0004-temporary-production-domain.md) | **Accepted** | Temporary production domain (`la.lanadesign.vn`) and non-indexable search exposure policy |
| [0005](./0005-pr-scope-reviewability.md) | **Accepted** | PR scope is governed by atomicity, risk, and reviewability rather than a hard file-count limit |
| [0006](./0006-admin-mobile-overflow-non-blocking.md) | **Accepted** | Keep mobile admin UI unchanged; the known mobile-only overflow is non-blocking for V3 |
| [0007](./0007-configurable-merchant-apparel-facts.md) | **Accepted** | O3 uses approved `male/adult/new` shop defaults with local product overrides and fail-closed Merchant resolution |
| [0008](./0008-merchant-manufacturer-mpn-source.md) | **Accepted** | Merchant manufacturer MPN comes from Pancake variation `display_id` mirrored as `pancakeDisplayId`; local `VariantMirror.sku` ownership is unchanged |

ADR files are retained as historical records when superseded or amended. The newest accepted ADR governs where decisions overlap, including repository workflow policy documented by ADR 0005, the V3 mobile-admin overflow scope documented by ADR 0006, Merchant apparel-fact policy documented by ADR 0007, and Merchant manufacturer-MPN source/ownership semantics documented by ADR 0008.
