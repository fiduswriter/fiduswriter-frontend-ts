import {docSchema} from "@fiduswriter/document/schema/document/index"
import deepEqual from "fast-deep-equal"
import {
    Dialog,
    OverviewDataTable,
    OverviewMenuView,
    activateWait,
    addAlert,
    avatarTemplate,
    deactivateWait,
    ensureCSS,
    escapeText,
    findTarget,
    setDocTitle,
    shortFileTitle,
    whenReady
} from "fwtoolkit"

import {baseBodyTemplate} from "../../common/index.js"
import {FeedbackTab} from "../../feedback/index.js"
import {SiteMenu} from "../../menu/index.js"
import type {FrontendApp, User} from "../../types.js"

import {DocumentOverviewActions} from "./actions.js"
import {bulkMenuModel, menuModel} from "./menu.js"
import type {MenuModel} from "./menu.js"
import {dateCell, deleteFolderCell} from "./templates.js"

/*
 * Helper functions for the document overview page.
 */

interface DocumentListEntry {
    id: number
    title: string
    path: string
    e2ee?: boolean
    is_owner?: boolean
    owner: {id: number; name: string; avatar?: string}
    added: number
    updated: number
    revisions: Array<Record<string, unknown>>
    rights?: string
    template?: string
    content?: unknown
    [key: string]: unknown
}

interface Contact {
    id: number
    [key: string]: unknown
}

interface DocumentOverviewConstructorOptions {
    app: FrontendApp
    user: User & {id?: number}
}

export class DocumentOverview {
    app: FrontendApp
    user: User & {id?: number}
    path: string
    schema: any
    documentList: DocumentListEntry[]
    contacts: Contact[]
    mod: {actions?: DocumentOverviewActions}
    lastSort: {column: number; dir: string}
    active: boolean
    hasPassphraseSetUp: boolean
    dom!: HTMLElement
    table: any
    overviewTable: any
    dtBulk: any
    dtBulkModel: MenuModel
    menu: any
    plugins: Record<string, {init(): void}> | null
    documentStyles: any
    documentTemplates: Record<string, {id: number | string; title: string; [key: string]: unknown}>

    constructor({app, user}: DocumentOverviewConstructorOptions, path = "/") {
        this.app = app
        this.user = user
        this.path = path
        this.schema = docSchema
        this.documentList = []
        this.contacts = []
        this.mod = {}
        this.lastSort = {column: 0, dir: "asc"}
        this.active = false
        this.hasPassphraseSetUp = false
        this.plugins = null
        this.documentStyles = null
        this.documentTemplates = {}
        this.dtBulkModel = bulkMenuModel()
    }

    init(): Promise<void> {
        if (this.active) {
            return Promise.resolve()
        }
        this.active = true
        return whenReady().then(() => {
            this.render()
            const smenu = new SiteMenu(this.app, "documents")
            smenu.init()
            new DocumentOverviewActions(this)
            this.menu = new OverviewMenuView(this, menuModel as any)
            this.menu.init()
            this.dtBulkModel = bulkMenuModel()
            this.activateFidusPlugins()
            this.bind()
            return this.getDocumentListData()
                .then(() => this.bulkDecryptDocumentEncryptionKeys())
                        .then(() => this._checkPassphraseAndUpdateMenu())
                        .then(() => deactivateWait() as any)
        })
    }

    render(): void {
        this.dom = document.createElement("body")
        this.dom.innerHTML = baseBodyTemplate({
            contents: "",
            user: this.user,
            hasOverview: true,
            app: this.app
        })
        ensureCSS([
            staticUrl("css/document_overview.css"),
            staticUrl("css/add_remove_dialog.css"),
            staticUrl("css/editor/access_rights_dialog.css"),
            staticUrl("css/editor/e2ee.css")
        ])
        document.body = this.dom
        setDocTitle(gettext("Document Overview"), this.app as {name: string})
        const feedbackTab = new FeedbackTab(this.app)
        feedbackTab.init()
    }

