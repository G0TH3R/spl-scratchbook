# SPL Scratchbook

SPL Scratchbook is a standalone Splunk Enterprise app for building, formatting, running, and comparing multiple independent SPL searches on one page. It keeps each search beside its results so exploratory work does not require a growing set of Search & Reporting tabs.

## Capabilities

- Stack up to 20 independent SPL cells.
- Add cells above or below the current search.
- Run or cancel one cell, or run all cells sequentially.
- Automatically format SPL into one pipeline command per line before dispatch.
- Preserve quoted pipe characters such as `eval value="left|right"` during formatting.
- Collapse the entire Search Cell into a compact row with a truncated SPL preview; expand it to restore the editor, controls, status, and results.
- Duplicate, reorder, clear, or remove cells.
- Use Splunk-style time presets or a custom earliest/latest range.
- Limit displayed results to 50, 100, 250, 500, or 1,000 rows.
- Keep session state in the current browser tab, with opt-in browser-local persistence.
- Migrate browser state from the former `splunk_search_notebook` app identity.
- Confirm potentially mutating or action-triggering SPL before dispatch.

## Keyboard shortcuts

| Shortcut | Behavior |
|---|---|
| `Cmd+Enter` / `Ctrl+Enter` | Format and run the current cell |
| `Shift+Enter` | Format and run, then focus the next cell or create one |

## Time presets

- Last 15 minutes
- Last 60 minutes
- Last 4 hours
- Last 24 hours
- Last 7 days
- Today
- Yesterday
- All time
- Custom earliest/latest values

The selected preset is converted to explicit `earliest_time` and `latest_time` settings on the SplunkJS `SearchManager`.

## SPL formatting behavior

Formatting occurs immediately before a cell is dispatched. Top-level pipe commands are placed on separate lines:

```spl
index=main
| stats count by host
| where count > 1
```

Pipes inside single- or double-quoted strings are preserved. Formatting is idempotent: running an already formatted search does not keep changing it. The formatter intentionally does not rewrite command arguments, field names, quoting, macros, or search semantics.

## Architecture

- App ID: `spl_scratchbook`
- Display label: `SPL Scratchbook`
- View: `scratchbook`
- Route: `/en-US/app/spl_scratchbook/scratchbook`
- Framework: Classic Simple XML 1.1 with a JavaScript extension
- Search execution: SplunkJS MVC `SearchManager`
- Result rendering: safe DOM construction with `textContent`; no raw search values are injected through `innerHTML`
- Theme: Splunk 10.4 Search & Reporting-inspired light surfaces and Splunk green controls
- Static assets are versioned to prevent stale browser cache reuse.
- The redundant generated dashboard title/description header is suppressed; the compact in-app toolbar remains.
- Search callbacks are generation-scoped so cancelled jobs cannot overwrite a newer run.

## Browser persistence

Search text, cell order, time settings, row limits, and collapsed state are stored in `sessionStorage`. Selecting **Remember search text on this browser** also stores the same state in `localStorage`. Search results are never persisted.

On first load, SPL Scratchbook checks the legacy `splunk_search_notebook` storage keys if no new state exists. After successful migration, legacy keys are removed so stale cells cannot reappear in a later tab. Disabling persistence and resetting the scratchbook also clear both old and new keys.

## Security model

- Searches execute as the signed-in Splunk user and remain subject to role capabilities, quotas, and command restrictions.
- Commands including `collect`, `delete`, `dump`, `map`, `mcollect`, `meventcollect`, `outputcsv`, `outputlookup`, `run`, `sendalert`, `sendemail`, `runshellscript`, `script`, and `tscollect` require confirmation before dispatch. Detection is pipeline-, quote-, and triple-backtick-comment-aware so comments cannot bypass confirmation and command-like text inside strings does not trigger a false warning.
- The displayed-row limit bounds browser rendering; it does not rewrite or limit the underlying SPL search job.
- No credentials, tokens, session identifiers, or event payloads are shipped with the app.

## Compatibility

Developed and validated against Splunk Enterprise 10.4.1. The app uses the Classic Simple XML and SplunkJS stack available in Splunk Enterprise 10.4. It is not an HTML dashboard conversion and does not require external JavaScript, fonts, or network assets.

## Source layout

```text
.
├── appserver/static/css/spl_scratchbook_102.css
├── appserver/static/js/spl_scratchbook_102.js
├── default/app.conf
├── default/data/ui/nav/default.xml
├── default/data/ui/views/scratchbook.xml
├── metadata/default.meta
├── CHANGELOG.md
├── runbooks/deployment.md
├── tools/test_spl_scratchbook.js
├── tools/verify_and_package.py
└── README.md
```

## Build, test, and package

From the repository root:

```bash
node tools/test_spl_scratchbook.js
python3 tools/verify_and_package.py
```

The verifier checks app identity, XML, JavaScript syntax, formatter and state tests, safe result rendering, Splunk-native visual tokens, embedded secrets, deterministic archive metadata, and package inventory.

Output:

```text
dist/spl_scratchbook-1.0.2.tgz
```

Generated packages and verification reports are local build artifacts and are excluded from Git.

## Deployment and rollback

Use [`runbooks/deployment.md`](runbooks/deployment.md) for the approved DevBox deployment, migration, verification, and rollback procedure.

## Current limitations

- One scratchbook per browser profile rather than named server-side notebooks.
- Results are rendered as tables only.
- Formatting is pipeline-oriented; it does not implement a full SPL parser or opinionated command indentation.
- The app does not save searches as Splunk knowledge objects.