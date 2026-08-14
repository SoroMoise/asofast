import { siteConfig } from "@/config/site";

export const dynamic = "force-static";

export function GET() {
  const baseUrl = siteConfig.url;

  const body = `# ${siteConfig.name}

> ${siteConfig.description}

ASOFAST is an AI tool that generates App Store and Google Play listings for app developers and studios. Paste a store link, pick up to 5 competitors and up to 87 target markets, then generate optimized ASO copy, native multilingual translations and marketing screenshots in one click. Publish to both stores directly. 100% local and open source: run it on your own machine with your own OpenAI key.

## How it works

1. Add your app by pasting its App Store or Google Play link.
2. Select up to 5 competitors to analyze.
3. Import your existing screenshots.
4. Select your languages, up to 87 markets at once.
5. Generate copy, translations and screenshots in one click.
6. Publish to the App Store and Google Play together.

## Features

- Optimized ASO copy: titles, subtitles and descriptions written for visibility and conversion, with per store character limits.
- Multilingual translations: native, culturally adapted copy with localized keywords per market, not literal translation.
- Marketing screenshots: store ready screenshots generated from your existing shots.
- Multi store: App Store and Google Play in one workflow.

## Contact

- Email: ${siteConfig.email}
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}