    bind(): void {
        this.dom.addEventListener("click", event => {
            const el: Record<string, any> = {}
            let docId: number
            switch (true) {
                case findTarget(event, ".revisions", el): {
                    docId = Number.parseInt(el.target.dataset.id)
                    this.mod.actions!.revisionsDialog(docId, this.app)
                    break
                }
                case findTarget(event, ".document-settings", el):
                    docId = Number.parseInt(el.target.dataset.id)
                    this.mod.actions!.settingsDocumentDialog(docId)
                    break
                case findTarget(event, ".delete-document", el):
                    docId = Number.parseInt(el.target.dataset.id)
                    this.mod.actions!.deleteDocumentDialog([docId], this.app)
                    break
                case findTarget(event, ".delete-folder", el): {
                    const ids = el.target.dataset.ids
                        .split(",")
                        .map((id: string) => Number.parseInt(id))
                    this.mod.actions!.deleteDocumentDialog(ids, this.app)
                    break
                }
                case findTarget(event, ".fw-owned-by-user.rights", el): {
                    break
                }
                case findTarget(event, "a.fw-data-table-title.parentdir", el):
                    event.preventDefault()
                    if (this.table.data.data.length > 0) {
                        this.path = el.target.dataset.path
                        window.history.pushState(
                            {},
                            "",
                            el.target.getAttribute("href")
                        )
                        this.initTable()
                    } else {
                        const confirmFolderDeletionDialog = new Dialog({
                            title: gettext("Confirm deletion"),
                            body: `<p>
                    ${gettext("Leaving an empty folder will delete it. Do you really want to delete this folder?")}
                            </p>`,
                            id: "confirmfolderdeletion",
                            icon: "exclamation-triangle",
                            buttons: [
                                {
                                    text: gettext("Delete"),
                                    classes: "fw-dark delete-folder",
                                    click: () => {
                                        confirmFolderDeletionDialog.close()
                                        this.path = el.target.dataset.path
                                        window.history.pushState(
                                            {},
                                            "",
                                            el.target.getAttribute("href")
                                        )
                                        this.initTable()
                                    }
                                },
                                {
                                    type: "cancel"
                                }
                            ]
                        } as any)

                        confirmFolderDeletionDialog.open()
                    }

                    break
                case findTarget(event, "a.fw-data-table-title.subdir", el):
                    event.preventDefault()
                    this.path = el.target.dataset.path
                    window.history.pushState(
                        {},
                        "",
                        el.target.getAttribute("href")
                    )
                    this.initTable()
                    break
                case findTarget(event, "a.fw-data-table-title", el):
                    event.preventDefault()
                    if (this.app.isOffline()) {
                        addAlert(
                            "info",
                            gettext(
                                "You cannot open a document while you are offline."
                            )
                        )
                    } else {
                        this.app.goTo(el.target.getAttribute("href"))
                    }
                    break
                default:
                    break
            }
        })
    }

    activateFidusPlugins(): void {
        if (this.plugins) {
            // Plugins have been activated already
            return
        }
        // Add plugins.
        this.plugins = {}

        const documentsOverviewPlugins: Array<[string, Record<string, unknown>]> =
            (this.app as any).documentsOverviewPlugins ?? []
        documentsOverviewPlugins.forEach(([app, plugin]) => {
            if (!this.app.settings.APPS.includes(app)) {
                return
            }
            Object.values(plugin).forEach((pluginExport: any) => {
                if (typeof pluginExport === "function") {
                    this.plugins![pluginExport.name] = new pluginExport(this)
                    this.plugins![pluginExport.name].init()
                }
            })
        })
    }

