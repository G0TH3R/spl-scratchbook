# SPL Scratchbook Operations Runbook

## Purpose

Build, deploy, verify, and roll back the `spl_scratchbook` app on Splunk DevBox without exposing credentials or retaining sensitive search results.

## Source of truth

- App source: repository root
- Tests and packager: `tools/`
- Generated package: `dist/spl_scratchbook-1.0.2.tgz`
- Live target: `/opt/splunk/etc/apps/spl_scratchbook`
- Live route: `/en-US/app/spl_scratchbook/scratchbook`
- Legacy app: `/opt/splunk/etc/apps/splunk_search_notebook`

## Build and validate

```bash
node tools/test_spl_scratchbook.js
python3 tools/verify_and_package.py
shasum -a 256 dist/spl_scratchbook-1.0.2.tgz
tar -tzf dist/spl_scratchbook-1.0.2.tgz
```

Required evidence:

- Node unit checks pass.
- XML, app identity, and static asset contracts pass.
- Secret scan passes.
- Package root is exactly `spl_scratchbook/`.
- Package checksum is recorded before transfer.

## Preflight

1. Confirm `Splunkd.service` is active and runs as `splunk`.
2. Confirm non-interactive SSH and approved sudo through the `splunk-box` alias.
3. Read the currently installed legacy/new versions.
4. Confirm sufficient disk space.
5. Create rollback storage under `/opt/splunk-upgrade-backups/`, never under `etc/apps`.

## Rename deployment sequence

1. Upload the validated package to `/tmp`.
2. Verify the remote checksum before extraction.
3. Stage and parse the candidate app outside the live app tree.
4. Back up both `splunk_search_notebook` and `spl_scratchbook` if present.
5. Install `spl_scratchbook`, normalize `splunk:splunk` ownership and file modes, and restart with `systemctl restart Splunkd`.
6. Verify the new app before removing the legacy app.
7. Remove `splunk_search_notebook` only after the new route, static assets, formatter contract, and bounded SPL succeed.
8. Restart once more after legacy removal and repeat health checks.

## Verification ladder

1. `systemctl is-active Splunkd` returns `active`.
2. Live `app.conf` reports app ID `spl_scratchbook`, version `1.0.2`, and visible state.
3. The protected scratchbook route returns the expected unauthenticated `303` redirect.
4. Versioned JavaScript and CSS routes return `200`.
5. Local and live hashes match for app configuration, view, JavaScript, and CSS.
6. A bounded `makeresults` SPL executes through Splunk MCP.
7. Recent logs contain no `ERROR` or `WARN` entries naming `spl_scratchbook`.
8. In an authenticated browser, verify:
   - the SPL textarea is visible;
   - Run formats a one-line pipeline into multiple lines;
   - quoted pipes are preserved;
   - triple-backtick comments containing pipes are preserved and cannot bypass risky-command confirmation;
   - Collapse Cell hides editor, controls, status, and results while showing a compact SPL preview;
   - Expand Cell restores the full cell and its retained results;
   - time presets update the dispatched earliest/latest range;
   - cancelling a cell settles Run all even if Splunk emits no cancellation callback;
   - moving or removing cells during Run all does not duplicate or skip the original snapshot unexpectedly;
   - legacy browser cells appear when no new scratchbook state exists.

## Rollback

If the new app fails startup, search, asset, or authenticated rendering verification:

1. Remove the failed `spl_scratchbook` directory.
2. Restore its backup if it existed before the change.
3. Restore `splunk_search_notebook` from the same change backup if it was removed.
4. Restore `splunk:splunk` ownership.
5. Restart `Splunkd.service`.
6. Repeat route, bounded SPL, log, and authenticated rendering checks.

## Safety

- Never place Splunk passwords, MCP/HEC tokens, cookies, or bearer headers in commands, docs, packages, or reports.
- Do not store raw event payloads in deployment evidence.
- Treat scheduler health separately from app health; an existing Search Lag red indicator is not evidence that SPL Scratchbook failed.