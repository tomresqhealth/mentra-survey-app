---
name: mentra-docs
description: >
  Loads MentraOS Cloud documentation intelligently at the start of every session involving a Mentra
  project. Checks GitHub releases to determine if docs need refreshing — only re-fetches the full
  documentation when a new version has been released. Use this skill whenever the user is working on
  a MentraOS miniapp, mentions Mentra, mentraOS, mentra.glass, miniapps for smart glasses, or
  references any Mentra SDK/API concepts. Also trigger when the workspace contains mentra-related
  files (e.g., porter.yaml, mentra config files, or packages from mentra). This skill MUST run
  before any coding, debugging, or architecture work on a Mentra project begins — it grounds the
  session in the latest official docs.
---

# MentraOS Documentation Loader

This skill ensures Claude has up-to-date MentraOS Cloud documentation loaded before doing any work
on a Mentra project. Rather than fetching the entire 370K+ character docs file every session, it
checks GitHub for new releases and only re-fetches when something has changed.

## When this skill activates

Run this skill at the **very start** of any session where:
- The user mentions Mentra, mentraOS, miniapps, or smart glasses development
- The workspace is a Mentra project (look for `porter.yaml`, mentra-related packages, or `mentra` in `package.json`)
- The user asks about MentraOS APIs, SDKs, or cloud services

## Step 1: Check for updates on GitHub

Use Chrome (preferred) or WebFetch to check the latest release:

1. Navigate to `https://github.com/Mentra-Community/MentraOS/releases`
2. Extract the latest release version tag (e.g., `v2.9`) and its changelog text
3. Read the local version file at `docs/.mentra-docs-version` in the project root

**Compare versions:**
- If the file doesn't exist → this is a first fetch, go to Step 2
- If the GitHub version matches the cached version → skip to Step 3 (use local cache)
- If the GitHub version is newer → go to Step 2 (re-fetch docs)

## Step 2: Fetch fresh documentation

Only run this step when a new version has been detected (or no local cache exists).

### Method A: Chrome browser fetch (preferred)

If Claude in Chrome is connected:

1. Navigate to `https://cloud-docs.mentra.glass/llms-full.txt`
2. Use JavaScript to trigger a download:
   ```javascript
   const blob = new Blob([document.body.innerText], {type:'text/plain'});
   const a = document.createElement('a');
   a.href = URL.createObjectURL(blob);
   a.download = 'llms-full.txt';
   a.click();
   ```
3. Mount `~/Downloads` via `request_cowork_directory` (if not already mounted)
4. Copy the downloaded file to `docs/llms-full.txt` in the project
5. Write the new version tag to `docs/.mentra-docs-version` (e.g., just the string `v2.9`)

### Method B: WebFetch

If Chrome is not available:
```
WebFetch: url="https://cloud-docs.mentra.glass/llms-full.txt"
```
Save the content to `docs/llms-full.txt` and update `docs/.mentra-docs-version`.

### Method C: Ask the user

If all remote methods fail:

> I detected a new MentraOS release (vX.X) but couldn't fetch the updated docs automatically.
> Could you download the latest from https://cloud-docs.mentra.glass/llms-full.txt and save it
> as `docs/llms-full.txt` in your project?

## Step 3: Load docs into context

Once you have confirmed docs are up to date (either freshly fetched or cache is current):

1. Read `docs/llms-full.txt` — but be smart about it. Rather than loading the entire 15,000+ line
   file, read the section headers first (lines starting with `# `) to build a table of contents,
   then load only the sections relevant to the user's current task.

2. If the user's task is unclear or broad, load these key sections by default:
   - API Reference (overview, authentication, message formats)
   - The SDK Manager relevant to their task (e.g., DashboardManager, AudioManager)
   - Getting Started with the SDK
   - App Model

3. You can always load additional sections later as the conversation evolves.

## Step 4: Brief the user

Tell the user:
- Which MentraOS version the docs correspond to (from `docs/.mentra-docs-version`)
- Whether you fetched fresh docs or used the cache
- If there was a new release, briefly summarize what changed based on the GitHub release changelog
- Which doc sections you've loaded and that you can pull in more as needed

Then proceed with their request, referencing the documentation throughout the session.

## Key URLs

- **Docs (LLM-friendly):** https://cloud-docs.mentra.glass/llms-full.txt
- **GitHub releases:** https://github.com/Mentra-Community/MentraOS/releases
- **Full docs site:** https://cloud-docs.mentra.glass
- **SDK docs:** https://docs.mentra.glass
- **Developer console:** https://console.mentra.glass
