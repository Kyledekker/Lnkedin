# Playwright LinkedIn Login (TypeScript)

This boilerplate logs into LinkedIn once, stores the authenticated session to disk, and reuses it on subsequent runs without re-entering credentials.

## Prerequisites

- Node.js 18+
- npm

## Setup

```bash
cd playwright-linkedin-login
npm install
npm run install:browsers
```

Create a `.env` file from the example and provide credentials:

```bash
cp .env.example .env
```

`.env` example:

```ini
LINKEDIN_EMAIL=you@example.com
LINKEDIN_PASSWORD=your-password
HEADLESS=true
```

## Usage

### 1) Login and save session

```bash
npm run login
```

This will:
- Open LinkedIn login page
- Sign in using environment variables
- Verify login
- Persist session to `session/linkedin-session.json`

### 2) Reuse saved session

```bash
npm run reuse
```

If the session is valid, you should land in the feed without logging in.

## How it works

Playwright's `storageState` feature persists cookies and local storage to disk. `login.ts` writes the state, and `reuse-session.ts` loads it to authenticate future browser contexts.

## Troubleshooting

- **2FA / CAPTCHA**: LinkedIn may require additional verification. Complete it manually in the login run or disable headless mode with `HEADLESS=false`.
- **Expired session**: If reuse prints `Session expired or invalid`, run `npm run login` again.
- **Selector changes**: LinkedIn may update its markup. Update selectors in `login.ts` and `reuse-session.ts` if needed.
- **Headless issues**: Try `HEADLESS=false` to run in headed mode.
