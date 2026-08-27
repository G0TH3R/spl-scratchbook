"use strict";

const assert = require("node:assert/strict");
const notebook = require("../appserver/static/js/spl_scratchbook_102.js");

assert.equal(notebook.APP_ID, "spl_scratchbook");
assert.equal(notebook.MAX_CELLS, 20);

const blank = notebook.normalizeState(null);
assert.equal(blank.cells.length, 1);
assert.equal(blank.cells[0].earliest, "-24h");
assert.equal(blank.cells[0].latest, "now");
assert.equal(blank.cells[0].rowLimit, 100);
assert.equal(blank.cells[0].timePreset, "last_24h");
assert.equal(blank.cells[0].collapsed, false);

assert.deepEqual(notebook.presetRange("last_15m"), { earliest: "-15m", latest: "now" });
assert.deepEqual(notebook.presetRange("yesterday"), { earliest: "-1d@d", latest: "@d" });
assert.equal(notebook.presetRange("custom"), null);
assert.equal(notebook.inferTimePreset("-4h", "now"), "last_4h");
assert.equal(notebook.inferTimePreset("-13m", "now"), "custom");

assert.equal(
  notebook.formatSPL("index=main | stats count by host | where count > 1"),
  "index=main\n| stats count by host\n| where count > 1"
);
assert.equal(
  notebook.formatSPL('| makeresults | eval message="left|right" | table message'),
  '| makeresults\n| eval message="left|right"\n| table message'
);
assert.equal(
  notebook.formatSPL("index=main\n| stats count\n| sort - count"),
  "index=main\n| stats count\n| sort - count"
);

const normalized = notebook.normalizeState({
  remember: true,
  cells: [
    { id: "same", query: "| makeresults", earliest: " -15m ", latest: " now ", rowLimit: 500, collapsed: true },
    { id: "same", query: 42, earliest: "", latest: "", rowLimit: 99999 }
  ]
});
assert.equal(normalized.remember, true);
assert.equal(normalized.cells.length, 2);
assert.notEqual(normalized.cells[0].id, normalized.cells[1].id);
assert.equal(normalized.cells[0].earliest, "-15m");
assert.equal(normalized.cells[0].rowLimit, 500);
assert.equal(normalized.cells[0].timePreset, "last_15m");
assert.equal(normalized.cells[0].collapsed, true);
assert.equal(normalized.cells[1].rowLimit, 100);

assert.deepEqual(notebook.detectRiskyCommands("index=main | stats count"), []);
assert.deepEqual(notebook.detectRiskyCommands("index=main | outputlookup demo.csv"), ["outputlookup"]);
assert.deepEqual(notebook.detectRiskyCommands("| makeresults | collect index=summary | sendemail to=x@example.test"), ["collect", "sendemail"]);
assert.deepEqual(notebook.detectRiskyCommands("| eval note=\"outputlookup is text\""), []);
assert.deepEqual(notebook.detectRiskyCommands('| makeresults | eval note="| outputlookup demo.csv"'), []);
assert.deepEqual(notebook.detectRiskyCommands("| makeresults | outputcsv scratch.csv"), ["outputcsv"]);
assert.deepEqual(notebook.detectRiskyCommands("| makeresults | sendalert notable param.test=1"), ["sendalert"]);
for (const command of ["dump", "map", "mcollect", "meventcollect", "run"]) {
  assert.deepEqual(notebook.detectRiskyCommands("| makeresults | " + command + " example"), [command]);
}
assert.deepEqual(
  notebook.detectRiskyCommands("| makeresults | ```reviewed comment``` outputlookup bypass.csv"),
  ["outputlookup"]
);
assert.deepEqual(
  notebook.detectRiskyCommands("| makeresults | ```comment with | outputlookup fake.csv``` stats count"),
  []
);
assert.equal(
  notebook.formatSPL("| makeresults | ```comment with | a pipe``` stats count | where count > 0"),
  "| makeresults\n| ```comment with | a pipe``` stats count\n| where count > 0"
);

const migratedSession = notebook.selectStoredState(null, null, null, { cells: [{ id: "legacy", query: "index=legacy" }] });
assert.equal(migratedSession.migratedLegacy, true);
assert.equal(migratedSession.state.cells[0].query, "index=legacy");
const currentSession = notebook.selectStoredState(null, { cells: [{ id: "current", query: "index=current" }] }, { remember: true, cells: [{ id: "old", query: "index=old" }] }, null);
assert.equal(currentSession.migratedLegacy, false);
assert.equal(currentSession.state.cells[0].query, "index=current");

assert.equal(notebook.isCurrentRun({ runToken: "run-1" }, "run-1"), true);
assert.equal(notebook.isCurrentRun({ runToken: "run-2" }, "run-1"), false);
assert.equal(notebook.isCurrentRun(null, "run-1"), false);

const mutableCells = [{ id: "one" }, { id: "two" }, { id: "three" }];
const cellSnapshot = notebook.snapshotCellIds(mutableCells);
mutableCells.reverse();
mutableCells.splice(1, 1);
assert.deepEqual(cellSnapshot, ["one", "two", "three"]);

assert.deepEqual(
  notebook.rowsFromResultsData({ fields: [{ name: "host" }, "count"], rows: [["server-1", "2"]] }),
  { fields: ["host", "count"], rows: [["server-1", "2"]] }
);

const capped = notebook.normalizeState({ cells: Array.from({ length: 25 }, (_, index) => ({ id: "c" + index, query: "| makeresults" })) });
assert.equal(capped.cells.length, 20);

console.log("spl_scratchbook.js unit checks passed");
