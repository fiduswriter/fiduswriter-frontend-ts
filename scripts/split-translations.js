#!/usr/bin/env node

/**
 * split-translations.js
 *
 * Reads the existing djangojs.po file from the Django locale/ directory
 * and splits translations into per-package .po files.
 *
 * Strategy:
 *   1. Read each language's djangojs.po
 *   2. Parse source references (#: comments) to determine which package
 *      each string belongs to
 *   3. Write per-package locale/<lang>/LC_MESSAGES/messages.po
 *
 * The package mapping is based on the known directory renames from
 * the frontend reorganization (see docs/plans/reorganization-handoff.md).
 *
 * Usage:
 *   node scripts/split-translations.js <path-to-django-locale>
 *   node scripts/split-translations.js /path/to/fiduswriter/fiduswriter/locale
 *
 * Requires: gettext-parser
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

// Resolve gettext-parser
let poParse
try {
    const gp = await import("gettext-parser")
    poParse = gp.po?.parse || gp.default?.po?.parse || gp.parse
} catch {
    console.error("gettext-parser not found. Install: npm install --save-dev gettext-parser")
    process.exit(1)
}

// ---------------------------------------------------------------------------
// Package mapping: old Django source paths → npm package source paths
// ---------------------------------------------------------------------------

/**
 * Map of package name → array of [old path prefix, new source path prefix].
 * Order matters: first match wins. More specific paths come first.
 */