    getDocumentListData(): Promise<void> {
        const cachedPromise = this.showCached()
        if (this.app.isOffline()) {
            return cachedPromise.then(() => {})
        }
        return whenReady()
            .then(() => this.app.apiConnectors.document.getDocumentList())
            .then((json) => {
                const typedJson = json as Record<string, unknown>
                return cachedPromise.then(oldJson => {
                    if (!deepEqual(typedJson, oldJson)) {
                        this.updateIndexedDB(typedJson)
                        this.initializeView(typedJson)
                    }
                })
            })
            .catch(error => {
                if (this.app.isOffline()) {
                    return cachedPromise.then(() => {})
                } else {
                    addAlert("error", gettext("Document data loading failed."))
                    throw error
                }
            })
    }

    async bulkDecryptDocumentEncryptionKeys(): Promise<void> {
        try {
            const response = await this.app.apiConnectors.document.getEncryptionKeys()

            if (!(response as any)?.keys?.length) {
                return
            }

            const {PassphraseCrypto} = await import(
                "fwtoolkit/e2ee/passphrase-crypto"
            )

            for (const keyData of (response as any).keys) {
                const {document_id, encrypted_key, encrypted_with_master_key} =
                    keyData

                const sessionKey = sessionStorage.getItem(
                    `e2ee_key_${document_id}`
                )
                if (sessionKey) {
                    continue
                }

                if (!encrypted_with_master_key) {
                    continue
                }

                try {
                    const masterKeyBase64 =
                        sessionStorage.getItem("e2ee_master_key")
                    if (!masterKeyBase64) {
                        continue
                    }

                    const masterKeyBytes = Uint8Array.from(
                        atob(masterKeyBase64),
                        c => c.charCodeAt(0)
                    )
                    const masterKey = await (PassphraseCrypto as any).importKey(
                        masterKeyBytes,
                        "AES-GCM"
                    )

                    const dek = await PassphraseCrypto.decryptString(
                        encrypted_key,
                        masterKey
                    )

                    sessionStorage.setItem(`e2ee_key_${document_id}`, dek)
                } catch (_error) {
                    continue
                }
            }
        } catch (_error) {
            // Silently fail - this is a best-effort operation
        }
    }

    async _checkPassphraseAndUpdateMenu(): Promise<void> {
        const e2eeMode = this.app.settings.E2EE_MODE as string
        if (e2eeMode === "disabled") {
            return
        }
        const {PassphraseManager} = await import(
            "fwtoolkit/e2ee/passphrase-manager"
        )
        this.hasPassphraseSetUp = await PassphraseManager.hasEncryptionKeys()
        if (e2eeMode === "required" && !this.hasPassphraseSetUp) {
            const importItemIdx = this.menu.model.content.findIndex(
                (item: any) => item.id === "import_document"
            )
            if (importItemIdx !== -1) {
                this.menu.model.content.splice(importItemIdx, 1)
                this.menu.update()
            }
        }
    }

    showCached(): Promise<any> {
        return this.loaddatafromIndexedDB().then(json => {
            if (!json) {
                activateWait(true)
                return
            }
            return this.initializeView(json)
        })
    }

    loaddatafromIndexedDB(): Promise<any> {
        return this.app.indexedDB!
            .readAllData("document_data")
            .then(response => {
                if (!response.length) {
                    return false
                }
                const data = response[0] as Record<string, unknown>
                delete data.id
                return data
            })
    }

    updateIndexedDB(json: Record<string, unknown>): Promise<void> {
        ;(json as any).id = 1
        return this.app.indexedDB!
            .clearData("document_data")
            .then(() => this.app.indexedDB!.insertData("document_data", [json]))
    }

    initializeView(json: any): any {
        if (!this.active) {
            return json
        }
        const ids = new Set<number>()
        this.documentList = (json.documents as DocumentListEntry[]).filter(doc => {
            if (ids.has(doc.id)) {
                return false
            }
            ids.add(doc.id)
            return true
        })

        this.contacts = json.contacts
        this.documentStyles = json.document_styles
        this.documentTemplates = json.document_templates
        this.initTable()
        this.decryptE2EETitles()
        window.scrollTo(0, 0)
        if (Object.keys(this.documentTemplates).length > 1) {
            this.multipleNewDocumentMenuItem()
        } else {
            this.singleNewDocumentMenuItem()
        }
        return json
    }

