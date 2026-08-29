const isDevelopment = process.env.NODE_ENV === "development";

// The Meta pixel needs three holes in the policy: its loader script, the 1x1 beacons it writes as
// images, and the XHR it posts events with. They are opened only where a pixel is actually
// configured, so an environment without one keeps the closed policy rather than carrying an
// unused allowance for a third-party origin.
const hasFacebookPixel = (process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID ?? "").trim().length > 0;
const facebookScriptSrc = hasFacebookPixel ? " https://connect.facebook.net" : "";
const facebookImgSrc = hasFacebookPixel ? " https://www.facebook.com" : "";
const facebookConnectSrc = hasFacebookPixel
  ? " https://www.facebook.com https://connect.facebook.net"
  : "";

const contentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}${facebookScriptSrc};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https://content.pancake.vn${facebookImgSrc};
  font-src 'self';
  connect-src 'self'${isDevelopment ? " ws: wss:" : ""}${facebookConnectSrc};
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "content.pancake.vn",
        port: "",
        pathname: "/*/*/*/*/*.jpg",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