const PACKAGE_MAP = {
    "@fiduswriter/frontend": [
        // SPA router + chrome
        ["base/static/js/modules/app/", "src/app/"],
        ["base/static/js/modules/indexed_db/", "src/indexed_db/"],
        ["base/static/js/modules/prelogin/", "src/prelogin/"],
        ["base/static/js/modules/404/", "src/pages/404.ts"],
        ["base/static/js/modules/offline/", "src/pages/offline.ts"],
        ["base/static/js/modules/setup/", "src/pages/setup.ts"],
        ["base/static/js/modules/flatpage/", "src/pages/flatpage.ts"],
        ["base/static/js/modules/admin_console/", "src/admin_console/"],
        ["base/static/js/modules/error_hook/", "src/error_hook/"],
        ["base/static/js/modules/common/", "src/common/"],
        ["base/static/js/modules/menu/", "src/menu/"],
        // Document overview + importers
        ["document/static/js/modules/documents/overview/", "src/documents/overview/"],
        ["document/static/js/modules/importer/", "src/documents/importer/"],
        ["document/static/js/modules/documents/tools", "src/documents/tools.ts"],
        ["document/static/js/modules/documents/revisions/", "src/documents/revisions/"],
        // Maintenance
        ["document/static/js/modules/maintenance/", "src/maintenance/"],
        // User pages
        ["user/static/js/modules/profile/", "src/user/profile/"],
        ["user/static/js/modules/login/", "src/user/auth/login.ts"],
        ["user/static/js/modules/signup/", "src/user/auth/signup.ts"],
        ["user/static/js/modules/password_reset/", "src/user/auth/password-reset.ts"],
        ["user/static/js/modules/email_confirm/", "src/user/auth/email-confirm.ts"],
        ["user/static/js/modules/two_factor/", "src/user/auth/two-factor.ts"],
        ["user/static/js/modules/contacts/", "src/user/contacts/"],
        // Template manager
        ["user_template_manager/static/js/modules/", "src/document_templates/"],
    ],
    "@fiduswriter/editor": [
        ["document/static/js/modules/editor/", "src/"],
        ["document/static/js/modules/exporter/", "src/exporter/"],
        ["document/static/js/modules/importer/", "src/importer/"],
        ["document/static/js/modules/citations/", "src/citations/"],
        ["document/static/js/modules/comments/", "src/comments/"],
        ["document/static/js/modules/collab/", "src/collab/"],
        ["document/static/js/modules/track/", "src/track/"],
        ["document/static/js/modules/footnotes/", "src/footnotes/"],
        ["document/static/js/modules/e2ee/", "src/e2ee/"],
        ["document/static/js/modules/clipboard/", "src/clipboard/"],
        ["document/static/js/modules/marginboxes/", "src/marginboxes/"],
        ["document/static/js/modules/navigator/", "src/navigator/"],
        ["document/static/js/modules/tools/", "src/tools/"],
    ],
    "@fiduswriter/bibliography-manager": [
        ["bibliography/static/js/modules/", "src/"],
        ["base/static/js/modules/bibliography/", "src/"],
    ],
    "@fiduswriter/image-manager": [
        ["usermedia/static/js/modules/", "src/"],
        ["base/static/js/modules/usermedia/", "src/"],
    ],
    "@fiduswriter/document-template-editor": [
        ["document/static/js/modules/document_template/", "src/"],
    ],
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const djangoLocalePath = process.argv[2]
if (!djangoLocalePath || !existsSync(djangoLocalePath)) {
    console.error(`Usage: node split-translations.js <path-to-django-locale>`)
    console.error(`  e.g.: node scripts/split-translations.js ../../fiduswriter/fiduswriter/locale`)
    process.exit(1)
}

/** Determine which package a source reference belongs to.
 *  Returns the package name, or null if the reference belongs to a Django
 *  plugin that should stay in Django's own locale/. */
function findPackage(ref) {
    for (const [pkgName, prefixes] of Object.entries(PACKAGE_MAP)) {
        for (const [oldPrefix] of prefixes) {
            if (ref.startsWith(oldPrefix)) return pkgName
        }
    }
    // Reference does not match any known npm package path.
    // It belongs to a Django plugin (e.g. llm/static/js/, book/static/js/)
    // or is otherwise unmapped — keep it in Django's locale, do not assign
    // to any npm package.
    return null
}

// ---------------------------------------------------------------------------
// Process each language
// ---------------------------------------------------------------------------

const languages = readdirSync(djangoLocalePath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

console.log(`Found ${languages.length} languages in ${djangoLocalePath}\n`)

for (const lang of languages) {
    const djangojsPo = join(djangoLocalePath, lang, "LC_MESSAGES", "djangojs.po")
    if (!existsSync(djangojsPo)) {
        console.log(`  ${lang}: no djangojs.po, skipping`)
        continue
    }

    const poContent = readFileSync(djangojsPo, "utf8")
    let parsed
    try {
        parsed = poParse(poContent)
    } catch (e) {
        console.error(`  ${lang}: failed to parse ${djangojsPo}: ${e.message}`)
        continue
    }

    // Collect entries per package
    /** @type {Record<string, Array<{msgid: string, msgid_plural?: string, msgstr: string|string[], comments: object}>>} */
    const packageEntries = {}
    for (const pkgName of Object.keys(PACKAGE_MAP)) {
        packageEntries[pkgName] = []
    }

    const translations = parsed.translations || {}
    for (const [, entries] of Object.entries(translations)) {
        for (const [msgid, entry] of Object.entries(entries)) {
            if (!msgid) continue // skip header

            // Determine package from source references
            const refs = entry.comments?.reference?.split(/\s+/) || []
            let pkg = null
            for (const ref of refs) {
                // ref format: "file.js:line"
                const filePath = ref.replace(/:\d+$/, "")
                const found = findPackage(filePath)
                if (found) {
                    pkg = found
                    break
                }
            }

            // Skip strings from unmapped Django plugins (they stay in Django's locale/)
            if (!pkg) continue

            packageEntries[pkg].push({
                msgid,
                msgid_plural: entry.msgid_plural || undefined,
                msgstr: entry.msgstr,
                comments: entry.comments || {},
            })
        }
    }

    // Write per-package .po files
    for (const [pkgName, entries] of Object.entries(packageEntries)) {
        if (entries.length === 0) continue

        // Build .po-like output
        const header = [
            `# Translations for ${pkgName}`,
            `# Language: ${lang}`,
            `# Auto-generated by split-translations.js`,
            `#`,
            `msgid ""`,
            `msgstr ""`,
            `"Content-Type: text/plain; charset=UTF-8\\n"`,
            `"Language: ${lang}\\n"`,
            `"Plural-Forms: nplurals=2; plural=(n != 1);\\n"`,
            ``,
        ].join("\n")

        const body = entries
            .map((e) => {
                let lines = ""
                // Comments
                if (e.comments?.translator) {
                    lines += `# ${e.comments.translator}\n`
                }
                if (e.comments?.reference) {
                    const refs = e.comments.reference.split("\n").filter(Boolean)
                    for (const ref of refs) {
                        lines += `#: ${ref.trim()}\n`
                    }
                }
                if (e.comments?.flag) {
                    lines += `#, ${e.comments.flag}\n`
                }
                if (e.comments?.flag) {
                    lines += `#, ${e.comments.flag}\n`
                }
                // msgid
                lines += `msgid "${escapePo(e.msgid)}"\n`
                if (e.msgid_plural) {
                    lines += `msgid_plural "${escapePo(e.msgid_plural)}"\n`
                }
                // msgstr
                if (Array.isArray(e.msgstr)) {
                    for (let i = 0; i < e.msgstr.length; i++) {
                        lines += `msgstr[${i}] "${escapePo(e.msgstr[i] || "")}"\n`
                    }
                } else {
                    lines += `msgstr "${escapePo(e.msgstr || "")}"\n`
                }
                return lines + "\n"
            })
            .join("")

        const output = header + "\n" + body

        // Determine target directory
        let pkgDir
        switch (pkgName) {
            case "@fiduswriter/frontend":
                pkgDir = join(root, "locale")
                break
            case "@fiduswriter/editor":
                pkgDir = join(root, "..", "fiduswriter-editor-ts", "locale")
                break
            case "@fiduswriter/bibliography-manager":
                pkgDir = join(root, "..", "fiduswriter-bibliography-manager-ts", "locale")
                break
            case "@fiduswriter/image-manager":
                pkgDir = join(root, "..", "fiduswriter-image-manager-ts", "locale")
                break
            case "@fiduswriter/document-template-editor":
                pkgDir = join(root, "..", "fiduswriter-document-template-editor-ts", "locale")
                break
            default:
                console.log(`  ${lang}/${pkgName}: unknown package, skipping`)
                continue
        }

        const langDir = join(pkgDir, lang, "LC_MESSAGES")
        mkdirSync(langDir, { recursive: true })
        const outFile = join(langDir, "messages.po")
        writeFileSync(outFile, output, "utf8")

        const translated = entries.filter(
            (e) => {
                const s = Array.isArray(e.msgstr) ? e.msgstr.join("") : e.msgstr
                return s && s.length > 0
            }
        ).length
        console.log(`  ${lang}/${pkgName}: ${entries.length} entries (${translated} translated) → ${outFile}`)
    }
}

console.log("\nDone. Run 'npm run compile-i18n' in each package to produce messages.json files.")

/** Escape a string for .po format. */
function escapePo(s) {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
}
