const SCHEMA_CONTEXT = "https://schema.org" as const;

export type CollectionBreadcrumbStructuredDataDocument = {
  "@context": typeof SCHEMA_CONTEXT;
  "@type": "BreadcrumbList";
  itemListElement: [
    {
      "@type": "ListItem";
      position: 1;
      name: "Trang chủ";
      item: string;
    },
    {
      "@type": "ListItem";
      position: 2;
      name: "Bộ sưu tập";
      item: string;
    },
    {
      "@type": "ListItem";
      position: 3;
      name: string;
    },
  ];
};

export function buildCollectionBreadcrumbStructuredData({
  origin,
  title,
}: Readonly<{
  origin: string;
  slug: string;
  title: string;
}>): CollectionBreadcrumbStructuredDataDocument {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Trang chủ",
        item: new URL("/", origin).href,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Bộ sưu tập",
        item: new URL("/collections", origin).href,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: title,
      },
    ],
  };
}
