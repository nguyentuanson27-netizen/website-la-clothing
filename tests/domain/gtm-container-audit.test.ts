/**
 * U28 / T8 — the static gate that must be green before any GTM loader or CSP origin may land.
 *
 * This audit reads a checked-in container export and answers one question: may this exact artifact
 * be loaded by the storefront? It is a security control, not a linter, so every rule below is
 * fail-closed — an export it cannot fully understand is refused rather than waved through. That
 * matters more than usual here, because the published GTM export schema could not be fetched from
 * Google's own documentation in this environment (both `developers.google.com` and
 * `support.google.com` are egress-blocked), so the parser treats anything unrecognised as a
 * violation instead of assuming it is benign.
 *
 * Tag Assistant is explicitly not a substitute for any of this: it observes one preview session,
 * while these assertions bind the artifact itself.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditGtmContainerExport,
  GTM_AUDIT_CODES,
  type GtmApprovedDestinations,
} from "../../src/tracking/gtm-container-audit.ts";

/** Stand-in vendor ids. Real values are owner gate O4 and are not invented here. */
const APPROVED: GtmApprovedDestinations = {
  gtmContainerId: "GTM-FIXTURE",
  ga4MeasurementIds: ["G-FIXTURE001"],
  googleAdsConversions: [{ conversionId: "AW-FIXTURE001", conversionLabel: "FixtureLabel01" }],
  tiktokPixelIds: ["FIXTUREPIXEL01"],
};

const LIVE_TRIGGER_ID = "10";
const ALWAYS_TRIGGER_ID = "11";

function liveGuardTrigger() {
  return {
    triggerId: LIVE_TRIGGER_ID,
    name: "Tracking mode is live",
    type: "pageview",
    filter: [
      {
        type: "equals",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{la_tracking_mode}}" },
          { type: "TEMPLATE", key: "arg1", value: "live" },
        ],
      },
    ],
  };
}

function unguardedTrigger() {
  return { triggerId: ALWAYS_TRIGGER_ID, name: "All pages", type: "pageview" };
}

function ga4ConfigTag(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "1",
    name: "GA4 configuration",
    type: "gaawc",
    firingTriggerId: [LIVE_TRIGGER_ID],
    parameter: [
      { type: "TEMPLATE", key: "measurementId", value: "G-FIXTURE001" },
      { type: "BOOLEAN", key: "sendPageView", value: "false" },
    ],
    ...overrides,
  };
}

function adsConversionTag(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "2",
    name: "Google Ads Purchase",
    type: "awct",
    firingTriggerId: [LIVE_TRIGGER_ID],
    parameter: [
      { type: "TEMPLATE", key: "conversionId", value: "AW-FIXTURE001" },
      { type: "TEMPLATE", key: "conversionLabel", value: "FixtureLabel01" },
      { type: "TEMPLATE", key: "orderId", value: "{{publicCode}}" },
    ],
    ...overrides,
  };
}

function ga4EventTag(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "3",
    name: "GA4 purchase",
    type: "gaawe",
    firingTriggerId: [LIVE_TRIGGER_ID],
    parameter: [
      { type: "TEMPLATE", key: "eventName", value: "purchase" },
      { type: "TEMPLATE", key: "transactionId", value: "{{publicCode}}" },
    ],
    ...overrides,
  };
}

/**
 * TikTok delivered through its gallery template.
 *
 * Kept as a fixture precisely because the audit refuses it: the template's delivery lives in code
 * the export does not contain, so no parameter allowlist can bound where it sends. It is a refusal
 * case here, not a happy path.
 */
function tiktokTemplateTag(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "4",
    name: "TikTok CompletePayment",
    type: "cvt_tiktok_pixel",
    firingTriggerId: [LIVE_TRIGGER_ID],
    parameter: [
      { type: "TEMPLATE", key: "pixelId", value: "FIXTUREPIXEL01" },
      { type: "TEMPLATE", key: "eventId", value: "{{publicCode}}" },
    ],
    ...overrides,
  };
}

function containerExport(overrides: Record<string, unknown> = {}) {
  return {
    exportFormatVersion: 2,
    containerVersion: {
      accountId: "0",
      containerId: "0",
      containerVersionId: "7",
      container: { publicId: "GTM-FIXTURE" },
      tag: [ga4ConfigTag(), adsConversionTag(), ga4EventTag()],
      trigger: [liveGuardTrigger(), unguardedTrigger()],
      variable: [],
      ...overrides,
    },
  };
}

