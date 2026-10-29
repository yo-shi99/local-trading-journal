# Trade Detail management (v1.13.0)

## Screens and navigation

- Calendar → Daily / Weekly: realized performance and Entry cohorts, not inline trade editors.
- Trade List / period cards → dedicated Trade Detail. Detail shows Entry, Entry analysis, event history, resolved result, Exit review/analysis, and images.
- New Trade reuses the Entry/analysis form and unified import. Successful save opens Trade Detail.
- Detail → Entry/analysis manual editor or an event editor. Append import and targeted edit are separate operations.
- Every Detail / editor adds at most one history state per session. Back and Cancel discard unconfirmed drafts without a dialog. Closing the nested editor returns to Detail; closing Detail restores its origin. No infinite push or unload interception.
- Legacy untyped Entry import remains supported for backward compatibility; explicit update types are still rejected by the New Trade flow.

## Result and reporting

`getResolvedTradeState` retains Summary → events → legacy priority. For all three, a valid Closed result is derived from finite final realized PnL: positive Win, negative Loss, exact zero BE. Open / Invalid have no final result. Stored historical result labels remain untouched and are informational only.

Daily / Weekly `getPeriodTradeStats` separates:

1. Realized PnL booked during the period (including partial exits of trades still Open).
2. Closed Trades, Wins / Losses / BE and average win/loss / profit factor: trades whose final resolved exit datetime falls inside the period. These final trade statistics use the entire trade's final PnL, including partial realizations booked earlier.
3. Entries: trades whose initial explicit Entry datetime (or legacy Entry baseline) falls inside the period. An Add Entry does not count as a new trade Entry.

Thus period realized PnL and the sum of final results of the period's Closed Trades can differ legitimately. Period cards list the actual booking dates. Invalid histories do not contribute realized/closed statistics, but remain accessible through their Entry cohort or Trade List.

## Targeted edits and deletion

- `tradeMutationCandidate` is pure. `mutateTradeHistory` reads the latest record, compares the preview revision, then writes one replacement in a single IndexedDB readwrite transaction. Failure/abort leaves DB and in-memory cache unchanged.
- Event editing fixes the target ID/type. It replaces the same event, never appends a new ID. Pasted text must match the target type (Entry ↔ New Entry); fields and text share the same draft and explicit preview/confirmation.
- Hand edits invalidate the preview. Edited raw text must be parsed before confirming. Original Entry analysis/raw/images are untouched by Exit edits; Entry edits explicitly change Entry fields only.
- Add Entry / Partial TP / Partial SL / Final Exit can be deleted after confirmation. Deletion recalculates state; it may reopen the trade or expose Invalid. No quantity correction is performed.
- Entry events and Final Summary cannot be deleted. An existing Summary can be edited without releasing its summary mode or inventing events. Historical events remain preserved, and their PnL is not added to the summary total.
- Structurally invalid edits are rejected. A structurally valid change that introduces quantity inconsistency is shown as Invalid in the preview and saved without guessing corrections, allowing the user to repair historical facts.
- Explicit Entry event quantity/price/datetime remain event-owned; the analysis form makes the corresponding snapshot fields read-only. Entry-date calendar markers and list dates are derived from the initial explicit event.
- Entry Analysis and legacy images remain manually editable using the shared Entry form. A legacy trade is never converted into events automatically.

## Storage and PWA

No schema or backup envelope changes: IndexedDB DB5, backup v10. Existing optional metadata, Blob images, categories, rawText and unknown properties survive event edits. No migration, store deletion, or DB reset.

PWA 1.13.0 caches the added static scripts. The existing wait-until-clients-close activation and cache-prefix cleanup policy remains unchanged. IndexedDB and image Blobs are not Service Worker cache entries.

## Verification

375 assertions/scenarios passed across 19 Node/Chromium suites (324 existing + 51 new). `tests/trade-management-unit.cjs` adds 26 cases; `tests/trade-management.cjs` adds 25 browser cases. The final review adds 10 cases covering cross-day/cross-week accounting, Summary/Legacy booking, the realistic stored-Win inconsistency, and partial-event deletion. Existing UI tests follow the new Detail destination and retain their storage/Blob/import assertions. PWA tests also perform an atomic event edit offline and verify persistence.

With Playwright/Chromium available, serve the repository over HTTP and run each `tests/*.cjs` script with `JOURNAL_TEST_URL` set to that server. `tests/pwa.cjs` creates its own server at the repository subpath. Tests use isolated synthetic data only; Android standalone hardware is not exercised.

## Final accounting rules

- Full History realized PnL is booked separately for each Partial TP / Partial SL / Final Exit at its event datetime. The cumulative trade total is never booked a second time on the final exit date.
- Summary books the entire `finalSummary.realizedPnl` on its summary exit date. Retained historical events are ignored for Summary financial reporting.
- Legacy books the entire legacy realized PnL on its legacy exit date.
- Closed Trades / Wins / Losses / BE use the final close date (and corresponding week). The result uses the complete final trade PnL, not just the PnL of that day's final event. Entries use the initial Entry date independently.

| Date | Event PnL | Closed Trades | Wins | Losses | BE |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-10-26 (Partial SL) | -2 | 0 | 0 | 0 | 0 |
| 2026-10-27 (Final Exit) | +1 | 1 | 0 | 1 | 0 |

The trade total is -1 / Loss. The same rule applies across week boundaries. The final day's +1 is not replaced by, or added to, the cumulative -1.

The realistic Short example (legacy Entry .01 @ 80210; Partial SL .005 / -2.1595; Add Entry .005; Final Exit .01 / +.8105) resolves to Closed / -1.349 / Loss. Stored `result: Win` labels are retained unchanged; Detail, List, period summaries, calendar PnL and aggregate statistics use the resolved state.