    async decryptE2EETitles(): Promise<void> {
        const e2eeDocs = this.documentList.filter(
            doc =>
                doc.e2ee &&
                doc.title &&
                sessionStorage.getItem(`e2ee_title_${doc.id}`) === null
        )
        if (!e2eeDocs.length) {
            return
        }
        const {E2EEKeyManager} = await import("fwtoolkit/e2ee/key-manager")
        const {E2EEEncryptor} = await import("fwtoolkit/e2ee/encryptor")
        for (const doc of e2eeDocs) {
            const key = await E2EEKeyManager.getKeyFromSession(doc.id)
            if (!key) {
                continue
            }
            try {
                const title = await E2EEEncryptor.decrypt(doc.title, key)
                sessionStorage.setItem(`e2ee_title_${doc.id}`, title)
                const linkEl = document.querySelector(
                    `a.fw-data-table-title[href="/document/${doc.id}"]`
                )
                if (linkEl) {
                    const span = linkEl.querySelector("span.fw-searchable")
                    if (span) {
                        span.textContent = shortFileTitle(title, doc.path)
                        span.classList.remove("e2ee-encrypted-title")
                    }
                }
            } catch (_e) {
                // Decryption failed — key may be stale. Ignore.
            }
        }
    }

    onResize(): void {
        if (!this.table) {
            return
        }
        this.initTable()
    }

