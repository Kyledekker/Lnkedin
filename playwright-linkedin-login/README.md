# Playwright LinkedIn Login + Azure Functions (TypeScript)

Dieses Projekt kann lokal mit Playwright laufen und als Azure Function App deployed werden.

## Struktur

```text
playwright-linkedin-login/
├─ host.json
├─ local.settings.json
├─ package.json
├─ tsconfig.json
├─ .funcignore
├─ src/
│  ├─ jobs-ai-hr.ts
│  ├─ jobs-search.ts
│  ├─ reuse-session.ts
│  └─ functions/
│     ├─ runJobsAiHr.ts
│     └─ runJobsSearch.ts
├─ login.ts
├─ reuse-session.ts
└─ server.ts
```

## Voraussetzungen

- Node.js 18+
- Azure Functions Core Tools v4 (`func`)

## Setup

```bash
cd playwright-linkedin-login
npm install
npm run install:browsers
```

Optional `.env` (für Login-Run):

```ini
LINKEDIN_EMAIL=you@example.com
LINKEDIN_PASSWORD=your-password
HEADLESS=true
```

## Session erzeugen

```bash
npm run login
```

Dadurch wird `session/linkedin-session.json` erzeugt.

## Azure Functions lokal starten

```bash
npm run build
npm start
```

HTTP Trigger:
- `runJobsAiHr`
- `runJobsSearch`

## Deployment

1. In Azure eine Function App (Node 20 / Functions v4) erstellen.
2. Session-Datei sicher bereitstellen (z. B. mit Blob + Startup Sync oder Build-Artefakt, je nach Sicherheitsmodell).
3. App Settings setzen:
   - `HEADLESS=true`
   - `SESSION_PATH=session/linkedin-session.json`
   - `OUTPUT_DIR=output`
4. Deploy mit VS Code Azure Extension, `func azure functionapp publish <APP_NAME>` oder CI/CD.

## Hinweis

LinkedIn kann Checkpoints/CAPTCHA erzwingen. In dem Fall muss die Session lokal neu erzeugt werden.