function codes(result: ReturnType<typeof auditGtmContainerExport>): string[] {
  return [...new Set(result.findings.map((finding) => finding.code))].sort();
}

describe("GTM container export static audit", () => {
  it("passes a reviewed saved version whose production tags are all live-guarded", () => {
    const result = auditGtmContainerExport({
      source: containerExport(),
      approved: APPROVED,
    });

    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
    assert.equal(result.containerVersionId, "7");
    assert.equal(result.containerPublicId, "GTM-FIXTURE");
  });

  for (const [label, source] of [
    ["a non-object", 42],
    ["null", null],
    ["an empty object", {}],
    ["a container version that is not an object", { containerVersion: "nope" }],
    ["a tag list that is not an array", containerExport({ tag: "nope" })],
  ] as const) {
    it(`refuses ${label} instead of assuming it is benign`, () => {
      const result = auditGtmContainerExport({ source, approved: APPROVED });

      assert.equal(result.ok, false);
      assert.ok(
        codes(result).includes(GTM_AUDIT_CODES.MALFORMED_EXPORT),
        "an export this audit cannot parse must be refused, never skipped",
      );
    });
  }

  it("refuses a mutable workspace export that names no saved version", () => {
    for (const containerVersionId of [undefined, "", "0"]) {
      const result = auditGtmContainerExport({
        source: containerExport({ containerVersionId }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.NOT_A_SAVED_VERSION));
    }
  });

  for (const [label, tag] of [
    ["GA4", ga4ConfigTag({ firingTriggerId: [ALWAYS_TRIGGER_ID] })],
    ["Google Ads", adsConversionTag({ firingTriggerId: [ALWAYS_TRIGGER_ID] })],
    ["GA4 event", ga4EventTag({ firingTriggerId: [ALWAYS_TRIGGER_ID] })],
  ] as const) {
    it(`fails a production ${label} tag whose firing trigger has no live guard`, () => {
      const result = auditGtmContainerExport({
        source: containerExport({ tag: [tag], trigger: [liveGuardTrigger(), unguardedTrigger()] }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
    });
  }

  it("fails a tag with no firing trigger at all", () => {
    const result = auditGtmContainerExport({
      source: containerExport({ tag: [ga4ConfigTag({ firingTriggerId: [] })] }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
  });

  it("fails a tag guarded on a mode other than live", () => {
    const previewGuard = {
      triggerId: "12",
      name: "Tracking mode is preview",
      type: "pageview",
      filter: [
        {
          type: "equals",
          parameter: [
            { type: "TEMPLATE", key: "arg0", value: "{{la_tracking_mode}}" },
            { type: "TEMPLATE", key: "arg1", value: "preview" },
          ],
        },
      ],
    };
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ firingTriggerId: ["12"] })],
        trigger: [previewGuard],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
  });

  it("fails a tag whose firing trigger id resolves to no trigger", () => {
    // A dangling reference cannot be shown to carry a guard, so it is refused rather than trusted.
    const result = auditGtmContainerExport({
      source: containerExport({ tag: [ga4ConfigTag({ firingTriggerId: ["999"] })] }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
  });

  it("requires every firing trigger of a tag to carry the guard, not merely one of them", () => {
    // One unguarded path is enough to fire the tag, so any unguarded trigger fails the tag.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ firingTriggerId: [LIVE_TRIGGER_ID, ALWAYS_TRIGGER_ID] })],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
  });

  for (const [label, type] of [
    ["a gallery template", "cvt_unknown_vendor"],
    ["a Custom HTML tag", "html"],
    ["a tag carrying no type at all", ""],
  ] as const) {
    it(`refuses ${label} even when every firing path is live-guarded`, () => {
      // The live guard says *when* the tag fires, never *where* it delivers. For these types the
      // delivery lives in code the export does not contain, so nothing here bounds the destination
      // and the guard cannot stand in for one.
      const result = auditGtmContainerExport({
        source: containerExport({
          tag: [{ tagId: "9", name: "Mystery", type, firingTriggerId: [LIVE_TRIGGER_ID], parameter: [] }],
        }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAUDITABLE_TAG_TYPE));
    });
  }

  it("refuses a live-guarded custom tag whose delivery hides under an unrecognised key", () => {
    // This is the shape a parameter allowlist cannot catch: production delivery under `html`, with
    // no recognised destination key anywhere on the tag, so the destination scan finds nothing.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "9",
          name: "Vendor snippet",
          type: "html",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [{
            type: "TEMPLATE",
            key: "html",
            value: "<script>ttq.load('SOMEONEELSESPIXEL')</script>",
          }],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(
      codes(result).includes(GTM_AUDIT_CODES.UNAUDITABLE_TAG_TYPE),
      "a live guard must not certify a tag whose destination the export does not bound",
    );
  });

  it("refuses TikTok delivered through its gallery template, and says why", () => {
    // Recorded deliberately: T8 wants TikTok, and this audit as written cannot certify it through
    // GTM. Admitting it takes a reviewed parser for that exact template, not a passing default.
    const result = auditGtmContainerExport({
      source: containerExport({ tag: [tiktokTemplateTag()] }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAUDITABLE_TAG_TYPE));
  });

  it("rejects any Meta tag in the container, guarded or not", () => {
    // Meta stays a direct first-party integration. A Meta tag here would duplicate the browser
    // pixel and break the CAPI deduplication that pairs on order code.
    for (const metaTag of [
      { tagId: "8", name: "Facebook Pixel", type: "html", firingTriggerId: [LIVE_TRIGGER_ID], parameter: [{ type: "TEMPLATE", key: "html", value: "<script>fbq('init','1')</script>" }] },
      { tagId: "8", name: "Meta CompletePayment", type: "cvt_meta_pixel", firingTriggerId: [LIVE_TRIGGER_ID], parameter: [] },
    ]) {
      const result = auditGtmContainerExport({
        source: containerExport({ tag: [metaTag] }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.META_TAG_PRESENT));
    }
  });

  it("finds a Meta integration nested inside list or map parameters", () => {
    // Custom templates and some built-in types nest their real payload one or more levels down. A
    // scan that only reads top-level strings would wave this through, which is the fail-open this
    // audit exists to prevent.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [
          {
            tagId: "8",
            name: "Third party bundle",
            type: "cvt_generic_template",
            firingTriggerId: [LIVE_TRIGGER_ID],
            parameter: [
              {
                type: "LIST",
                key: "settings",
                list: [
                  {
                    type: "MAP",
                    map: [
                      { type: "TEMPLATE", key: "snippet", value: "fbq('track','Purchase')" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.META_TAG_PRESENT));
  });

  it("finds an unapproved destination id nested inside list or map parameters", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [
          {
            tagId: "9",
            name: "Nested destination",
            type: "cvt_generic_template",
            firingTriggerId: [LIVE_TRIGGER_ID],
            parameter: [
              {
                type: "MAP",
                key: "config",
                map: [{ type: "TEMPLATE", key: "measurementId", value: "G-NOTAPPROVED" }],
              },
            ],
          },
        ],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("refuses a tag nested deeper than the audit will walk", () => {
    // The export is untrusted JSON. A pathological structure must make the audit fail loudly rather
    // than hang or silently stop scanning half of a tag.
    let nested: unknown = { type: "TEMPLATE", key: "snippet", value: "fbq('track')" };
    for (let depth = 0; depth < 60; depth += 1) nested = { type: "LIST", list: [nested] };

    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{ tagId: "9", name: "Deep", type: "cvt_x", firingTriggerId: [LIVE_TRIGGER_ID], parameter: [nested] }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.MALFORMED_EXPORT));
  });

  it("fails a GA4 configuration that leaves automatic page views on", () => {
    // The application owns the canonical page view. A GA4 config that also sends one produces two
    // page views per navigation.
    for (const parameter of [
      [{ type: "TEMPLATE", key: "measurementId", value: "G-FIXTURE001" }],
      [
        { type: "TEMPLATE", key: "measurementId", value: "G-FIXTURE001" },
        { type: "BOOLEAN", key: "sendPageView", value: "true" },
      ],
    ]) {
      const result = auditGtmContainerExport({
        source: containerExport({ tag: [ga4ConfigTag({ parameter })] }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
    }
  });

  function constantVariable(name: string, value: string) {
    return {
      variableId: "100",
      name,
      type: "c",
      parameter: [{ type: "TEMPLATE", key: "value", value }],
    };
  }

  it("resolves a variable reference and accepts it when it names an approved destination", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ parameter: [
          { type: "TEMPLATE", key: "measurementId", value: "{{Prod GA4}}" },
          { type: "BOOLEAN", key: "sendPageView", value: "false" },
        ] })],
        variable: [constantVariable("Prod GA4", "G-FIXTURE001")],
      }),
      approved: APPROVED,
    });

    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
  });

  it("fails a variable reference that resolves to an unapproved destination", () => {
    // The indirection is the whole point of the finding: the literal never appears on the tag.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ parameter: [
          { type: "TEMPLATE", key: "measurementId", value: "{{Prod GA4}}" },
          { type: "BOOLEAN", key: "sendPageView", value: "false" },
        ] })],
        variable: [constantVariable("Prod GA4", "G-NOTAPPROVED")],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  for (const [label, variables] of [
    ["names no variable in the container", []],
    ["names a variable this audit cannot resolve to a literal", [
      { variableId: "100", name: "Prod GA4", type: "jsm", parameter: [] },
    ]],
    ["names a variable that itself defers to another reference", [
      { variableId: "100", name: "Prod GA4", type: "c", parameter: [{ type: "TEMPLATE", key: "value", value: "{{Deeper}}" }] },
    ]],
  ] as const) {
    it(`refuses a destination reference that ${label}`, () => {
      const result = auditGtmContainerExport({
        source: containerExport({
          tag: [ga4ConfigTag({ parameter: [
            { type: "TEMPLATE", key: "measurementId", value: "{{Prod GA4}}" },
            { type: "BOOLEAN", key: "sendPageView", value: "false" },
          ] })],
          variable: variables,
        }),
        approved: APPROVED,
      });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNRESOLVED_DESTINATION_REFERENCE));
    });
  }

  it("resolves a variable reference nested inside list or map parameters", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "5",
          name: "Nested indirect destination",
          type: "cvt_generic_template",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [{
            type: "MAP",
            key: "config",
            map: [{ type: "TEMPLATE", key: "pixelId", value: "{{Prod TikTok}}" }],
          }],
        }],
        variable: [constantVariable("Prod TikTok", "NOTAPPROVEDPIXEL")],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("fails a current Google tag that never proves page views are off", () => {
    // The GA4 Configuration tag became the Google tag, and the page-view toggle moved into
    // configuration settings or a referenced settings variable. A live guard alone is not proof.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [{ type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" }],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
  });

  it("accepts a Google tag that disables page views inside nested configuration settings", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            {
              type: "LIST",
              key: "configSettingsTable",
              list: [{
                type: "MAP",
                map: [
                  { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                  { type: "TEMPLATE", key: "parameterValue", value: "false" },
                ],
              }],
            },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
  });

  it("accepts a Google tag whose referenced settings variable disables page views", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "TEMPLATE", key: "configSettingsVariable", value: "{{Config settings}}" },
          ],
        }],
        variable: [{
          variableId: "101",
          name: "Config settings",
          type: "gtcs",
          parameter: [{
            type: "LIST",
            key: "configSettingsTable",
            list: [{
              type: "MAP",
              map: [
                { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                { type: "TEMPLATE", key: "parameterValue", value: "false" },
              ],
            }],
          }],
        }],
      }),
      approved: APPROVED,
    });

    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
  });

  it("fails a Google tag whose settings variable cannot be found", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "TEMPLATE", key: "configSettingsVariable", value: "{{Missing settings}}" },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
  });

  it("fails a Google tag that explicitly sends page views", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            {
              type: "LIST",
              key: "configSettingsTable",
              list: [{
                type: "MAP",
                map: [
                  { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                  { type: "TEMPLATE", key: "parameterValue", value: "true" },
                ],
              }],
            },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
  });

  it("does not let one settings row prove a claim another row makes", () => {
    // The fail-open this replaces: flattening the settings table into loose pairs let the `false`
    // of an unrelated row satisfy the `send_page_view` of a row that actually said `true`.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            {
              type: "LIST",
              key: "configSettingsTable",
              list: [
                {
                  type: "MAP",
                  map: [
                    { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                    { type: "TEMPLATE", key: "parameterValue", value: "true" },
                  ],
                },
                {
                  type: "MAP",
                  map: [
                    { type: "TEMPLATE", key: "parameter", value: "some_other_setting" },
                    { type: "TEMPLATE", key: "parameterValue", value: "false" },
                  ],
                },
              ],
            },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(
      codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW),
      "a false from an unrelated setting must not prove page views are off",
    );
  });

  it("refuses a settings row that names the page-view toggle but carries no value", () => {
    // The tag elsewhere says false, so skipping the incomplete row would read as proof. A row that
    // names the toggle and then says nothing about it is an open question, not a `false`.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "BOOLEAN", key: "sendPageView", value: "false" },
            {
              type: "LIST",
              key: "configSettingsTable",
              list: [{
                type: "MAP",
                map: [{ type: "TEMPLATE", key: "parameter", value: "send_page_view" }],
              }],
            },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
  });

  it("refuses a Google tag that claims the toggle both ways", () => {
    // Contradictory claims are not proof. Reading either one alone would pick the answer by scan
    // order rather than by evidence.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "BOOLEAN", key: "sendPageView", value: "false" },
            {
              type: "LIST",
              key: "configSettingsTable",
              list: [{
                type: "MAP",
                map: [
                  { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                  { type: "TEMPLATE", key: "parameterValue", value: "true" },
                ],
              }],
            },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW));
  });

  it("finds a Meta payload that only a referenced variable carries", () => {
    // The tag itself holds no Meta marker at all; the snippet lives in the variable it embeds. A
    // scan of the tag object alone would read the reference and never the payload.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "9",
          name: "Vendor snippet",
          type: "html",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [{ type: "TEMPLATE", key: "html", value: "<script>{{Vendor snippet body}}</script>" }],
        }],
        variable: [constantVariable("Vendor snippet body", "fbq('track','Purchase')")],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.META_TAG_PRESENT));
  });

  it("finds a Meta payload two variable hops away", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "9",
          name: "Vendor snippet",
          type: "html",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [{ type: "TEMPLATE", key: "html", value: "<script>{{Outer}}</script>" }],
        }],
        variable: [
          constantVariable("Outer", "wrap({{Inner}})"),
          constantVariable("Inner", "fbevents.js"),
        ],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.META_TAG_PRESENT));
  });

  it("terminates on variables that reference each other in a cycle", () => {
    // The export is untrusted JSON, so a cycle must end the walk rather than hang the audit.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ parameter: [
          { type: "TEMPLATE", key: "measurementId", value: "G-FIXTURE001" },
          { type: "BOOLEAN", key: "sendPageView", value: "false" },
          { type: "TEMPLATE", key: "note", value: "{{A}}" },
        ] })],
        variable: [constantVariable("A", "sees {{B}}"), constantVariable("B", "sees {{A}}")],
      }),
      approved: APPROVED,
    });

    assert.deepEqual(result.findings, []);
    assert.equal(result.ok, true);
  });

  it("does not let an unrelated variable answer for configuration settings the tag never wired", () => {
    // The tag names no settings table and no settings variable, so nothing about it says page views
    // are off. Following every reference on the tag let a variable it merely mentions supply the
    // proof — a `false` about a configuration this tag does not use.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "TEMPLATE", key: "note", value: "{{Unrelated settings}}" },
          ],
        }],
        variable: [{
          variableId: "101",
          name: "Unrelated settings",
          type: "gtcs",
          parameter: [{
            type: "LIST",
            key: "configSettingsTable",
            list: [{
              type: "MAP",
              map: [
                { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
                { type: "TEMPLATE", key: "parameterValue", value: "false" },
              ],
            }],
          }],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(
      codes(result).includes(GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW),
      "only a settings carrier the tag actually names may prove the toggle",
    );
  });

  it("fails a Google Ads conversion that pairs a reviewed id with an unreviewed label", () => {
    // The id names the account; the label names the conversion action. Approving them separately
    // would let a reviewed account report a conversion nobody looked at.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [adsConversionTag({ parameter: [
          { type: "TEMPLATE", key: "conversionId", value: "AW-FIXTURE001" },
          { type: "TEMPLATE", key: "conversionLabel", value: "SomeOtherLabel" },
        ] })],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("fails a Google Ads conversion that names no label at all", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [adsConversionTag({ parameter: [
          { type: "TEMPLATE", key: "conversionId", value: "AW-FIXTURE001" },
        ] })],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("fails a Google Ads conversion whose label is reviewed under a different id", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [adsConversionTag({ parameter: [
          { type: "TEMPLATE", key: "conversionId", value: "AW-FIXTURE002" },
          { type: "TEMPLATE", key: "conversionLabel", value: "FixtureLabel01" },
        ] })],
      }),
      approved: {
        ...APPROVED,
        googleAdsConversions: [
          { conversionId: "AW-FIXTURE001", conversionLabel: "FixtureLabel01" },
          { conversionId: "AW-FIXTURE002", conversionLabel: "FixtureLabel02" },
        ],
      },
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("does not let one vendor's approved id satisfy another vendor's field", () => {
    // A flat union of approved ids proves only that a literal appears somewhere in the approved set.
    // Here the pixel id is genuinely approved — for TikTok, not for a Google tag.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{
          tagId: "1",
          name: "Google tag",
          type: "googtag",
          firingTriggerId: [LIVE_TRIGGER_ID],
          parameter: [
            { type: "TEMPLATE", key: "tagId", value: "G-FIXTURE001" },
            { type: "TEMPLATE", key: "pixelId", value: "FIXTUREPIXEL01" },
            { type: "BOOLEAN", key: "sendPageView", value: "false" },
          ],
        }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("does not let a GA4 measurement id satisfy a Google Ads conversion", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [adsConversionTag({ parameter: [
          { type: "TEMPLATE", key: "conversionId", value: "G-FIXTURE001" },
          { type: "TEMPLATE", key: "conversionLabel", value: "FixtureLabel01" },
        ] })],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  for (const [label, exportFormatVersion] of [
    ["declares no export format", undefined],
    ["declares a format this parser was not written against", 999],
    ["declares its format as a string", "2"],
  ] as const) {
    it(`refuses an export that ${label}`, () => {
      const source = { ...containerExport(), exportFormatVersion };
      const result = auditGtmContainerExport({ source, approved: APPROVED });

      assert.equal(result.ok, false);
      assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNSUPPORTED_EXPORT_FORMAT));
    });
  }

  it("refuses a variable list that is not an array rather than reading it as empty", () => {
    // An unreadable variable list is not an empty one: every reference would resolve to nothing and
    // the container would look cleaner than it is.
    const result = auditGtmContainerExport({
      source: containerExport({ variable: { "Prod GA4": "G-FIXTURE001" } }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.MALFORMED_EXPORT));
  });

  it("refuses an export from a container the owner did not approve", () => {
    // Same destination ids, different container: without this the audit would certify an artifact
    // that was never the reviewed one.
    const result = auditGtmContainerExport({
      source: containerExport({ container: { publicId: "GTM-SOMEONEELSE" } }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.CONTAINER_NOT_APPROVED));
  });

  it("fails a destination id the owner has not approved", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [ga4ConfigTag({ parameter: [
          { type: "TEMPLATE", key: "measurementId", value: "G-NOTAPPROVED" },
          { type: "BOOLEAN", key: "sendPageView", value: "false" },
        ] })],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.UNAPPROVED_DESTINATION));
  });

  it("fails closed when no destination has been approved at all", () => {
    // Owner gate O4. With no reviewed vendor ids there is nothing to compare against, and an audit
    // that passed here would be certifying an unreviewed container.
    const result = auditGtmContainerExport({
      source: containerExport(),
      approved: {
        gtmContainerId: "GTM-FIXTURE",
        ga4MeasurementIds: [],
        googleAdsConversions: [],
        tiktokPixelIds: [],
      },
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.NO_APPROVED_DESTINATIONS));
  });

  it("reports every violation in one pass rather than stopping at the first", () => {
    const result = auditGtmContainerExport({
      source: containerExport({
        containerVersionId: "0",
        tag: [
          ga4ConfigTag({ firingTriggerId: [ALWAYS_TRIGGER_ID], parameter: [
            { type: "TEMPLATE", key: "measurementId", value: "G-NOTAPPROVED" },
          ] }),
          { tagId: "8", name: "Facebook Pixel", type: "cvt_meta_pixel", firingTriggerId: [LIVE_TRIGGER_ID], parameter: [] },
        ],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.deepEqual(codes(result), [
      GTM_AUDIT_CODES.GA4_AUTOMATIC_PAGE_VIEW,
      GTM_AUDIT_CODES.META_TAG_PRESENT,
      GTM_AUDIT_CODES.NOT_A_SAVED_VERSION,
      GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD,
      GTM_AUDIT_CODES.UNAPPROVED_DESTINATION,
      GTM_AUDIT_CODES.UNAUDITABLE_TAG_TYPE,
    ].sort());
  });
});