    initTable(searching = false): void {
        if (this.overviewTable) {
            this.overviewTable.destroy()
            this.overviewTable = null
        }
        this.table = null
        this.dtBulk = null

        const subdirs: Record<string, any> = {}
        const contentsEl = document.querySelector(".fw-contents") as HTMLElement
        contentsEl.innerHTML = ""

        if (this.path !== "/") {
            const headerEl = document.createElement("h1")
            headerEl.innerHTML = escapeText(this.path)
            contentsEl.appendChild(headerEl)
        }

        const hiddenCols = [0, 1]

        if (window.innerWidth < 500) {
            hiddenCols.push(2, 5)
            if (window.innerWidth < 400) {
                hiddenCols.push(6)
            }
        }
        const fileList = this.documentList
            .map(doc => this.createTableRow(doc, subdirs, searching))
            .filter(row => !!row)

        let tableRender: any = false
        if (!searching && this.path !== "/") {
            const pathParts = this.path.split("/")
            pathParts.pop()
            pathParts.pop()
            const parentPath = pathParts.join("/") + "/"
            const href =
                parentPath === "/" && this.app.routes[""].app === "document"
                    ? parentPath
                    : `/documents${encodeURI(parentPath)}`
            tableRender = (_data: any, table: any, type: string) => {
                if (!["main", "message"].includes(type)) {
                    return
                }
                table.childNodes[1].childNodes.unshift({
                    nodeName: "TR",
                    attributes: {
                        "data-index": "0"
                    },
                    childNodes: [
                        {nodeName: "TD"},
                        {
                            nodeName: "TD",
                            childNodes: [
                                {
                                    nodeName: "a",
                                    attributes: {
                                        class: "fw-data-table-title fw-link-text parentdir",
                                        href,
                                        "data-path": parentPath
                                    },
                                    childNodes: [
                                        {
                                            nodeName: "i",
                                            attributes: {
                                                class: "fa-solid fa-folder"
                                            }
                                        },
                                        {
                                            nodeName: "span",
                                            attributes: {},
                                            childNodes: [
                                                {
                                                    nodeName: "#text",
                                                    data: ".."
                                                }
                                            ]
                                        }
                                    ]
                                }
                            ]
                        },
                        {nodeName: "TD"},
                        {nodeName: "TD"},
                        {nodeName: "TD"},
                        {nodeName: "TD"},
                        {nodeName: "TD"},
                        {nodeName: "TD"}
                    ]
                })
            }
        }

        this.overviewTable = new OverviewDataTable({
            dom: contentsEl,
            classes: ["fw-data-table", "fw-document-table", "fw-large"],
            columns: [
                {select: 0, type: "number"},
                {select: 1, type: "string"},
                {select: 2, type: "boolean"},
                {select: [5, 6], type: "date"},
                {select: hiddenCols, hidden: true},
                {select: [2, 4, 8, 9], sortable: false},
                {select: [this.lastSort.column], sort: this.lastSort.dir}
            ],
            data: fileList,
            idColumn: 0,
            checkboxColumn: 2,
            bulkMenu: this.dtBulkModel,
            bulkMenuPage: this,
            searchable: searching,
            scrollY: `${Math.max(window.innerHeight - 360, 200)}px`,
            tabIndex: 1,
            labels: {
                noRows: gettext("No documents available"),
                noResults: gettext("No documents found")
            },
            headings: [
                "", "", "",
                gettext("Title"),
                gettext("Revisions"),
                gettext("Created"),
                gettext("Last changed"),
                gettext("Owner"),
                gettext("Settings"),
                ""
            ],
            template: (options: any, _dom: any) =>
                `<div class='${options.classes.container}'style='height: ${options.scrollY}; overflow-Y: auto;'></div>`,
            tableRender,
            rowRender: (row: any, tr: any, _index: number) => {
                if (row.cells[1].data === "folder") {
                    tr.childNodes[0].childNodes = []
                    return
                }
                const id = row.cells[0].data
                const inputNode: any = {
                    nodeName: "input",
                    attributes: {
                        type: "checkbox",
                        class: "entry-select fw-check",
                        "data-id": id,
                        id: `doc-${id}`
                    }
                }
                if (row.cells[2].data) {
                    inputNode.attributes.checked = true
                }
                tr.childNodes[0].childNodes = [
                    inputNode,
                    {
                        nodeName: "label",
                        attributes: {for: `doc-${id}`}
                    }
                ]
            },
            onEnter: (row: any, _event: any) => {
                if (this.getSelected().length > 0) {
                    return
                }
                const rowIndex = this.table.data.data.indexOf(row)
                const link = this.table.dom.querySelector(
                    `tr[data-index="${rowIndex}"] a.fw-data-table-title`
                )
                if (link) {
                    link.click()
                }
            },
            onDelete: (row: any) => {
                const docId = row.cells[0].data
                this.mod.actions!.deleteDocumentDialog([docId], this.app)
            }
        } as any)
        this.overviewTable.init()
        this.table = this.overviewTable.table
        this.dtBulk = this.overviewTable.dtBulk

        this.table.on("datatable.sort", (column: number, dir: string) => {
            this.lastSort = {column, dir}
        })

        this.table.dom.focus()
    }

