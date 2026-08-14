export const siteConfig = {
  name: "ASOFAST",
  description:
    "Automatically generate your App Store & Google Play listings: ASO copy, multilingual translations, and marketing screenshots, 100% AI.",
  url: "http://localhost:3000",
  email: "contact@asofast.app",
  nav: [
    { title: "Projects", href: "/" },
  ] as const,
  footerLinks: [
    {
      title: "Legal",
      links: [
        { title: "Terms", href: "/legal/terms" },
        { title: "Privacy", href: "/legal/privacy" },
      ],
    },
  ],
} as const;