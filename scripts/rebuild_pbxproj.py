#!/usr/bin/env python3
"""
Regenerate the PBXBuildFile, PBXFileReference, PBXGroup, and
PBXSourcesBuildPhase sections of project.pbxproj from the actual Swift
file tree under macosApp/PulseBarNative. Everything else (PBXNativeTarget,
PBXProject, XCBuildConfiguration, the embed-swift shell script phase) is
preserved.

Every ID is derived from a deterministic hash so repeated runs produce
the same output.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
MACOS_ROOT = REPO_ROOT / "macosApp"
PBXPROJ = MACOS_ROOT / "PulseBarNative.xcodeproj/project.pbxproj"
SOURCE_ROOT = MACOS_ROOT / "PulseBarNative"

def hex_id(prefix: str, key: str) -> str:
    digest = hashlib.sha1(f"{prefix}/{key}".encode()).hexdigest().upper()
    return digest[:24]

def collect_tree(path: Path) -> dict:
    node = {"name": path.name, "path": path, "children": [], "swift_files": []}
    for child in sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if child.is_dir():
            node["children"].append(collect_tree(child))
        elif child.suffix == ".swift":
            node["swift_files"].append(child)
    return node

def flatten_swift(node: dict) -> list[Path]:
    files = list(node["swift_files"])
    for child in node["children"]:
        files.extend(flatten_swift(child))
    return files



def strip_section(text: str, name: str) -> str:
    pattern = re.compile(
        r"/\* Begin " + re.escape(name) + r" section \*/[\s\S]*?/\* End " + re.escape(name) + r" section \*/\n",
        re.MULTILINE,
    )
    m = pattern.search(text)
    if not m:
        raise RuntimeError(f"section {name} not found")
    return text[: m.start()] + text[m.end():]

def build_pbx_build_file(file_refs) -> str:
    lines = ["/* Begin PBXBuildFile section */"]
    for build_id, (file_ref_id, path) in sorted(file_refs.items(), key=lambda kv: kv[1][1].name.lower()):
        name = path.name
        lines.append(f"\t\t{build_id} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_ref_id} /* {name} */; }};")
    lines.append("/* End PBXBuildFile section */")
    return "\n".join(lines) + "\n"

def build_pbx_file_reference(file_refs, app_ref_id, entitlements_id) -> str:
    lines = ["/* Begin PBXFileReference section */"]
    unique: dict[str, Path] = {}
    for _, (file_ref_id, path) in file_refs.items():
        unique[file_ref_id] = path
    for file_ref_id, path in sorted(unique.items(), key=lambda kv: kv[1].name.lower()):
        name = path.name
        lines.append(
            f"\t\t{file_ref_id} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = \"<group>\"; }};"
        )
    lines.append(
        f"\t\t{entitlements_id} /* PulseBarNative.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = PulseBarNative.entitlements; sourceTree = \"<group>\"; }};"
    )
    lines.append(
        f"\t\t{app_ref_id} /* PulseBarNative.app */ = {{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = PulseBarNative.app; sourceTree = BUILT_PRODUCTS_DIR; }};"
    )
    lines.append("/* End PBXFileReference section */")
    return "\n".join(lines) + "\n"

def build_pbx_group(root_node, file_refs, entitlements_id, app_ref_id, products_group_id, main_group_id) -> str:
    path_to_ref: dict[Path, str] = {path: ref_id for _, (ref_id, path) in file_refs.items()}
    groups: list[str] = []

    def group_id_for(path: Path) -> str:
        return hex_id("group", str(path.relative_to(MACOS_ROOT)))

    def emit(node, is_root=False):
        entries: list[str] = []
        if is_root:
            entries.append(f"\t\t\t\t{entitlements_id} /* PulseBarNative.entitlements */,")
        for child in node["children"]:
            entries.append(f"\t\t\t\t{group_id_for(child['path'])} /* {child['name']} */,")
        for f in node["swift_files"]:
            entries.append(f"\t\t\t\t{path_to_ref[f]} /* {f.name} */,")
        gid = group_id_for(node["path"])
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
            emit(child)

    emit(root_node, is_root=True)

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

    root_gid = group_id_for(root_node["path"])
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

    return "/* Begin PBXGroup section */\n" + "\n".join(groups) + "\n/* End PBXGroup section */\n"

def build_sources_phase(file_refs, sources_id) -> str:
    entries: list[str] = []
    for build_id, (_, path) in sorted(file_refs.items(), key=lambda kv: kv[1][1].name.lower()):
        entries.append(f"\t\t\t\t{build_id} /* {path.name} in Sources */,")
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

def main():
    text = PBXPROJ.read_text()

    sources_id = re.search(r"(\w{24}) /\* Sources \*/ = \{\s*isa = PBXSourcesBuildPhase;", text).group(1)
    main_group_id = re.search(r"mainGroup = (\w{24});", text).group(1)
    products_group_id = re.search(r"productRefGroup = (\w{24})", text).group(1)
    app_ref_id = re.search(r"(\w{24}) /\* PulseBarNative\.app \*/ = \{isa = PBXFileReference;", text).group(1)
    entitlements_id = re.search(r"(\w{24}) /\* PulseBarNative\.entitlements \*/ = \{isa = PBXFileReference;", text).group(1)

    root_node = collect_tree(SOURCE_ROOT)
    all_files = flatten_swift(root_node)
    file_refs: dict[str, tuple[str, Path]] = {}
    for path in all_files:
        rel_key = str(path.relative_to(MACOS_ROOT))
        build_id = hex_id("build", rel_key)
        file_ref_id = hex_id("file", rel_key)
        file_refs[build_id] = (file_ref_id, path)

    text = strip_section(text, "PBXBuildFile")
    text = strip_section(text, "PBXFileReference")
    text = strip_section(text, "PBXGroup")
    text = strip_section(text, "PBXSourcesBuildPhase")

    new_sections = (
        build_pbx_build_file(file_refs)
        + "\n" + build_pbx_file_reference(file_refs, app_ref_id, entitlements_id)
        + "\n" + build_pbx_group(root_node, file_refs, entitlements_id, app_ref_id, products_group_id, main_group_id)
    )

    text = text.replace(
        "/* Begin PBXNativeTarget section */",
        new_sections + "\n/* Begin PBXNativeTarget section */",
        1,
    )
    text = text.replace(
        "/* Begin XCBuildConfiguration section */",
        build_sources_phase(file_refs, sources_id) + "\n/* Begin XCBuildConfiguration section */",
        1,
    )

    PBXPROJ.write_text(text)
    print(f"Rewrote {PBXPROJ.name}")
    print(f"Swift files: {len(all_files)}")

if __name__ == "__main__":
    main()
