#!/usr/bin/env node

/**
 * extract-fwtoolkit-i18n.js
 *
 * Scans fwtoolkit/src/ for gettext() calls, extracts unique msgids,
 * looks up translations from the Django djangojs.po files, and writes
 * per-language messages.po files into fwtoolkit/locale/.
 *
 * Usage:
 *   node scripts/extract-fwtoolkit-i18n.js <path-to-django-locale> <path-to-fwtoolkit>
 *
 * Example:
 *   node scripts/extract-fwtoolkit-i18n.js \
 *     ../../fiduswriter-server-backend/fiduswriter/locale \
 *     ../../fwtoolkit
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"

const djangoLocalePath = process.argv[2]
const fwtoolkitPath = process.argv[3]

if (!djangoLocalePath || !fwtoolkitPath) {
    console.error("Usage: node extract-fwtoolkit-i18n.js <django-locale-dir> <fwtoolkit-dir>")
    process.exit(1)
}

// ---------------------------------------------------------------------------
// Step 1 — Scan fwtoolkit/src/ for gettext() calls
// ---------------------------------------------------------------------------

/** Simple regex: matches gettext("...") with optional whitespace.
 *  Does NOT handle gettext(msgid_variable) or template literals. */
const GETTEXT_RE = /gettext\s*\(\s*["']([^"']+)["']\s*\)/g

/** @type {Set<string>} */
const msgids = new Set()

function scanDir(dir) {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            scanDir(full)
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
            const content = readFileSync(full, "utf8")
            let match
            while ((match = GETTEXT_RE.exec(content)) !== null) {
                msgids.add(match[1])
            }
        }
    }
}

console.log(`Scanning ${fwtoolkitPath}/src/ for gettext() calls...`)
scanDir(join(fwtoolkitPath, "src"))
console.log(`Found ${msgids.size} unique msgids.\n`)

if (msgids.size === 0) {
    console.log("No gettext() calls found. Exiting.")
    process.exit(0)
}

// ---------------------------------------------------------------------------
// Step 2 — Look up translations from Django djangojs.po
// ---------------------------------------------------------------------------

const languages = readdirSync(djangoLocalePath, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

console.log(`Looking up translations in ${languages.length} languages...`)

let totalTranslated = 0

for (const lang of languages) {
    const poFile = join(djangoLocalePath, lang, "LC_MESSAGES", "djangojs.po")
    if (!existsSync(poFile)) continue

    const poContent = readFileSync(poFile, "utf8")

    // Build translation map from this language's djangojs.po
    /** @type {Map<string, {msgstr: string, comment: string}>} */
    const translationMap = new Map()

    let currentMsgid = null
    let currentComment = ""
    for (const line of poContent.split("\n")) {
        const trimmed = line.trim()

        // Comment lines
        if (trimmed.startsWith("#:")) {
            if (currentMsgid === null) {
                currentComment += line + "\n"
            }
            continue
        }
        if (trimmed.startsWith("#,") || trimmed.startsWith("#.") || trimmed.startsWith("#|")) {
            if (currentMsgid === null) {
                currentComment += line + "\n"
            }
            continue
        }
        if (trimmed.startsWith("#") && !trimmed.startsWith("#:")) {
            continue
        }

        // msgid line
        if (trimmed.startsWith('msgid "')) {
            currentMsgid = unescapePo(trimmed.slice(7, -1))
            continue
        }
        if (trimmed.startsWith('msgid ')) {
            currentMsgid = unescapePo(trimmed.slice(6))
            continue
        }

        // msgstr line — capture translation
        if (trimmed.startsWith('msgstr "') && currentMsgid !== null) {
            const msgstr = unescapePo(trimmed.slice(8, -1))
            if (msgstr) {
                translationMap.set(currentMsgid, {
                    msgstr,
                    comment: currentComment.trim(),
                })
            }
            currentMsgid = null
            currentComment = ""
            continue
        }
        if (trimmed.startsWith('msgstr ') && currentMsgid !== null) {
            const msgstr = unescapePo(trimmed.slice(7))
            if (msgstr) {
                translationMap.set(currentMsgid, {
                    msgstr,
                    comment: currentComment.trim(),
                })
            }
            currentMsgid = null
            currentComment = ""
            continue
        }

        // Plural forms — skip for simplicity (fwtoolkit doesn't use ngettext)
        if (trimmed.startsWith('msgid_plural') || trimmed.startsWith('msgstr[')) {
            currentMsgid = null
            currentComment = ""
            continue
        }

        // Continuation of msgid
        if (trimmed.startsWith('"') && currentMsgid !== null) {
            currentMsgid += unescapePo(trimmed.slice(1, -1))
            continue
        }
    }

    // Build .po file content
    const entries = []
    for (const msgid of msgids) {
        const translation = translationMap.get(msgid)
        const msgstr = translation ? translation.msgstr : ""
        const comment = translation ? translation.comment : ""
        entries.push({ msgid, msgstr, comment })

        if (msgstr) totalTranslated++
    }

    // Sort by msgid for stable output
    entries.sort((a, b) => a.msgid.localeCompare(b.msgid))

    const header = [
        `# Translations for fwtoolkit`,
        `# Language: ${lang}`,
        `# Auto-generated by extract-fwtoolkit-i18n.js`,
        `# Source: fwtoolkit/src/ (gettext() calls)`,
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
            if (e.comment) lines += e.comment + "\n"
            lines += `msgid "${escapePo(e.msgid)}"\n`
            lines += `msgstr "${escapePo(e.msgstr)}"\n`
            return lines + "\n"
        })
        .join("")

    const langDir = join(fwtoolkitPath, "locale", lang, "LC_MESSAGES")
    mkdirSync(langDir, { recursive: true })
    const outFile = join(langDir, "messages.po")
    writeFileSync(outFile, header + body, "utf8")

    const translated = entries.filter((e) => e.msgstr).length
    console.log(`  ${lang}: ${entries.length} entries, ${translated} translated`)
}

console.log(`\nTotal translated strings across all languages: ${totalTranslated}`)
console.log("Done.")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapePo(s) {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
}

function unescapePo(s) {
    return s
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\")
}
