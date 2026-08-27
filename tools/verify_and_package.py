from __future__ import annotations

import configparser
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
APP_ID = "spl_scratchbook"
VERSION = "1.0.2"
PACKAGE_MTIME = 1_577_836_800  # 2020-01-01 UTC; deterministic and valid for Splunk Web caching.
APP = ROOT
PACKAGE_DIR = ROOT / "dist"
PACKAGE = PACKAGE_DIR / f"{APP_ID}-{VERSION}.tgz"
REPORT_DIR = ROOT / "dist"
REPORT = REPORT_DIR / f"{APP_ID}-{VERSION}-local-verification.json"

REQUIRED = [
    "default/app.conf",
    "default/data/ui/nav/default.xml",
    "default/data/ui/views/scratchbook.xml",
    "metadata/default.meta",
    "appserver/static/js/spl_scratchbook_102.js",
    "appserver/static/css/spl_scratchbook_102.css",
    "README.md",
]

SECRET_PATTERNS = {
    "private_key": re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
    "bearer_header": re.compile(r"(?i)authorization\s*[:=]\s*bearer\s+\S+"),
    "aws_access_key": re.compile(r"AKIA[0-9A-Z]{16}"),
    "splunk_token_assignment": re.compile(r"(?i)(?:splunk|hec|mcp)[_-]?token\s*[:=]\s*[A-Za-z0-9._~+/=-]{16,}"),
}


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_conf(path: Path) -> configparser.ConfigParser:
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.read(path, encoding="utf-8")
    return parser


def package_filter(path: Path) -> bool:
    return not any(part in {"__pycache__", ".pytest_cache", "tests"} for part in path.parts) and not path.name.startswith("._") and path.name != ".DS_Store"


def build_package() -> list[str]:
    PACKAGE_DIR.mkdir(parents=True, exist_ok=True)
    files = [APP / "README.md"]
    for runtime_dir in ["appserver", "default", "metadata"]:
        files.extend(path for path in (APP / runtime_dir).rglob("*") if path.is_file() and package_filter(path.relative_to(APP)))
    files = sorted(files)
    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for path in files:
            arcname = Path(APP_ID) / path.relative_to(APP)
            info = archive.gettarinfo(str(path), arcname=str(arcname))
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            info.mtime = PACKAGE_MTIME
            with path.open("rb") as handle:
                archive.addfile(info, handle)
    tar_buffer.seek(0)
    with PACKAGE.open("wb") as package_handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=package_handle, mtime=0) as compressed:
            compressed.write(tar_buffer.getvalue())
    with tarfile.open(PACKAGE, "r:gz") as archive:
        members = archive.getmembers()
        assert all(member.mtime == PACKAGE_MTIME for member in members)
        return [member.name for member in members]


