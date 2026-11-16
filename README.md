# Atom parity

Checks whether Atom components in Storybook still match the Figma library, and publishes a report anyone can open. It runs on its own every weekday night. Nobody needs to install anything or write code.

**Reports:** https://walecalfos-dp.github.io/atom-parity

## For designers

Everything happens on **https://walecalfos-dp.github.io/atom-parity**.

**Run a check.** Paste a Figma link (right-click a component page in Figma › **Copy link to page**, or use the whole library's link) and the Storybook link. Add a name if you like, then click **Run check**. Progress shows on the page, and the report appears in about 5–10 minutes. The check is saved and runs again every weekday night.

**Re-run or remove a check.** Use the ↻ and bin buttons next to it.

**Read a report.** Click a check. It shows a score, a short summary, what needs attention most, and every component with a status:

- **Aligned**: matches Figma.
- **Drifted**: works, but names, properties or tokens differ from Figma.
- **Broken**: something people would notice.
- **Not built**: in Figma, with no Storybook component.

Open a component to see each issue, who should fix it (design, dev, or both), and Figma and code side by side.

**First time in a browser: add an access key.** Running checks needs one. Reading reports doesn't.

1. Click **Access key** on the page.
2. Follow the three steps it shows: create a GitHub fine-grained token for the atom-parity repository with **Actions: Read and write**.
3. Paste the token. It stays in that browser only.

### Add token names (optional, every few weeks)

Figma's Pro plan doesn't let outside tools read variable names, so the nightly check compares token *values* but can't name the token. To include token names and every brand's values:

1. In Figma, run **Plugins → Development → Atom Parity Exporter** on the Component Library.
2. Click **Scan file**, then **Export snapshot**, then **Download figma-manifest.json**.
3. On GitHub, open the repository's **parity** folder → **Add file → Upload files**. Drop the file in and click **Commit changes**. It replaces the old snapshot.

The report says when this snapshot is out of date.

## One-time setup (already done for Atom)

1. Create a GitHub repository and push this folder to it.
2. In Figma: **Settings → Security → Personal access tokens → Generate new token**, with the scope **File content: Read-only**. Add it to the repository as the Actions secret `FIGMA_TOKEN`.
3. Repository **Settings → Pages → Source: GitHub Actions**.
4. Repository **Settings → Actions → General → Workflow permissions → Read and write**.

When the Figma token expires, the report shows "Figma refused the request". Make a new token and replace the secret.

## What it checks

| Area | Compares |
|---|---|
| Naming | Component, property and value names, 1:1. Also flags retired terms (`error` is now `danger`). |
| Properties | Figma variant properties and values against Storybook props, defaults, and code-only props |
| Tokens | The CSS variable code actually uses, traced through `var()`, against the Figma variable and its value per brand |
| Visual | The Figma render against the Storybook screenshot, pixel by pixel, plus height and width |
| Accessibility | axe-core WCAG 2.2 AA in every brand. Contrast and target size go to design; the rest go to dev. |
| Interaction | Keyboard reachability, visible focus indicator, hover style, 24px touch target |
| Rendering | Stories that crash or log errors |

## Settings (`atom-parity.config.json`)

| Key | Purpose |
|---|---|
| `brands.map` | Figma brand name → Storybook `biz` value, when they're spelled differently (AeroBlue is `areo-blue` in code) |
| `brands.figmaBrands` | Figma brand names to check when no plugin snapshot is available |
| `components.aliases` | Pair differently named components so their other checks still run. The naming check still fails, on purpose. |
| `props.map` | Known value renames, e.g. Button Size "Regular" is `middle` |
| `tokens.patterns` | Known token renames, e.g. `space-24` is `--aum-spacing-24`. They're reported as "named differently" and their values are compared. |
| `visual.thresholds` | How much pixel difference counts as a warning or a failure |

Saved checks live in `checks.json`.

## Limits

- Automated accessibility checks catch about a third of WCAG issues, so manual screen-reader reviews are still needed.
- Figma and browsers draw text slightly differently, so a few percent of pixel difference is normal.
- Without a plugin snapshot, visuals and token values are checked for the default brand (Dragonpass) only. Accessibility and behaviour are still checked in every brand.

## Development

```
npm install && npx playwright install chromium
node src/cli.js run-all                      # every saved check → parity-site/
node src/cli.js add-check --name X --figma-url <link> --storybook <link>
npm test                                     # needs the fixture Storybook: cd test/sb && npm i && npx storybook build -o storybook-static
```
