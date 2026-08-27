/* SPL Scratchbook 1.0.2: fully collapsible Search Cells. */
(function (root) {
  "use strict";

  const APP_ID = "spl_scratchbook";
  const LEGACY_APP_ID = "splunk_search_notebook";
  const STATE_VERSION = 1;
  const SESSION_KEY = APP_ID + ".session.v" + STATE_VERSION;
  const LOCAL_KEY = APP_ID + ".local.v" + STATE_VERSION;
  const LEGACY_SESSION_KEY = LEGACY_APP_ID + ".session.v" + STATE_VERSION;
  const LEGACY_LOCAL_KEY = LEGACY_APP_ID + ".local.v" + STATE_VERSION;
  const MAX_CELLS = 20;
  const ALLOWED_ROW_LIMITS = [50, 100, 250, 500, 1000];
  const TIME_PRESETS = Object.freeze({
    last_15m: { label: "Last 15 minutes", earliest: "-15m", latest: "now" },
    last_60m: { label: "Last 60 minutes", earliest: "-60m", latest: "now" },
    last_4h: { label: "Last 4 hours", earliest: "-4h", latest: "now" },
    last_24h: { label: "Last 24 hours", earliest: "-24h", latest: "now" },
    last_7d: { label: "Last 7 days", earliest: "-7d@d", latest: "now" },
    today: { label: "Today", earliest: "@d", latest: "now" },
    yesterday: { label: "Yesterday", earliest: "-1d@d", latest: "@d" },
    all_time: { label: "All time", earliest: "0", latest: "now" }
  });
  const DEFAULT_QUERY = '| makeresults | eval message="Welcome to SPL Scratchbook", next_step="Replace this SPL and press Shift+Enter" | table message next_step';
  const RISKY_COMMANDS = ["collect", "delete", "dump", "map", "mcollect", "meventcollect", "outputcsv", "outputlookup", "run", "sendalert", "sendemail", "runshellscript", "script", "tscollect"];

  function uid() {
    return "cell_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  }

  function presetRange(name) {
    const preset = TIME_PRESETS[name];
    return preset ? { earliest: preset.earliest, latest: preset.latest } : null;
  }

  function inferTimePreset(earliest, latest) {
    const from = String(earliest || "").trim();
    const to = String(latest || "").trim();
    const match = Object.entries(TIME_PRESETS).find((entry) => entry[1].earliest === from && entry[1].latest === to);
    return match ? match[0] : "custom";
  }

  function splitSPLPipeline(search) {
    const text = String(search || "").trim();
    if (!text) return [];
    const segments = [];
    let current = "";
    let quote = null;
    let escaped = false;
    let inComment = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!quote && text.slice(index, index + 3) === "```") {
        current += "```";
        inComment = !inComment;
        index += 2;
        continue;
      }
      if (inComment) {
        current += character;
        continue;
      }
      if (escaped) {
        current += character;
        escaped = false;
        continue;
      }
      if (quote && character === "\\") {
        current += character;
        escaped = true;
        continue;
      }
      if (quote) {
        current += character;
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        current += character;
        continue;
      }
      if (character === "|") {
        const beforePipe = current.trim();
        if (beforePipe) segments.push(beforePipe);
        current = "|";
        continue;
      }
      current += character;
    }
    const finalSegment = current.trim();
    if (finalSegment) segments.push(finalSegment);
    return segments;
  }

  function formatSPL(search) {
    return splitSPLPipeline(search)
      .map((segment) => segment.startsWith("|") ? "| " + segment.slice(1).trim() : segment)
      .join("\n");
  }

  function stripSPLComments(search) {
    const text = String(search || "");
    let output = "";
    let quote = null;
    let escaped = false;
    let inComment = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (!quote && text.slice(index, index + 3) === "```") {
        if (!inComment) output += " ";
        inComment = !inComment;
        index += 2;
        continue;
      }
      if (inComment) continue;
      if (escaped) {
        output += character;
        escaped = false;
        continue;
      }
      if (quote && character === "\\") {
        output += character;
        escaped = true;
        continue;
      }
      if (quote) {
        output += character;
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      output += character;
    }
    return output;
  }

  function newCell(query) {
    return {
      id: uid(),
      query: typeof query === "string" ? query : DEFAULT_QUERY,
      earliest: "-24h",
      latest: "now",
      rowLimit: 100,
      timePreset: "last_24h",
      collapsed: false
    };
  }

  function normalizeCell(value, seen) {
    const input = value && typeof value === "object" ? value : {};
    let id = typeof input.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(input.id) ? input.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const parsedLimit = Number.parseInt(input.rowLimit, 10);
    let earliest = typeof input.earliest === "string" && input.earliest.trim() ? input.earliest.trim().slice(0, 80) : "-24h";
    let latest = typeof input.latest === "string" && input.latest.trim() ? input.latest.trim().slice(0, 80) : "now";
    let timePreset = typeof input.timePreset === "string" && (input.timePreset === "custom" || TIME_PRESETS[input.timePreset])
      ? input.timePreset
      : inferTimePreset(earliest, latest);
    const preset = presetRange(timePreset);
    if (preset) {
      earliest = preset.earliest;
      latest = preset.latest;
    }
    return {
      id,
      query: typeof input.query === "string" ? input.query.slice(0, 200000) : DEFAULT_QUERY,
      earliest,
      latest,
      rowLimit: ALLOWED_ROW_LIMITS.includes(parsedLimit) ? parsedLimit : 100,
      timePreset,
      collapsed: input.collapsed === true
    };
  }

  function normalizeState(value) {
    const input = value && typeof value === "object" ? value : {};
    const seen = new Set();
    const incoming = Array.isArray(input.cells) ? input.cells.slice(0, MAX_CELLS) : [];
    const cells = incoming.map((cell) => normalizeCell(cell, seen));
    return {
      version: STATE_VERSION,
      remember: input.remember === true,
      cells: cells.length ? cells : [newCell()]
    };
  }

  function selectStoredState(currentLocal, currentSession, legacyLocal, legacySession) {
    if (currentLocal && currentLocal.remember === true) return { state: normalizeState(currentLocal), migratedLegacy: false };
    if (currentSession) return { state: normalizeState(currentSession), migratedLegacy: false };
    if (legacyLocal && legacyLocal.remember === true) return { state: normalizeState(legacyLocal), migratedLegacy: true };
    if (legacySession) return { state: normalizeState(legacySession), migratedLegacy: true };
    return { state: normalizeState(null), migratedLegacy: false };
  }

  function isCurrentRun(entry, runToken) {
    return Boolean(entry && entry.runToken === runToken);
  }

  function snapshotCellIds(cells) {
    return (Array.isArray(cells) ? cells : []).map((cell) => cell.id);
  }

  function detectRiskyCommands(search) {
    const commands = new Set(splitSPLPipeline(search).map((segment) => {
      const normalized = stripSPLComments(segment).replace(/^\|\s*/, "").trim();
      const match = normalized.match(/^([A-Za-z][A-Za-z0-9_]*)\b/);
      return match ? match[1].toLowerCase() : "";
    }));
    return RISKY_COMMANDS.filter((command) => commands.has(command));
  }

  function rowsFromResultsData(data) {
    const payload = data && typeof data === "object" ? data : {};
    const fields = Array.isArray(payload.fields)
      ? payload.fields.map((field) => typeof field === "string" ? field : String((field && field.name) || ""))
      : [];
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    return { fields, rows };
  }

  const pureApi = {
    APP_ID,
    STATE_VERSION,
    MAX_CELLS,
    ALLOWED_ROW_LIMITS,
    TIME_PRESETS,
    DEFAULT_QUERY,
    RISKY_COMMANDS,
    newCell,
    presetRange,
    inferTimePreset,
    formatSPL,
    normalizeState,
    selectStoredState,
    isCurrentRun,
    snapshotCellIds,
    detectRiskyCommands,
    rowsFromResultsData
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = pureApi;
    return;
  }

  const documentRef = root.document;
  if (!documentRef) return;

  const runtime = new Map();
  let state = normalizeState(null);
  let SearchManagerCtor = null;
  let SearchManagerLoading = false;
  let SearchManagerCallbacks = [];
  let persistenceTimer = null;
  let initialized = false;

  function byId(id) {
    return documentRef.getElementById(id);
  }

  function safeStorage(storage) {
    try {
      const probe = APP_ID + ".probe";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (error) {
      return null;
    }
  }

  const sessionStore = safeStorage(root.sessionStorage);
  const localStore = safeStorage(root.localStorage);

  function parseStored(storage, key) {
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function loadState() {
    const selected = selectStoredState(
      parseStored(localStore, LOCAL_KEY),
      parseStored(sessionStore, SESSION_KEY),
      parseStored(localStore, LEGACY_LOCAL_KEY),
      parseStored(sessionStore, LEGACY_SESSION_KEY)
    );
    if (selected.migratedLegacy) {
      try {
        if (localStore) localStore.removeItem(LEGACY_LOCAL_KEY);
        if (sessionStore) sessionStore.removeItem(LEGACY_SESSION_KEY);
      } catch (error) {
        // Migration remains usable in memory even if cleanup is blocked.
      }
    }
    return selected.state;
  }

  function persistNow() {
    const payload = JSON.stringify(state);
    try {
      if (sessionStore) {
        sessionStore.setItem(SESSION_KEY, payload);
        sessionStore.removeItem(LEGACY_SESSION_KEY);
      }
      if (localStore) {
        if (state.remember) localStore.setItem(LOCAL_KEY, payload);
        else localStore.removeItem(LOCAL_KEY);
        localStore.removeItem(LEGACY_LOCAL_KEY);
      }
    } catch (error) {
      announce("Browser storage is unavailable; the scratchbook remains usable for this page.");
    }
    updateStorageNote();
  }

  function schedulePersist() {
    root.clearTimeout(persistenceTimer);
    persistenceTimer = root.setTimeout(persistNow, 180);
  }

  function announce(message) {
    const status = byId("sn-global-status");
    if (status) status.textContent = message;
  }

  function updateStorageNote() {
    const note = byId("sn-storage-note");
    const remember = byId("sn-remember");
    if (remember) remember.checked = state.remember;
    if (note) note.textContent = state.remember
      ? "Search text is remembered on this browser. Results are never saved."
      : "Search text is kept only for this browser tab.";
  }

  function findCell(id) {
    return state.cells.find((cell) => cell.id === id) || null;
  }

  function setCellStatus(id, kind, message) {
    const entry = runtime.get(id) || {};
    entry.status = kind;
    entry.message = message;
    runtime.set(id, entry);
    const section = documentRef.querySelector('[data-cell-id="' + id + '"]');
    const status = byId("sn-status-" + id);
    if (section) {
      section.classList.toggle("sn-cell-running", kind === "running");
      section.classList.toggle("sn-cell-error", kind === "error");
    }
    if (status) {
      status.dataset.state = kind;
      status.replaceChildren();
      if (kind === "running") {
        const spinner = documentRef.createElement("span");
        spinner.className = "sn-spinner";
        spinner.setAttribute("aria-hidden", "true");
        status.appendChild(spinner);
      }
      status.appendChild(documentRef.createTextNode(message));
    }
  }

  function clearResults(id) {
    const results = byId("sn-results-" + id);
    if (results) {
      results.replaceChildren();
      results.hidden = true;
    }
    const entry = runtime.get(id) || {};
    delete entry.resultData;
    runtime.set(id, entry);
    setCellStatus(id, "idle", "Ready.");
  }

  function renderResults(id, rawData, requestedLimit) {
    const results = byId("sn-results-" + id);
    if (!results) return;
    const parsed = rowsFromResultsData(rawData);
    const fieldLimit = 50;
    const fields = parsed.fields.slice(0, fieldLimit);
    const rows = parsed.rows.slice(0, requestedLimit);
    results.replaceChildren();
    const cell = findCell(id);
    results.hidden = Boolean(cell && cell.collapsed);

    const meta = documentRef.createElement("div");
    meta.className = "sn-results-meta";
    const fieldNote = parsed.fields.length > fieldLimit ? " · first " + fieldLimit + " fields shown" : "";
    meta.textContent = rows.length + " result row" + (rows.length === 1 ? "" : "s") + fieldNote;
    results.appendChild(meta);

    if (!rows.length || !fields.length) {
      const empty = documentRef.createElement("div");
      empty.className = "sn-results-empty";
      empty.textContent = "The search completed with no tabular results.";
      results.appendChild(empty);
      return;
    }

    const table = documentRef.createElement("table");
    table.className = "sn-table";
    const caption = documentRef.createElement("caption");
    caption.textContent = "Search results";
    caption.className = "visually-hidden";
    table.appendChild(caption);
    const thead = documentRef.createElement("thead");
    const headerRow = documentRef.createElement("tr");
    fields.forEach((field) => {
      const th = documentRef.createElement("th");
      th.scope = "col";
      th.textContent = field;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = documentRef.createElement("tbody");
    rows.forEach((row) => {
      const tr = documentRef.createElement("tr");
      fields.forEach((field, index) => {
        const td = documentRef.createElement("td");
        const value = Array.isArray(row) ? row[index] : row && typeof row === "object" ? row[field] : "";
        td.textContent = value === null || value === undefined ? "" : String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    results.appendChild(table);
  }

  function disposeManager(manager, cancel) {
    if (!manager) return;
    if (cancel) {
      try { if (manager.cancel) manager.cancel(); } catch (error) { /* no-op */ }
    }
    try { if (manager.dispose) manager.dispose(); } catch (error) { /* no-op */ }
  }

  function cancelCell(id, silent) {
    const entry = runtime.get(id);
    if (entry) {
      const settleRun = entry.settleRun;
      if (typeof settleRun === "function") settleRun(false);
      if (entry.manager) disposeManager(entry.manager, true);
      delete entry.manager;
      delete entry.runToken;
      delete entry.settleRun;
      runtime.set(id, entry);
      if (!silent) setCellStatus(id, "idle", "Cancelled.");
    }
  }

  function flushSearchManager(Constructor) {
    SearchManagerCtor = Constructor;
    SearchManagerLoading = false;
    const callbacks = SearchManagerCallbacks.splice(0);
    callbacks.forEach((callback) => callback(null, Constructor));
  }

  function failSearchManager(error) {
    SearchManagerLoading = false;
    const callbacks = SearchManagerCallbacks.splice(0);
    callbacks.forEach((callback) => callback(error || new Error("SearchManager unavailable")));
  }

  function withSearchManager(callback) {
    const direct = SearchManagerCtor || (root.splunkjs && root.splunkjs.mvc && root.splunkjs.mvc.SearchManager);
    if (direct) {
      flushSearchManager(direct);
      callback(null, direct);
      return;
    }
    SearchManagerCallbacks.push(callback);
    if (SearchManagerLoading) return;
    SearchManagerLoading = true;
    if (!root.require) {
      failSearchManager(new Error("Splunk SearchManager is unavailable"));
      return;
    }
    root.require(
      ["splunkjs/mvc/searchmanager", "splunkjs/mvc/simplexml/ready!"],
      function (Constructor) { flushSearchManager(Constructor); },
      function () { failSearchManager(new Error("Splunk SearchManager failed to load")); }
    );
  }

  function errorText(event) {
    if (!event) return "Search failed.";
    const candidate = event.message || (event.data && event.data.messages && event.data.messages[0] && event.data.messages[0].text);
    return candidate ? "Search failed: " + String(candidate).slice(0, 300) : "Search failed. Check Job Inspector for details.";
  }

  function confirmRisk(search) {
    const commands = detectRiskyCommands(search);
    if (!commands.length) return true;
    return root.confirm(
      "This SPL contains command" + (commands.length === 1 ? "" : "s") + " that may write, delete, or trigger an action: " +
      commands.join(", ") + ".\n\nRun it with your current Splunk permissions?"
    );
  }

  function runCell(id, options) {
    const cell = findCell(id);
    const settings = options || {};
    if (!cell) return Promise.resolve(false);
    const query = formatSPL(cell.query);
    cell.query = query;
    const editor = byId("sn-editor-" + id);
    if (editor) editor.value = query;
    schedulePersist();
    if (!query) {
      setCellStatus(id, "error", "Enter SPL before running this cell.");
      return Promise.resolve(false);
    }
    if ((!settings.skipRiskPrompt && !confirmRisk(query))) {
      setCellStatus(id, "idle", "Run cancelled before dispatch.");
      return Promise.resolve(false);
    }

    cancelCell(id, true);
    clearResults(id);
    const startedAt = Date.now();
    const runToken = "sn_run_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    const runEntry = runtime.get(id) || {};
    runEntry.runToken = runToken;
    runtime.set(id, runEntry);
    setCellStatus(id, "running", "Dispatching search…");

    return new Promise((resolve) => {
      let manager;
      let settled = false;
      let dataRendered = false;
      let resultModel;

      function settle(ok) {
        if (settled) return;
        settled = true;
        resolve(ok);
      }

      const pendingEntry = runtime.get(id) || {};
      if (isCurrentRun(pendingEntry, runToken)) {
        pendingEntry.settleRun = settle;
        runtime.set(id, pendingEntry);
      }

      withSearchManager((loadError, SearchManager) => {
        if (!isCurrentRun(runtime.get(id), runToken)) {
          settle(false);
          return;
        }
        if (loadError || !SearchManager) {
          setCellStatus(id, "error", "Splunk SearchManager is unavailable in this view.");
          const failedEntry = runtime.get(id) || {};
          if (isCurrentRun(failedEntry, runToken)) {
            delete failedEntry.runToken;
            delete failedEntry.settleRun;
          }
          runtime.set(id, failedEntry);
          settle(false);
          return;
        }

        const managerId = runToken.replace("sn_run_", "sn_job_");

        function ownsRun() {
          return isCurrentRun(runtime.get(id), runToken);
        }

        function clearRunOwnership() {
          const entry = runtime.get(id) || {};
          if (!isCurrentRun(entry, runToken)) return;
          delete entry.manager;
          delete entry.runToken;
          delete entry.settleRun;
          runtime.set(id, entry);
        }

        function abandonStaleRun() {
          disposeManager(manager, false);
          settle(false);
        }

        function completeWithData() {
          if (!ownsRun()) {
            abandonStaleRun();
            return;
          }
          if (dataRendered) return;
          const data = this && this.data ? this.data() : {};
          if (!data || !Array.isArray(data.rows)) return;
          dataRendered = true;
          const current = runtime.get(id) || {};
          current.resultData = data;
          runtime.set(id, current);
          renderResults(id, data, cell.rowLimit);
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
          setCellStatus(id, "done", "Completed in " + elapsed + "s · " + data.rows.length + " rows displayed.");
          disposeManager(manager, false);
          clearRunOwnership();
          settle(true);
        }

        function onDone() {
          if (!ownsRun()) {
            abandonStaleRun();
            return;
          }
          try {
            if (resultModel && resultModel.fetch) resultModel.fetch();
            else onFailure(new Error("Search results are unavailable."));
          } catch (error) {
            onFailure(error);
          }
        }

        function onFailure(event) {
          if (!ownsRun()) {
            abandonStaleRun();
            return;
          }
          setCellStatus(id, "error", errorText(event));
          disposeManager(manager, false);
          clearRunOwnership();
          settle(false);
        }

        try {
          if (!ownsRun()) {
            settle(false);
            return;
          }
          manager = new SearchManager({
            id: managerId,
            app: APP_ID,
            search: query,
            earliest_time: cell.earliest,
            latest_time: cell.latest,
            preview: false,
            cache: false,
            autostart: false
          });
          if (!ownsRun()) {
            abandonStaleRun();
            return;
          }
          const entry = runtime.get(id) || {};
          entry.manager = manager;
          runtime.set(id, entry);
          resultModel = manager.data("results", { count: cell.rowLimit, offset: 0 });
          resultModel.on("data", completeWithData);
          resultModel.on("error", onFailure);
          manager.on("search:start", function () { if (ownsRun()) setCellStatus(id, "running", "Running…"); });
          manager.on("search:done", onDone);
          manager.on("search:failed", onFailure);
          manager.on("search:error", onFailure);
          manager.on("search:cancelled", function () {
            if (!ownsRun()) {
              abandonStaleRun();
              return;
            }
            setCellStatus(id, "idle", "Cancelled.");
            disposeManager(manager, false);
            clearRunOwnership();
            settle(false);
          });
          manager.startSearch();
        } catch (error) {
          onFailure(error);
        }
      });
    });
  }

  function button(label, className, action, title) {
    const element = documentRef.createElement("button");
    element.type = "button";
    element.className = "sn-cell-button " + (className || "");
    element.textContent = label;
    element.dataset.action = action;
    if (title) element.title = title;
    return element;
  }

  function option(value, label) {
    const element = documentRef.createElement("option");
    element.value = String(value);
    element.textContent = label || String(value);
    return element;
  }

  function createCellElement(cell, index) {
    const section = documentRef.createElement("article");
    section.className = "sn-cell";
    section.dataset.cellId = cell.id;
    section.setAttribute("aria-labelledby", "sn-prompt-" + cell.id);

    const prompt = documentRef.createElement("div");
    prompt.id = "sn-prompt-" + cell.id;
    prompt.className = "sn-prompt";
    prompt.textContent = "[" + (index + 1) + "]";
    section.appendChild(prompt);

    const card = documentRef.createElement("div");
    card.className = "sn-card";
    const toolbar = documentRef.createElement("div");
    toolbar.className = "sn-cell-toolbar";
    const actions = documentRef.createElement("div");
    actions.className = "sn-cell-actions";
    actions.appendChild(button("Run", "sn-run", "run", "Run this search (Cmd/Ctrl+Enter)"));
    actions.appendChild(button("+ Above", "", "add-above", "Add a search above"));
    actions.appendChild(button("+ Below", "", "add-below", "Add a search below"));
    const collapseButton = button(cell.collapsed ? "Expand Cell" : "Collapse Cell", "", "toggle-collapse", cell.collapsed ? "Expand this Search Cell" : "Collapse this Search Cell");
    collapseButton.setAttribute("aria-expanded", String(!cell.collapsed));
    actions.appendChild(collapseButton);
    toolbar.appendChild(actions);

    const collapsedSummary = documentRef.createElement("span");
    collapsedSummary.className = "sn-collapsed-summary";
    collapsedSummary.textContent = cell.query.replace(/\s+/g, " ").trim().slice(0, 180) || "Empty SPL";
    collapsedSummary.hidden = !cell.collapsed;
    toolbar.appendChild(collapsedSummary);

    const menu = documentRef.createElement("details");
    menu.className = "sn-menu";
    const summary = documentRef.createElement("summary");
    summary.className = "sn-cell-button";
    summary.textContent = "More ▾";
    summary.setAttribute("aria-label", "More actions for search " + (index + 1));
    menu.appendChild(summary);
    const menuPanel = documentRef.createElement("div");
    menuPanel.className = "sn-menu-panel";
    [
      ["Cancel search", "cancel", false],
      ["Move up", "move-up", index === 0],
      ["Move down", "move-down", index === state.cells.length - 1],
      ["Duplicate", "duplicate", false],
      ["Clear result", "clear-result", false],
      ["Remove", "remove", state.cells.length === 1]
    ].forEach((item) => {
      const itemButton = button(item[0], item[1] === "remove" ? "sn-danger" : "", item[1]);
      itemButton.disabled = item[2];
      menuPanel.appendChild(itemButton);
    });
    menu.appendChild(menuPanel);
    toolbar.appendChild(menu);
    card.appendChild(toolbar);

    const editorWrap = documentRef.createElement("div");
    editorWrap.className = "sn-editor-wrap";
    editorWrap.hidden = cell.collapsed;
    const editorLabel = documentRef.createElement("label");
    editorLabel.className = "sn-editor-label visually-hidden";
    editorLabel.htmlFor = "sn-editor-" + cell.id;
    editorLabel.textContent = "SPL search";
    const editor = documentRef.createElement("textarea");
    editor.id = "sn-editor-" + cell.id;
    editor.className = "sn-editor";
    editor.value = cell.query;
    editor.spellcheck = false;
    editor.setAttribute("aria-keyshortcuts", "Control+Enter Meta+Enter Shift+Enter");
    editorWrap.appendChild(editorLabel);
    editorWrap.appendChild(editor);
    card.appendChild(editorWrap);

    const options = documentRef.createElement("div");
    options.className = "sn-options";
    options.hidden = cell.collapsed;
    const presetLabel = documentRef.createElement("label");
    presetLabel.textContent = "Time";
    presetLabel.className = "sn-time-preset";
    const presetSelect = documentRef.createElement("select");
    presetSelect.dataset.field = "timePreset";
    Object.entries(TIME_PRESETS).forEach((entry) => presetSelect.appendChild(option(entry[0], entry[1].label)));
    presetSelect.appendChild(option("custom", "Custom time range"));
    presetSelect.value = cell.timePreset;
    presetLabel.appendChild(presetSelect);
    options.appendChild(presetLabel);
    [["From", "earliest", cell.earliest], ["To", "latest", cell.latest]].forEach((spec) => {
      const label = documentRef.createElement("label");
      label.textContent = spec[0];
      label.setAttribute("data-time-custom", "true");
      label.hidden = cell.timePreset !== "custom";
      const input = documentRef.createElement("input");
      input.type = "text";
      input.dataset.field = spec[1];
      input.value = spec[2];
      input.autocomplete = "off";
      label.appendChild(input);
      options.appendChild(label);
    });
    const limitLabel = documentRef.createElement("label");
    limitLabel.textContent = "Rows";
    const limit = documentRef.createElement("select");
    limit.dataset.field = "rowLimit";
    ALLOWED_ROW_LIMITS.forEach((value) => limit.appendChild(option(value)));
    limit.value = String(cell.rowLimit);
    limitLabel.appendChild(limit);
    options.appendChild(limitLabel);
    card.appendChild(options);

    const status = documentRef.createElement("div");
    status.id = "sn-status-" + cell.id;
    status.className = "sn-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const currentRuntime = runtime.get(cell.id) || {};
    status.dataset.state = currentRuntime.status || "idle";
    status.textContent = currentRuntime.message || "Ready.";
    status.hidden = cell.collapsed;
    card.appendChild(status);

    const results = documentRef.createElement("div");
    results.id = "sn-results-" + cell.id;
    results.className = "sn-results";
    results.setAttribute("aria-label", "Results for search " + (index + 1));
    results.hidden = cell.collapsed || !currentRuntime.resultData;
    card.appendChild(results);
    section.appendChild(card);
    if (cell.collapsed) section.classList.add("sn-cell-collapsed");
    if (currentRuntime.status === "running") section.classList.add("sn-cell-running");
    if (currentRuntime.status === "error") section.classList.add("sn-cell-error");
    root.setTimeout(function () {
      if (currentRuntime.resultData) renderResults(cell.id, currentRuntime.resultData, cell.rowLimit);
      if (currentRuntime.status) setCellStatus(cell.id, currentRuntime.status, currentRuntime.message || "Ready.");
    }, 0);
    return section;
  }

  function renderNotebook(focusId) {
    const container = byId("sn-cells");
    if (!container) return;
    container.replaceChildren();
    state.cells.forEach((cell, index) => container.appendChild(createCellElement(cell, index)));
    updateStorageNote();
    if (focusId) {
      root.setTimeout(function () {
        const editor = byId("sn-editor-" + focusId);
        if (editor) editor.focus();
      }, 0);
    }
  }

  function addCell(index, query) {
    if (state.cells.length >= MAX_CELLS) {
      announce("This notebook is limited to " + MAX_CELLS + " cells to protect browser and search resources.");
      return null;
    }
    const cell = newCell(query === undefined ? "" : query);
    const position = Math.max(0, Math.min(index, state.cells.length));
    state.cells.splice(position, 0, cell);
    persistNow();
    renderNotebook(cell.id);
    announce("Added search " + (position + 1) + ".");
    return cell;
  }

  function removeCell(id) {
    if (state.cells.length === 1) return;
    const index = state.cells.findIndex((cell) => cell.id === id);
    if (index < 0) return;
    cancelCell(id, true);
    state.cells.splice(index, 1);
    runtime.delete(id);
    persistNow();
    const focus = state.cells[Math.min(index, state.cells.length - 1)].id;
    renderNotebook(focus);
    announce("Removed a search cell.");
  }

  function moveCell(id, delta) {
    const index = state.cells.findIndex((cell) => cell.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.cells.length) return;
    const cell = state.cells.splice(index, 1)[0];
    state.cells.splice(target, 0, cell);
    persistNow();
    renderNotebook(id);
  }

  function duplicateCell(id) {
    const index = state.cells.findIndex((cell) => cell.id === id);
    if (index < 0 || state.cells.length >= MAX_CELLS) return;
    const original = state.cells[index];
    const copy = newCell(original.query);
    copy.earliest = original.earliest;
    copy.latest = original.latest;
    copy.rowLimit = original.rowLimit;
    copy.timePreset = original.timePreset;
    copy.collapsed = original.collapsed;
    state.cells.splice(index + 1, 0, copy);
    persistNow();
    renderNotebook(copy.id);
  }

  async function runAll() {
    const buttonElement = byId("sn-run-all");
    if (buttonElement) buttonElement.disabled = true;
    const cellIds = snapshotCellIds(state.cells);
    announce("Running " + cellIds.length + " searches sequentially…");
    try {
      for (const cellId of cellIds) {
        const cell = findCell(cellId);
        if (!cell) continue;
        const risky = detectRiskyCommands(cell.query);
        if (risky.length && !confirmRisk(cell.query)) {
          setCellStatus(cell.id, "idle", "Skipped before dispatch.");
          continue;
        }
        await runCell(cell.id, { skipRiskPrompt: true });
      }
    } finally {
      if (buttonElement) buttonElement.disabled = false;
    }
    announce("Run all finished.");
  }

  function handleCellClick(event) {
    const actionElement = event.target.closest("[data-action]");
    const section = event.target.closest("[data-cell-id]");
    if (!actionElement || !section) return;
    const id = section.dataset.cellId;
    const index = state.cells.findIndex((cell) => cell.id === id);
    const cell = findCell(id);
    switch (actionElement.dataset.action) {
      case "run": runCell(id); break;
      case "cancel": cancelCell(id, false); break;
      case "add-above": addCell(index, ""); break;
      case "add-below": addCell(index + 1, ""); break;
      case "move-up": moveCell(id, -1); break;
      case "move-down": moveCell(id, 1); break;
      case "duplicate": duplicateCell(id); break;
      case "clear-result": clearResults(id); break;
      case "toggle-collapse":
        if (cell) {
          cell.collapsed = !cell.collapsed;
          persistNow();
          renderNotebook(cell.collapsed ? null : id);
        }
        break;
      case "remove": removeCell(id); break;
      default: break;
    }
    const menu = actionElement.closest("details");
    if (menu) menu.open = false;
  }

  function handleCellInput(event) {
    const section = event.target.closest("[data-cell-id]");
    if (!section) return;
    const cell = findCell(section.dataset.cellId);
    if (!cell) return;
    if (event.target.classList.contains("sn-editor")) cell.query = event.target.value;
    if (event.target.dataset.field === "earliest") {
      cell.earliest = event.target.value.slice(0, 80);
      cell.timePreset = "custom";
    }
    if (event.target.dataset.field === "latest") {
      cell.latest = event.target.value.slice(0, 80);
      cell.timePreset = "custom";
    }
    if (event.target.dataset.field === "timePreset") {
      cell.timePreset = event.target.value;
      const preset = presetRange(cell.timePreset);
      if (preset) {
        cell.earliest = preset.earliest;
        cell.latest = preset.latest;
      }
      section.querySelectorAll("[data-time-custom]").forEach((label) => { label.hidden = cell.timePreset !== "custom"; });
      const earliestInput = section.querySelector('[data-field="earliest"]');
      const latestInput = section.querySelector('[data-field="latest"]');
      if (earliestInput) earliestInput.value = cell.earliest;
      if (latestInput) latestInput.value = cell.latest;
    }
    if (event.target.dataset.field === "rowLimit") {
      const parsed = Number.parseInt(event.target.value, 10);
      cell.rowLimit = ALLOWED_ROW_LIMITS.includes(parsed) ? parsed : 100;
    }
    schedulePersist();
  }

  function handleEditorKeydown(event) {
    if (!event.target.classList.contains("sn-editor")) return;
    const section = event.target.closest("[data-cell-id]");
    if (!section) return;
    const id = section.dataset.cellId;
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runCell(id);
      return;
    }
    if (event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      const index = state.cells.findIndex((cell) => cell.id === id);
      runCell(id).then(function () {
        if (index + 1 < state.cells.length) {
          const next = byId("sn-editor-" + state.cells[index + 1].id);
          if (next) next.focus();
        } else {
          addCell(state.cells.length, "");
        }
      });
    }
  }

  function clearAllResults() {
    state.cells.forEach((cell) => clearResults(cell.id));
    announce("Cleared displayed results. Search text is unchanged.");
  }

  function clearSavedNotebook() {
    if (!root.confirm("Clear all saved search cells and start a new scratchbook?")) return;
    state.cells.forEach((cell) => cancelCell(cell.id, true));
    runtime.clear();
    if (sessionStore) {
      sessionStore.removeItem(SESSION_KEY);
      sessionStore.removeItem(LEGACY_SESSION_KEY);
    }
    if (localStore) {
      localStore.removeItem(LOCAL_KEY);
      localStore.removeItem(LEGACY_LOCAL_KEY);
    }
    state = normalizeState(null);
    renderNotebook(state.cells[0].id);
    persistNow();
    announce("Started a new scratchbook.");
  }

  function bindEvents() {
    const cells = byId("sn-cells");
    if (cells) {
      cells.addEventListener("click", handleCellClick);
      cells.addEventListener("input", handleCellInput);
      cells.addEventListener("change", handleCellInput);
      cells.addEventListener("keydown", handleEditorKeydown);
    }
    const add = byId("sn-add-cell");
    const addLast = byId("sn-add-last");
    const runAllButton = byId("sn-run-all");
    const clearResultsButton = byId("sn-clear-results");
    const clearStorageButton = byId("sn-clear-storage");
    const remember = byId("sn-remember");
    if (add) add.addEventListener("click", function () { addCell(0, ""); });
    if (addLast) addLast.addEventListener("click", function () { addCell(state.cells.length, ""); });
    if (runAllButton) runAllButton.addEventListener("click", runAll);
    if (clearResultsButton) clearResultsButton.addEventListener("click", clearAllResults);
    if (clearStorageButton) clearStorageButton.addEventListener("click", clearSavedNotebook);
    if (remember) remember.addEventListener("change", function () {
      state.remember = remember.checked;
      persistNow();
      announce(state.remember ? "Notebook search text will be remembered on this browser." : "Persistent notebook storage disabled.");
    });
    root.addEventListener("beforeunload", function () {
      state.cells.forEach((cell) => cancelCell(cell.id, true));
      persistNow();
    });
  }

  function boot() {
    if (initialized || !byId("sn-app")) return;
    initialized = true;
    state = loadState();
    bindEvents();
    renderNotebook();
    persistNow();
    announce("Ready · " + state.cells.length + " search cell" + (state.cells.length === 1 ? "" : "s") + ".");
  }

  pureApi.boot = boot;
  pureApi.runCell = runCell;
  pureApi.cancelCell = cancelCell;
  root.SPLScratchbook = pureApi;

  if (documentRef.readyState === "loading") documentRef.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
