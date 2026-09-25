# ASOFAST

Automatically generate your App Store and Google Play listings — ASO copy,
multilingual translations, and marketing screenshots — then publish directly
to both stores.

**100% local, free and open source.** No external services required (except
an LLM provider for generation — OpenAI or Anthropic, with your own API key).
All your data stays on your machine (SQLite + files).

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS · SQLite (better-sqlite3) ·
OpenAI / Anthropic / DeepSeek · App Store Connect API · Google Play Android Publisher API

## Prerequisites

- Node.js 20+
- npm
- An OpenAI API key (https://platform.openai.com/api-keys), an Anthropic
  API key (https://console.anthropic.com/settings/keys) or a DeepSeek
  API key (https://platform.deepseek.com/api_keys)
- (optional) App Store Connect / Google Play credentials for publishing

## Installation

```bash
git clone https://github.com/ediaStudio/asofast.git
cd asofast
npm install
cp .env.example .env.local
```

Edit `.env.local`:

- `AI_PROVIDER`: `openai`, `anthropic` or `deepseek` (optional — defaults to `openai` if unset)
- `OPENAI_API_KEY`: your OpenAI API key (required unless `AI_PROVIDER` is `anthropic` or `deepseek`)
- `ANTHROPIC_API_KEY`: your Anthropic API key (required when `AI_PROVIDER="anthropic"`)
- `DEEPSEEK_API_KEY`: your DeepSeek API key (required when `AI_PROVIDER="deepseek"`)

## Run

```bash
npm run dev
```

Open http://localhost:3000 — you land directly on the dashboard.

## Usage

1. **Create a project**: paste an App Store link or enter a Google Play package name.
2. **Add competitors**: up to 5 competing apps for ASO analysis.
3. **Select languages**: up to 87 markets in one click.
4. **Generate**: ASO listing (title, subtitle, description, keywords) + translations + marketing screenshots.
5. **Publish**: connect your App Store Connect (.p8 key) or Google Play (service account JSON) credentials, then publish directly.

## Features

- Full ASO generation (title, subtitle, description, keywords, promotional text)
- Native, culturally adapted translations per market
- Marketing screenshots (phone + tablet) for App Store and Google Play
- Direct publishing to App Store Connect and Google Play
- Competitor keyword extraction
- Privacy policy and What's New management
- Dark/light mode

## Data

All your data is stored locally:

- `./data/asofast.db`: SQLite database (projects, listings, store credentials)
- `./data/uploads/`: icons, screenshots, feature graphics
- `./data/icons/`: cache of store icons (fetched through the local proxy)
- `.env.local`: your AI provider API key

These files are in `.gitignore` — never committed.

## Project structure

```
src/
  app/
    (app)/           dashboard (projects, generation, publishing)
    api/             API routes (apps, files, projects)
    llms.txt, sitemap.ts, robots.ts
  components/
    ui/              generic components (button, card, input...)
    dashboard/       dashboard components
  lib/
    db/              SQLite database (schema + helpers)
    storage.ts       local file storage
    ai/              ASO generation (OpenAI / Anthropic / DeepSeek, via AI_PROVIDER)
    aso/             ASO pipeline (prompts, generation, screenshots)
    publish/         store publishing (App Store Connect, Google Play)
    scrapers/        app lookup (iTunes, Google Play)
    store-icons.ts   local icon proxy for store icons
  config/            site configuration
```

## License

MIT — see the [LICENSE](LICENSE) file.

## Questions / Support

- Email: contact@asofast.app
- GitHub Issues: https://github.com/ediaStudio/asofast/issues
