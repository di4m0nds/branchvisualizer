# BranchVisualizer — Legal & Compliance

This document is the canonical source of truth for BranchVisualizer's legal policies.  
The same content is rendered in-app via `src/components/LegalPage.tsx`.

---

## Table of Contents

1. [Privacy Policy](#1-privacy-policy)
2. [Terms of Use](#2-terms-of-use)
3. [Storage & Cookie Policy](#3-storage--cookie-policy)
4. [First-Visit Acceptance Modal](#4-first-visit-acceptance-modal)
5. [Implementation Notes](#5-implementation-notes)

---

## 1. Privacy Policy

**Last updated:** April 2025

### Overview

BranchVisualizer is a purely client-side application. It runs entirely in your browser and has no backend server. We do not collect, store, or transmit any personal data to our own systems.

### Data We Do Not Collect

- Your name, email address, or any personally identifying information  
- Usage analytics, crash reports, or telemetry of any kind  
- IP addresses or device fingerprints  
- Browsing history or behaviour outside of this application  

### GitHub API Requests

When you load a repository, BranchVisualizer makes requests directly from your browser to the **GitHub REST API v3** (`https://api.github.com`). These requests are governed by [GitHub's Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). We have no control over or visibility into those requests.

### GitHub Personal Access Token

You may optionally provide a GitHub Personal Access Token (PAT) to increase API rate limits. If you do:

- The token is held **in browser memory only** for the duration of your session.
- It is sent exclusively to `https://api.github.com` as a Bearer token in request headers.
- It is never written to `localStorage`, `sessionStorage`, or any cookie.
- It is cleared automatically when you close or refresh the tab.

We strongly recommend using a **fine-grained token** scoped to public repository read access only.

### Local Storage

BranchVisualizer writes two types of data to your browser's `localStorage`:

- **API response cache** — GitHub API responses are cached with a time-to-live (TTL) of 5 minutes to reduce redundant network requests and respect GitHub's rate limits. This data contains only public commit/branch metadata that GitHub already serves publicly.
- **Policy acceptance flag** — A single key (`bv:legal:accepted`) records that you have read and accepted these policies so the welcome modal is not shown on subsequent visits.

You can clear all BranchVisualizer data at any time through your browser's developer tools or "Clear site data" feature.

### Third-Party Services

BranchVisualizer communicates only with `api.github.com`. No third-party analytics, advertising, or tracking services are used.

### Changes to This Policy

If this policy changes materially, the "Last updated" date will be revised and this file updated accordingly.

---

## 2. Terms of Use

**Last updated:** April 2025

### Acceptance of Terms

By using BranchVisualizer you agree to these Terms of Use. If you do not agree, please do not use the application.

### Description of Service

BranchVisualizer is an open-source, browser-based tool that renders interactive commit graphs for public GitHub repositories using the GitHub REST API. It is provided free of charge, without warranty, for personal and professional use.

### Use of the GitHub API

BranchVisualizer accesses GitHub's public API on your behalf. By using this application you agree to comply with [GitHub's Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) and [GitHub's API Rate Limits](https://docs.github.com/en/rest/overview/rate-limits-for-the-rest-api). Specifically:

- Unauthenticated requests are limited to **60 per hour per IP** address by GitHub.
- Authenticated requests (with a PAT) are limited to **5,000 per hour per user** by GitHub.
- You must not use BranchVisualizer to circumvent or abuse GitHub's rate limits.
- You must not use BranchVisualizer to access private repositories without authorisation.

### Acceptable Use

You agree not to use BranchVisualizer to:

- Violate any applicable law or regulation  
- Scrape or harvest data from GitHub in violation of their terms  
- Interfere with GitHub's services or infrastructure  
- Reproduce, distribute, or sublicense the application in violation of its open-source licence  

### Intellectual Property

BranchVisualizer is open-source software. Repository data displayed within the application belongs to its respective owners and is retrieved via GitHub's public API under GitHub's terms.

### Disclaimer of Warranties

BranchVisualizer is provided **"as is"** without warranty of any kind, express or implied. Commit graphs are generated from data returned by the GitHub API and may not reflect the complete history of a repository (see `MAX_COMMITS_PER_BRANCH` and `MAX_BRANCHES` constants in `src/lib/github.ts`).

### Limitation of Liability

To the fullest extent permitted by law, the authors of BranchVisualizer shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the application.

### Changes to Terms

These terms may be updated at any time. Continued use of BranchVisualizer after changes are posted constitutes acceptance of the new terms.

---

## 3. Storage & Cookie Policy

**Last updated:** April 2025

### Cookies

BranchVisualizer does **not** use browser cookies. No cookie is set, read, or transmitted by this application.

### Local Storage

BranchVisualizer uses the browser's `localStorage` API to store lightweight data on your device. Local storage data never leaves your browser and is not accessible to any third party.

#### What is stored

| Key | Purpose | Lifetime |
|-----|---------|----------|
| `bv:legal:accepted` | Records that the user accepted these policies | Persistent (until manually cleared) |
| `api:<endpoint-path>` | Cached GitHub API response + timestamp | Auto-expires after 5 minutes (TTL) |

#### What is not stored

- Your GitHub Personal Access Token (kept in memory only, never persisted)
- Any personally identifying information
- Any data from repositories you did not explicitly load

### How to Clear Stored Data

| Browser | Steps |
|---------|-------|
| **Chrome / Edge** | DevTools → Application → Storage → Local Storage → right-click origin → Clear |
| **Firefox** | DevTools → Storage → Local Storage → right-click origin → Delete All |
| **Safari** | Preferences → Privacy → Manage Website Data → search for site → Remove |

Clearing local storage will remove the policy acceptance flag, so the welcome modal will appear again on your next visit.

---

## 4. First-Visit Acceptance Modal

On a user's first visit, a modal is shown that:

1. Summarises the key data-handling commitments (no collection, GitHub API only, token in memory, local storage cache).
2. Provides links to the full Privacy Policy, Terms of Use, and Storage & Cookie Policy pages.
3. Requires the user to click **Accept & Continue** before using the application.

On acceptance, `bv:legal:accepted = "1"` is written to `localStorage`. On subsequent visits this flag is checked at mount time (`hasAcceptedPolicy()` in `src/components/PolicyModal.tsx`) and the modal is skipped.

---

## 5. Implementation Notes

| Concern | File | Detail |
|---------|------|--------|
| Acceptance check & flag | `src/components/PolicyModal.tsx` | `hasAcceptedPolicy()` / `markPolicyAccepted()` |
| Policy pages (tabbed) | `src/components/LegalPage.tsx` | Tabs: privacy · terms · cookies |
| In-app access | `src/App.tsx` | **Legal** button in header + footer links |
| Styles | `src/index.css` | `.policy-*`, `.legal-*`, `.app-footer`, `.header-legal-btn` |
| localStorage key | `src/components/PolicyModal.tsx` | `bv:legal:accepted` |
| API cache keys | `src/lib/cache.ts` | Prefixed `api:*`, 5-minute TTL |

> **Updating policy content:** Edit the `*Content()` functions inside `src/components/LegalPage.tsx` and mirror any material changes to the corresponding sections in this file. Update the "Last updated" dates in both places.
