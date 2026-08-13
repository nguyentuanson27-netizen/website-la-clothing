# T12 Editorial homepage + lookbook — implementation plan

## Scope
Complete the remaining T12 storefront composition without introducing a new CMS schema or guessing Pancake semantics.

- Homepage campaign/lookbook copy remains website-owned editorial content.
- The homepage product edit reads only the existing configured local catalog mirror; it performs no live Pancake request.
- The product edit must not claim unverified arrival/chronology semantics. The repository currently orders visible products deterministically by name/id, so this slice labels the section as an editorial shop edit rather than “new arrivals”.
- `/lookbook` becomes a complete static editorial story using the approved minimal/editorial/modern-menswear visual direction.
- Existing restricted `ProductContent` administration remains unchanged.
- No T13 search/filter/category behavior, promotion rules, account history, new database model, dependency, or remote image ingestion is added.

## Dependency graph
1. Existing local storefront catalog read model.
2. Homepage safe product composition.
3. Static lookbook composition.
4. Mobile/browser/accessibility runtime verification.
5. Code review + Definition of Done gate.

## Acceptance criteria
- Homepage shows up to four real visible products from the configured shop using the existing safe storefront card/read model.
- Product cards link to the real local PDP slug and expose only the existing storefront-safe price/availability presentation.
- No hard-coded fake commerce products remain on the homepage.
- Empty mirrored catalog renders a deliberate editorial empty state rather than fake inventory.
- `/lookbook` has semantic, multi-section editorial composition with one page H1 and labelled story sections.
- Homepage and lookbook have no horizontal overflow at the existing 390×844 runtime viewport, remain keyboard reachable, pass selected Axe WCAG A/AA checks, and produce no browser-console or failed-network errors in the controlled runtime.
- Existing Linux verification, database/security smokes, typecheck, domain/integration tests, and production build remain green.

## TDD sequence
1. RED: add a real browser runtime seeded with one configured-shop mirrored product. Assert that the homepage renders that product/link and that the expanded lookbook story sections exist.
2. GREEN: wire homepage to the existing catalog runtime and implement the lookbook composition with minimal scoped CSS.
3. VERIFY: exact-head CI across Linux + macOS browser/Axe runtime.
4. REVIEW: correctness → security → architecture → simplicity → performance.