def main() -> None:
    checks: dict[str, object] = {}
    missing = [relative for relative in REQUIRED if not (APP / relative).is_file()]
    if missing:
        raise SystemExit(f"Missing required app files: {missing}")
    checks["required_files"] = "passed"

    app_conf = parse_conf(APP / "default/app.conf")
    assert app_conf["package"]["id"] == APP_ID
    assert app_conf["id"]["name"] == APP_ID
    assert app_conf["id"]["version"] == VERSION
    assert app_conf["ui"].getboolean("is_visible") is True
    checks["app_identity"] = "passed"

    view = ET.parse(APP / "default/data/ui/views/scratchbook.xml").getroot()
    nav = ET.parse(APP / "default/data/ui/nav/default.xml").getroot()
    nav_view = nav.find("view")
    assert view.tag == "dashboard" and view.attrib["version"] == "1.1"
    assert view.attrib["script"] == "js/spl_scratchbook_102.js"
    assert view.attrib["stylesheet"] == "css/spl_scratchbook_102.css"
    assert view.attrib["theme"] == "light"
    assert view.find("description") is None
    assert nav_view is not None
    assert nav_view.attrib == {"name": "scratchbook", "default": "true"}
    assert nav.attrib["color"] == "#5cc05c"
    checks["xml"] = "passed"

    javascript = text(APP / "appserver/static/js/spl_scratchbook_102.js")
    assert "SearchManager" in javascript
    assert 'earliest_time: cell.earliest' in javascript
    assert 'latest_time: cell.latest' in javascript
    assert 'autostart: false' in javascript
    assert 'runAll' in javascript and 'await runCell' in javascript
    assert 'td.textContent' in javascript
    assert '.innerHTML' not in javascript
    assert 'prompt.textContent = "["' in javascript
    assert 'editorLabel.className = "sn-editor-label visually-hidden"' in javascript
    assert 'TIME_PRESETS' in javascript
    assert 'data-time-custom' in javascript
    assert 'case "toggle-collapse"' in javascript
    assert 'cell.collapsed = !cell.collapsed' in javascript
    assert 'editorLabel.appendChild(editor)' not in javascript
    assert 'editorWrap.appendChild(editorLabel);\n    editorWrap.appendChild(editor);' in javascript
    assert 'const query = formatSPL(cell.query);' in javascript
    assert 'const LEGACY_APP_ID = "splunk_search_notebook";' in javascript
    for risky_command in ["collect", "delete", "dump", "map", "mcollect", "meventcollect", "outputcsv", "outputlookup", "run", "sendalert", "sendemail", "runshellscript", "script", "tscollect"]:
        assert f'"{risky_command}"' in javascript
    assert 'removeItem(LEGACY_SESSION_KEY)' in javascript
    assert 'removeItem(LEGACY_LOCAL_KEY)' in javascript
    assert 'runEntry.runToken = runToken' in javascript
    assert 'isCurrentRun(runtime.get(id), runToken)' in javascript
    assert 'pendingEntry.settleRun = settle' in javascript
    assert 'if (typeof settleRun === "function") settleRun(false);' in javascript
    assert 'const cellIds = snapshotCellIds(state.cells);' in javascript
    assert 'stripSPLComments' in javascript
    assert 'setCellStatus(id, "idle", "Cancelled.")' in javascript
    assert 'disposeManager(manager, false)' in javascript
    assert '}, 1800);' not in javascript
    assert 'onFailure(error);' in javascript
    assert 'button(cell.collapsed ? "Expand Cell" : "Collapse Cell"' in javascript
    assert 'status.hidden = cell.collapsed;' in javascript
    assert 'results.hidden = cell.collapsed || !currentRuntime.resultData;' in javascript
    assert 'results.hidden = Boolean(cell && cell.collapsed);' in javascript
    checks["search_and_safe_rendering_contract"] = "passed"

    stylesheet = text(APP / "appserver/static/css/spl_scratchbook_102.css")
    for native_token in ["#f2f4f5", "#ffffff", "#c3cbd4", "#5cc05c"]:
        assert native_token in stylesheet
    for retired_token in ["#101216", "#a78bfa", "#8b5cf6"]:
        assert retired_token not in stylesheet
    assert ".dashboard-header" in stylesheet and "display: none !important" in stylesheet
    checks["splunk_native_visual_contract"] = "passed"

    subprocess.run(["node", "--check", str(APP / "appserver/static/js/spl_scratchbook_102.js")], check=True)
    subprocess.run(["node", str(ROOT / "tools/test_spl_scratchbook.js")], check=True)
    checks["javascript"] = "passed"

    scanned = []
    for path in APP.rglob("*"):
        if not path.is_file() or path.stat().st_size > 1_000_000 or any(part in {".git", "dist"} for part in path.relative_to(APP).parts):
            continue
        body = text(path)
        for name, pattern in SECRET_PATTERNS.items():
            if pattern.search(body):
                raise SystemExit(f"Potential {name} found in {path.relative_to(ROOT)}")
        scanned.append(str(path.relative_to(ROOT)))
    checks["secret_scan"] = {"status": "passed", "files": len(scanned)}

    package_names = build_package()
    expected_prefix = APP_ID + "/"
    assert package_names and all(name.startswith(expected_prefix) for name in package_names)
    assert all("tests" not in name and "/._" not in name for name in package_names)
    for relative in REQUIRED:
        assert f"{APP_ID}/{relative}" in package_names
    checks["package"] = {"status": "passed", "files": len(package_names)}

    digest = hashlib.sha256(PACKAGE.read_bytes()).hexdigest()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "app_id": APP_ID,
        "version": VERSION,
        "status": "local-package-validated-not-installed",
        "checks": checks,
        "package": str(PACKAGE.relative_to(ROOT)),
        "sha256": digest,
        "live_install_performed": False,
        "live_render_verified": False,
    }
    REPORT.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