    createTableRow(
        doc: DocumentListEntry,
        subdirs: Record<string, any>,
        searching: boolean
    ): any {
        let path = doc.path
        if (!path.startsWith("/")) {
            path = "/" + path
        }
        if (!path.startsWith(this.path)) {
            return false
        }
        if (path.endsWith("/")) {
            path += doc.title.replace(/\//g, "")
        }
        const currentPath = path.slice(this.path.length)
        if (!searching && currentPath.includes("/")) {
            const subdir = currentPath.split("/").shift()!
            if (subdirs[subdir]) {
                if (doc.added < subdirs[subdir].added) {
                    subdirs[subdir].added = doc.added
                    subdirs[subdir].row[5] = dateCell({date: doc.added})
                }
                if (doc.updated > subdirs[subdir].updated) {
                    subdirs[subdir].updated = doc.updated
                    subdirs[subdir].row[6] = dateCell({date: doc.updated})
                }
                if ((this.user as any).id === doc.owner.id) {
                    subdirs[subdir].ownedIds.push(doc.id)
                    subdirs[subdir].row[9] = deleteFolderCell({
                        subdir,
                        ids: subdirs[subdir].ownedIds
                    })
                }
                return false
            }

            const ownedIds = (this.user as any).id === doc.owner.id ? [doc.id] : []
            const row = [
                "0",
                "folder",
                null,
                `<a class="fw-data-table-title fw-link-text subdir" href="/documents${encodeURI(this.path + subdir)}/" data-path="${this.path}${subdir}/">
                    <i class="fa-solid fa-folder"></i>
                    <span>${escapeText(subdir)}</span>
                </a>`,
                "",
                dateCell({date: doc.added}),
                dateCell({date: doc.updated}),
                "",
                "",
                ownedIds.length ? deleteFolderCell({subdir, ids: ownedIds}) : ""
            ]
            subdirs[subdir] = {
                row,
                added: doc.added,
                updated: doc.updated,
                ownedIds
            }
            return row
        }

        let displayTitle = doc.title
        let hasDecryptedTitle = false
        if (doc.e2ee) {
            const cachedTitle = sessionStorage.getItem(`e2ee_title_${doc.id}`)
            if (cachedTitle !== null) {
                displayTitle = cachedTitle
                hasDecryptedTitle = true
            } else if (doc.title) {
                displayTitle = gettext("Encrypted Document")
            }
        }

        return [
            String(doc.id),
            "file",
            false,
            `<a class="fw-data-table-title fw-link-text" href="/document/${doc.id}" data-id="${doc.id}">
                ${doc.e2ee ? '<i class="fa-solid fa-lock e2ee-doc-indicator" title="' + gettext("End-to-end encrypted document") + '"></i>' : '<i class="fa-regular fa-file-alt"></i>'}
                <span class="fw-searchable${doc.e2ee && !hasDecryptedTitle ? " e2ee-encrypted-title" : ""}">
                    ${shortFileTitle(displayTitle, doc.path)}
                </span>
                ${doc.template ? `<small class="doc-template-name">${escapeText(doc.template)}</small>` : ""}
            </a>`,
            doc.revisions.length
                ? `<span class="revisions" data-id="${doc.id}">
                <i class="fa-solid fa-history"></i>
            </span>`
                : "",
            dateCell({date: doc.added}),
            dateCell({date: doc.updated}),
            `<span>
                ${avatarTemplate({user: doc.owner})}
            </span>
            <span class="fw-searchable">${escapeText(doc.owner.name)}</span>`,
            `<span class="${doc.is_owner ? "document-settings fw-link-text" : "rights"}" data-id="${doc.id}" title="${doc.rights}">
                ${doc.is_owner ? '<i class="fa-solid fa-cog"></i>' : `<i data-id="${doc.id}" class="fw-icon-access-right icon-access-${doc.rights}"></i>`}
            </span>`,
            `<span class="delete-document fw-link-text" data-id="${doc.id}"
                    data-title="${escapeText(currentPath)}">
                ${
                    (this.user as any).id === doc.owner.id
                        ? '<i class="fa-solid fa-trash-alt"></i>'
                        : ""
                }
            </span>`
        ]
    }

    multipleNewDocumentMenuItem(): void {
        const menuItem = this.menu.model.content.find(
            (menuItem: any) => menuItem.id === "new_document"
        )
        menuItem.type = "dropdown"
        menuItem.content = Object.values(this.documentTemplates).map(
            docTemplate => ({
                title: docTemplate.title || gettext("Undefined"),
                action: () => this.goToNewDocument(`n${docTemplate.id}`)
            })
        )
        this.menu.update()

        if (this.dtBulkModel.content.find((item: any) => item.id === "copy_as")) {
            return
        }

        this.dtBulkModel.content.push({
            id: "copy_as",
            title: gettext("Copy selected as..."),
            tooltip: gettext(
                "Copy the documents and assign them to a specific template."
            ),
            action: (overview: DocumentOverview) => {
                const ids = overview.getSelected()
                if (ids.length) {
                    overview.mod.actions!.copyFilesAs(ids)
                }
            },
            disabled: (overview: DocumentOverview) =>
                !overview.getSelected().length || overview.app.isOffline(),
            order: 2.5
        })

        this.dtBulk!.update()
    }

    singleNewDocumentMenuItem(): void {
        const menuItem = this.menu.model.content.find(
            (menuItem: any) => menuItem.id === "new_document"
        )
        if (menuItem.type === "text") {
            return
        }
        menuItem.type = "text"
        delete menuItem.content
        this.menu.update()

        this.dtBulkModel.content = this.dtBulkModel.content.filter(
            (item: any) => item.id !== "copy_as"
        )
        this.dtBulk!.update()
    }

    getSelected(): number[] {
        return Array.from(
            document.querySelectorAll(".entry-select:checked:not(:disabled)")
        ).map(el => Number.parseInt((el as HTMLElement).getAttribute("data-id")!))
    }

    goToNewDocument(id: string): void {
        let url = `/document${this.path}${id}`
        if (this.app.settings.E2EE_MODE === "required") {
            url += "?e2ee=true"
            this.app.goTo(url)
        } else if (this.app.settings.E2EE_MODE === "disabled") {
            this.app.goTo(url)
        } else {
            const encryptedInfoBody = `
                <p class="e2ee-choice-intro">${gettext("Encrypted documents protect your content so that only people with the password can read it.")}</p>
                <strong>${gettext("Advantages")}</strong>
                <ul>
                    <li>${gettext("Only people with the password can read the document.")}</li>
                    <li>${gettext("The server cannot access the document contents.")}</li>
                </ul>
                <strong>${gettext("Disadvantages")}</strong>
                <ul>
                    <li>${gettext("Limited access rights options (no tracked changes or review modes).")}</li>
                    <li>${gettext("If you lose the password or passphrase, there is no way to recover the document.")}</li>
                    <li>${gettext("You must share the password with collaborators manually (unless they use a personal passphrase).")}</li>
                </ul>
            `
            const regularInfoBody = `
                <p class="e2ee-choice-intro">${gettext("Regular documents are the default and work well for most users.")}</p>
                <strong>${gettext("Advantages")}</strong>
                <ul>
                    <li>${gettext("Full access rights options including tracked changes and review modes.")}</li>
                    <li>${gettext("No risk of losing access if you forget a password.")}</li>
                    <li>${gettext("Easier collaboration — no need to share passwords with collaborators.")}</li>
                </ul>
                <strong>${gettext("Disadvantages")}</strong>
                <ul>
                    <li>${gettext("The server can technically access the document contents.")}</li>
                    <li>${gettext("No additional protection beyond your account password.")}</li>
                </ul>
            `
            const dialog = new Dialog({
                title: gettext("Choose encryption type of new document."),
                width: 460,
                body: `<div>
                    <div>
                        <input type="radio" id="nonencrypted" name="encryption" value="nonencrypted" checked>
                        <label for="nonencrypted">${gettext("Non-encrypted")}</label>
                    </div>
                    <div>&nbsp;</div>
                    <div>
                        <input type="radio" id="e2ee" name="encryption" value="e2ee">
                        <label for="e2ee">${gettext("Encrypted")}</label>
                    </div>
                    <div id="e2ee-info-regular" class="e2ee-choice-info">
                        ${regularInfoBody}
                    </div>
                    <div id="e2ee-info-encrypted" class="e2ee-choice-info" style="display: none;">
                        ${encryptedInfoBody}
                    </div>
                </div>`,
                buttons: [
                    {text: gettext("Cancel"), type: "cancel"},
                    {
                        text: gettext("Create"),
                        type: "ok",
                        click: async (_event: Event) => {
                            const e2ee =
                                (document.querySelector(
                                    'input[name="encryption"]:checked'
                                ) as HTMLInputElement)?.value === "e2ee"
                            dialog.close()

                            if (e2ee) {
                                const {PassphraseManager} = await import(
                                    "fwtoolkit/e2ee/passphrase-manager"
                                )
                                const hasPassphraseKeys =
                                    await PassphraseManager.hasEncryptionKeys()
                                const hasDismissed =
                                    await PassphraseManager.hasUserDismissedPassphraseOffer()

                                if (!hasPassphraseKeys && !hasDismissed) {
                                    const {setupPassphraseDialog} = await import(
                                        "fwtoolkit/e2ee/passphrase-dialog"
                                    )
                                    const setupConfirmed = await new Promise<boolean>(
                                        resolve => {
                                            const setupDialog = new Dialog({
                                                title: gettext("Set Up Personal Encryption (Optional)"),
                                                body: `<p>${gettext("Would you like to set up a personal passphrase now? This will allow you to unlock all your encrypted documents with a single passphrase.")}</p>
                                            <p><strong>${gettext("Note:")}</strong> ${gettext("This is optional. You can also use a per-document password instead.")}</p>`,
                                                buttons: [
                                                    {
                                                        text: gettext("Skip for Now"),
                                                        type: "cancel",
                                                        click: async () => {
                                                            setupDialog.close()
                                                            await PassphraseManager.markPassphraseDismissed()
                                                            resolve(false)
                                                        }
                                                    },
                                                    {
                                                        text: gettext("Set Up Passphrase"),
                                                        type: "ok",
                                                        click: () => {
                                                            setupDialog.close()
                                                            resolve(true)
                                                        }
                                                    }
                                                ]
                                            } as any)
                                            setupDialog.open()
                                        }
                                    )

                                    if (setupConfirmed) {
                                        await setupPassphraseDialog(
                                            async (passphrase: string) => {
                                                try {
                                                    const {recoveryKey} =
                                                        await PassphraseManager.setupEncryption(
                                                            passphrase
                                                        )
                                                    const {showRecoveryKeyDialog} =
                                                        await import(
                                                            "fwtoolkit/e2ee/passphrase-dialog"
                                                        )
                                                    await showRecoveryKeyDialog(
                                                        recoveryKey,
                                                        () => {}
                                                    )
                                                } catch (e: any) {
                                                    addAlert(
                                                        "error",
                                                        gettext(
                                                            "Failed to set up passphrase: " +
                                                                e.message
                                                        )
                                                    )
                                                }
                                            }
                                        )
                                    }
                                }

                                url += "?e2ee=true"
                            }
                            this.app.goTo(url)
                        }
                    }
                ]
            } as any)
            dialog.open()
            setTimeout(() => {
                const nonencryptedRadio = document.getElementById("nonencrypted")
                const e2eeRadio = document.getElementById("e2ee")
                const regularInfo = document.getElementById("e2ee-info-regular")
                const encryptedInfo = document.getElementById("e2ee-info-encrypted")
                if (nonencryptedRadio && e2eeRadio && regularInfo && encryptedInfo) {
                    const toggleInfo = () => {
                        if ((e2eeRadio as HTMLInputElement).checked) {
                            regularInfo.style.display = "none"
                            encryptedInfo.style.display = "block"
                        } else {
                            regularInfo.style.display = "block"
                            encryptedInfo.style.display = "none"
                        }
                    }
                    nonencryptedRadio.addEventListener("change", toggleInfo)
                    e2eeRadio.addEventListener("change", toggleInfo)
                }
            }, 100)
        }
    }

    close(): void {
        if (!this.active) {
            return
        }
        if (this.overviewTable) {
            this.overviewTable.destroy()
            this.overviewTable = null
        }
        this.table = null
        this.dtBulk = null
        if (this.menu) {
            this.menu.destroy()
            this.menu = null
        }
        this.active = false
    }
}
