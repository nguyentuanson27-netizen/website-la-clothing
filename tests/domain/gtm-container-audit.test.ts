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
  googleAdsConversionIds: ["AW-FIXTURE001"],
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
      { type: "TEMPLATE", key: "orderId", value: "{{publicCode}}" },
    ],
    ...overrides,
  };
}

function tiktokTag(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "3",
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
      tag: [ga4ConfigTag(), adsConversionTag(), tiktokTag()],
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
    ["TikTok", tiktokTag({ firingTriggerId: [ALWAYS_TRIGGER_ID] })],
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

  it("refuses an unrecognised tag type rather than assuming it delivers nothing", () => {
    // The schema could not be verified against Google's own docs here, so an unknown type is
    // treated as a possible production destination and must still prove its guard.
    const result = auditGtmContainerExport({
      source: containerExport({
        tag: [{ tagId: "9", name: "Mystery", type: "cvt_unknown_vendor", firingTriggerId: [ALWAYS_TRIGGER_ID], parameter: [] }],
      }),
      approved: APPROVED,
    });

    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(GTM_AUDIT_CODES.TAG_WITHOUT_LIVE_GUARD));
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
        googleAdsConversionIds: [],
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
    ].sort());
  });
});
