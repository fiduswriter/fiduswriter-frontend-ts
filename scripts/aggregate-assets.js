#!/usr/bin/env node

/**
 * aggregate-assets.js
 *
 * Aggregates CSS and static assets from @fiduswriter/frontend and all
 * its sub-dependencies into dist/css/ and dist/static/.
 *
 * This script is called during @fiduswriter/frontend's postinstall so
 * that consumers (the main Django app, alternative backends) can copy
 * everything from a single location.
 *
 * Usage: node scripts/aggregate-assets.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { cpSync, readdirSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const dist = join(root, "dist")
const distCss = join(dist, "css")
const distStatic = join(dist, "static")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure a directory exists (mkdir -p). */
function ensureDir(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
    }
}

/**
 * Recursively copy a directory.
 * @param {string} src
 * @param {string} dest
 */
function copyDir(src, dest) {
    if (!existsSync(src)) {
        console.warn(`  (skip: source not found) ${src}`)
        return
    }
    ensureDir(dirname(dest))
    cpSync(src, dest, { recursive: true })
    const count = readdirSync(src, { recursive: true }).filter(
        (f) => !f.endsWith("/")
    ).length
    console.log(`  copied ${count} files: ${relative(root, src)} → ${relative(root, dest)}`)
}

/**
 * Read a dependency's package.json relative to node_modules.
 * @param {string} pkgName  e.g. "fwtoolkit" or "@fiduswriter/editor"
 * @returns {object|null}
 */
function readDepPackage(pkgName) {
    const path = join(root, "node_modules", pkgName, "package.json")
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8"))
}

// ---------------------------------------------------------------------------
// Step 1a — Copy frontend's own CSS
// ---------------------------------------------------------------------------
console.log("Step 1a: Copying @fiduswriter/frontend CSS...")

copyDir(join(root, "css"), distCss)

// ---------------------------------------------------------------------------
// Step 1b — Copy frontend's static assets (fonts, images, svg)
// ---------------------------------------------------------------------------
console.log("Step 1b: Copying @fiduswriter/frontend static assets...")

if (existsSync(join(root, "static"))) {
    copyDir(join(root, "static"), distStatic)
} else {
    console.log("  (no static/ directory)")
}

// ---------------------------------------------------------------------------
// Step 1c — Copy editor's static assets (fonts, images, ogg)
// ---------------------------------------------------------------------------
console.log("Step 1c: Copying @fiduswriter/editor static assets...")

const editorStatic = join(root, "node_modules", "@fiduswriter/editor", "static")
if (existsSync(editorStatic)) {
    copyDir(editorStatic, distStatic)
} else {
    console.log("  (not found)")
}

// ---------------------------------------------------------------------------
// Step 2 — Copy CSS from sub-dependencies
// ---------------------------------------------------------------------------
console.log("\nStep 2: Copying sub-dependency CSS...")

/** @type {{name: string, cssDir: string, destDir: string}[]} */
const subDeps = [
    { name: "fwtoolkit", cssDir: "css", destDir: "fwtoolkit" },
    { name: "@fiduswriter/editor", cssDir: "css", destDir: "editor" },
    {
        name: "@fiduswriter/bibliography-manager",
        cssDir: "css",
        destDir: "bibliography",
    },
    { name: "@fiduswriter/image-manager", cssDir: "css", destDir: "image-manager" },
    {
        name: "@fiduswriter/document-template-editor",
        cssDir: "css",
        destDir: "document-template-editor",
    },
    {
        name: "@fiduswriter/document",
        cssDir: "src/css",
        destDir: "document",
    },
]

for (const dep of subDeps) {
    const src = join(root, "node_modules", dep.name, dep.cssDir)
    const dest = join(distCss, dep.destDir)
    if (!existsSync(src)) {
        console.log(`  ${dep.name}: skipped (not found at ${src})`)
        continue
    }
    console.log(`  ${dep.name}:`)
    copyDir(src, dest)
}

// ---------------------------------------------------------------------------
// Step 3 — Generate CSS manifest from package declarations
// ---------------------------------------------------------------------------
console.log("\nStep 3: Generating CSS manifest...")

