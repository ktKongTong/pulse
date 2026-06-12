#!/usr/bin/env python3
"""
Patch project.pbxproj to match the new directory layout.

Strategy: keep all original IDs. Only:
1. Remove old file refs + build entries for deleted/moved files
2. Add new file refs + build entries for new files
3. Rebuild the PBXGroup section from the filesystem
4. Rebuild the PBXSourcesBuildPhase from the new file set

Uses the original file's IDs for everything that still exists.
"""

from __future__ import annotations
import hashlib, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MACOS = REPO / "macosApp"
PBXPROJ = MACOS / "PulseBarNative.xcodeproj/project.pbxproj"
SOURCE_ROOT = MACOS / "PulseBarNative"

def stable_id(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest().upper()[:24]

def quote_pbx_string(value: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        return value
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

def collect_swift(path: Path) -> list[Path]:
    result = []
    for child in sorted(path.rglob("*.swift"), key=lambda p: p.name.lower()):
        result.append(child)
    return result

def collect_tree(path: Path) -> dict:
    node = {"name": path.name, "path": path, "children": [], "swift_files": []}
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.is_dir():
            node["children"].append(collect_tree(child))
        elif child.suffix == ".swift":
            node["swift_files"].append(child)
    return node

def main():
    text = PBXPROJ.read_text()

    # ── 1. Parse existing file refs (name → id) ──────────────────────────────
    existing_refs: dict[str, str] = {}  # filename → file_ref_id
    for m in re.finditer(r"(\w{24}) /\* ([\w+.]+\.swift) \*/ = \{isa = PBXFileReference", text):
        existing_refs[m.group(2)] = m.group(1)

    # Parse existing build file entries (file_ref_id → build_id)
    existing_builds: dict[str, str] = {}  # file_ref_id → build_id
    for m in re.finditer(r"(\w{24}) /\* ([\w+.]+\.swift) in Sources \*/ = \{isa = PBXBuildFile; fileRef = (\w{24})", text):
        existing_builds[m.group(3)] = m.group(1)

    # ── 2. Determine current Swift files on disk ──────────────────────────────
    current_files = collect_swift(SOURCE_ROOT)
    current_names = {f.name for f in current_files}

    # ── 3. Assign IDs for every current file ─────────────────────────────────
    # Reuse existing IDs where the filename matches; generate new ones otherwise.
    file_ref_id: dict[Path, str] = {}
    build_id: dict[Path, str] = {}
    for f in current_files:
        ref_id = existing_refs.get(f.name) or stable_id("file/" + f.name)
        bld_id = existing_builds.get(ref_id) or stable_id("build/" + f.name)
        file_ref_id[f] = ref_id
        build_id[f] = bld_id

    # ── 4. Rebuild PBXBuildFile section ──────────────────────────────────────
    def build_file_section() -> str:
        lines = ["/* Begin PBXBuildFile section */"]
        for f in sorted(current_files, key=lambda p: p.name.lower()):
            bid = build_id[f]
            rid = file_ref_id[f]
            lines.append(f"\t\t{bid} /* {f.name} in Sources */ = {{isa = PBXBuildFile; fileRef = {rid} /* {f.name} */; }};")
        lines.append("/* End PBXBuildFile section */")
        return "\n".join(lines) + "\n"

    # ── 5. Rebuild PBXFileReference section ──────────────────────────────────
    # Keep entitlements + .app product refs from original
    entitlements_id = re.search(r"(\w{24}) /\* PulseBarNative\.entitlements \*/ = \{isa = PBXFileReference", text).group(1)
    app_ref_id = re.search(r"(\w{24}) /\* PulseBarNative\.app \*/ = \{isa = PBXFileReference", text).group(1)

    def file_ref_section() -> str:
        lines = ["/* Begin PBXFileReference section */"]
        for f in sorted(current_files, key=lambda p: p.name.lower()):
            rid = file_ref_id[f]
            lines.append(f"\t\t{rid} /* {f.name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {quote_pbx_string(f.name)}; sourceTree = \"<group>\"; }};")
        lines.append(f"\t\t{entitlements_id} /* PulseBarNative.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = PulseBarNative.entitlements; sourceTree = \"<group>\"; }};")
        lines.append(f"\t\t{app_ref_id} /* PulseBarNative.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = PulseBarNative.app; sourceTree = BUILT_PRODUCTS_DIR; }};")
        lines.append("/* End PBXFileReference section */")
        return "\n".join(lines) + "\n"

    # ── 6. Rebuild PBXGroup section ───────────────────────────────────────────
    products_group_id = re.search(r"productRefGroup = (\w{24})", text).group(1)
    main_group_id = re.search(r"mainGroup = (\w{24});", text).group(1)

    path_to_ref: dict[Path, str] = {f: file_ref_id[f] for f in current_files}

    def group_id(path: Path) -> str:
        return stable_id("group/" + str(path.relative_to(MACOS)))

    groups: list[str] = []

    def emit_group(node: dict, is_root: bool = False):
        entries: list[str] = []
        if is_root:
            entries.append(f"\t\t\t\t{entitlements_id} /* PulseBarNative.entitlements */,")
        for child in node["children"]:
            entries.append(f"\t\t\t\t{group_id(child['path'])} /* {child['name']} */,")
        for f in node["swift_files"]:
            entries.append(f"\t\t\t\t{path_to_ref[f]} /* {f.name} */,")
        gid = group_id(node["path"])
        groups.append(
            f"\t\t{gid} /* {node['name']} */ = {{\n"
            f"\t\t\tisa = PBXGroup;\n"
            f"\t\t\tchildren = (\n"
            + "\n".join(entries) + "\n"
            f"\t\t\t);\n"
            f"\t\t\tpath = {node['name']};\n"
            f"\t\t\tsourceTree = \"<group>\";\n"
            f"\t\t}};"
        )
        for child in node["children"]:
            emit_group(child)

    root_node = collect_tree(SOURCE_ROOT)
    emit_group(root_node, is_root=True)

    groups.append(
        f"\t\t{products_group_id} /* Products */ = {{\n"
        f"\t\t\tisa = PBXGroup;\n"
        f"\t\t\tchildren = (\n"
        f"\t\t\t\t{app_ref_id} /* PulseBarNative.app */,\n"
        f"\t\t\t);\n"
        f"\t\t\tname = Products;\n"
        f"\t\t\tsourceTree = \"<group>\";\n"
        f"\t\t}};"
    )

    root_gid = group_id(root_node["path"])
    groups.append(
        f"\t\t{main_group_id} = {{\n"
        f"\t\t\tisa = PBXGroup;\n"
        f"\t\t\tchildren = (\n"
        f"\t\t\t\t{root_gid} /* {root_node['name']} */,\n"
        f"\t\t\t\t{products_group_id} /* Products */,\n"
        f"\t\t\t);\n"
        f"\t\t\tsourceTree = \"<group>\";\n"
        f"\t\t}};"
    )

    def group_section() -> str:
        return "/* Begin PBXGroup section */\n" + "\n".join(groups) + "\n/* End PBXGroup section */\n"

    # ── 7. Rebuild PBXSourcesBuildPhase ──────────────────────────────────────
    sources_id = re.search(r"(\w{24}) /\* Sources \*/ = \{\s*isa = PBXSourcesBuildPhase;", text).group(1)

    def sources_section() -> str:
        entries = []
        for f in sorted(current_files, key=lambda p: p.name.lower()):
            entries.append(f"\t\t\t\t{build_id[f]} /* {f.name} in Sources */,")
        return (
            "/* Begin PBXSourcesBuildPhase section */\n"
            f"\t\t{sources_id} /* Sources */ = {{\n"
            "\t\t\tisa = PBXSourcesBuildPhase;\n"
            "\t\t\tbuildActionMask = 2147483647;\n"
            "\t\t\tfiles = (\n"
            + "\n".join(entries) + "\n"
            "\t\t\t);\n"
            "\t\t\trunOnlyForDeploymentPostprocessing = 0;\n"
            "\t\t};\n"
            "/* End PBXSourcesBuildPhase section */\n"
        )

    # ── 8. Splice into file ───────────────────────────────────────────────────
    def replace_section(t: str, name: str, new_content: str) -> str:
        pattern = re.compile(
            r"/\* Begin " + re.escape(name) + r" section \*/[\s\S]*?/\* End " + re.escape(name) + r" section \*/\n",
            re.MULTILINE,
        )
        m = pattern.search(t)
        if not m:
            raise RuntimeError(f"Section {name} not found")
        return t[: m.start()] + new_content + t[m.end():]

    text = replace_section(text, "PBXBuildFile", build_file_section())
    text = replace_section(text, "PBXFileReference", file_ref_section())
    text = replace_section(text, "PBXGroup", group_section())
    text = replace_section(text, "PBXSourcesBuildPhase", sources_section())

    PBXPROJ.write_text(text)
    print(f"Patched {PBXPROJ.name}")
    print(f"Swift files: {len(current_files)}")
    print(f"Reused existing IDs: {sum(1 for f in current_files if f.name in existing_refs)}")
    print(f"New IDs generated: {sum(1 for f in current_files if f.name not in existing_refs)}")

if __name__ == "__main__":
    main()