/**
 * @typedef {Object} CssDecl
 * @property {string[]} fwtoolkit
 * @property {{additive: string[], component: string[]}} own
 */

/**
 * Read the fiduswriter.css declaration from a package.
 * @param {string} pkgName
 * @returns {CssDecl|null}
 */
function readCssDecl(pkgName) {
    const pkg = readDepPackage(pkgName)
    if (!pkg) return null
    const decl = pkg?.fiduswriter?.css
    if (!decl) return null
    return decl
}

/** @type {Object<string, string[]>} */
const manifest = {
    reset: [],
    tokens: [],
    typography: [],
    components: [],
    additive: [],
    chrome: [],
    editor: [],
    packages: [],
}

// Layer 0: Reset
manifest.reset.push("fwtoolkit/css/reset.css")

// Layer 1: Tokens (fwtoolkit colors base)
manifest.tokens.push("fwtoolkit/css/colors.css")

// Layer 2: Typography (frontend fonts)
manifest.typography.push("@fiduswriter/frontend/css/fonts.css")

// Layer 3: All fwtoolkit component CSS (used by the full SPA)
const allFwtCss = readdirSync(join(root, "node_modules", "fwtoolkit", "css")).filter(
    (f) => f.endsWith(".css")
)
// Remove colors.css (already in tokens), common.css (goes in components),
// and reset.css (already in the reset layer)
const fwtComponents = allFwtCss
    .filter(
        (f) => f !== "colors.css" && f !== "fwtoolkit.css" && f !== "reset.css"
    )
    .map((f) => `fwtoolkit/css/${f}`)
manifest.components.push(...fwtComponents)

// Layer 4: Additive overrides from all packages
const additivePackages = [
    ["@fiduswriter/frontend", "frontend"],
    ["@fiduswriter/editor", "editor"],
    ["@fiduswriter/bibliography-manager", "bibliography"],
]
for (const [pkgName] of additivePackages) {
    const decl = readCssDecl(pkgName)
    if (decl?.own?.additive) {
        for (const f of decl.own.additive) {
            manifest.additive.push(
                pkgName === "@fiduswriter/frontend"
                    ? `@fiduswriter/frontend/css/${f}`
                    : `${pkgName}/css/${f}`
            )
        }
    }
}

// Layer 5: SPA Chrome (frontend component CSS)
const frontendDecl = readCssDecl("@fiduswriter/frontend")
if (frontendDecl?.own?.component) {
    for (const f of frontendDecl.own.component) {
        manifest.chrome.push(`@fiduswriter/frontend/css/${f}`)
    }
}

// Layer 6: Editor component CSS
const editorDecl = readCssDecl("@fiduswriter/editor")
if (editorDecl?.own?.component) {
    for (const f of editorDecl.own.component) {
        manifest.editor.push(`@fiduswriter/editor/css/${f}`)
    }
}

// Layer 7: Other packages
const otherPackages = [
    ["@fiduswriter/bibliography-manager", "bibliography"],
    ["@fiduswriter/image-manager", "image-manager"],
    ["@fiduswriter/document-template-editor", "document-template-editor"],
]
for (const [pkgName] of otherPackages) {
    const decl = readCssDecl(pkgName)
    if (decl?.own?.component) {
        for (const f of decl.own.component) {
            manifest.packages.push(`${pkgName}/css/${f}`)
        }
    }
}

// Write manifest
const manifestPath = join(distCss, "manifest.json")
ensureDir(dirname(manifestPath))
writeFileSync(manifestPath, JSON.stringify({ layers: manifest }, null, 2) + "\n")
console.log(`  written: ${relative(root, manifestPath)}`)

// ---------------------------------------------------------------------------
// Step 4 — Summary
// ---------------------------------------------------------------------------
console.log("\nAggregation complete.")
console.log(`Output: ${relative(root, distCss)}/`)
console.log(`Manifest: ${relative(root, manifestPath)}`)

// Count total CSS files
const allCss = readdirSync(distCss, { recursive: true }).filter(
    (f) => f.endsWith(".css")
)
console.log(`Total CSS files: ${allCss.length}`)
