import {AccessRightsTab} from "@fiduswriter/editor/documents/access_rights/index"
import {ExportFidusFile, SaveCopy} from "@fiduswriter/editor/exporter/native/index"
import {
    Dialog,
    DialogTabs,
    activateWait,
    addAlert,
    addProgress,
    deactivateWait,
    escapeText,
    longFilePath,
    shortFileTitle
} from "fwtoolkit"
import {E2EEKeyManager} from "fwtoolkit/e2ee/key-manager"
import {enterPassphraseDialog} from "fwtoolkit/e2ee/passphrase-dialog"
import {PassphraseManager} from "fwtoolkit/e2ee/passphrase-manager"
import {createPasswordDialog, enterPasswordDialog} from "fwtoolkit/e2ee/password-dialog"

import type {DocumentOverview} from "./index.js"
import type {FrontendApp} from "../../types.js"
import {documentDialogTemplate, importDocumentTemplate} from "./templates.js"
import {
    HtmlExportDialog,
    EpubExportDialog,
    PdfExportDialog,
    TemplateExportDialog
} from "@fiduswriter/editor/dialogs/index"
import {Node as PMNode} from "prosemirror-model"
import {acceptAllNoInsertions} from "@fiduswriter/document/transform"

/** Return a copy of the document with all tracked changes accepted. */
const resolveDocTrackedChanges = (
    doc: Record<string, unknown>,
    schema: unknown
): Record<string, unknown> => {
    const pmDoc = PMNode.fromJSON(schema as never, doc.content as never)
    const resolved = acceptAllNoInsertions(pmDoc)
    return {...doc, content: resolved.toJSON() as never}
}

const exportProgressCallback = (doc: Record<string, unknown>) => {
    const title = shortFileTitle(doc.title as string, (doc.path as string) || "")
    const task = addProgress("info", `${title}: ${gettext("Exporting...")}`, {
        autoClose: 6000
    })
    return (message: string, percentage: number) => task.update(percentage, message)
}

const getDisplayTitle = (doc: Record<string, unknown>): string => {
    if (doc.e2ee) {
        const cached = sessionStorage.getItem(`e2ee_title_${doc.id}`)
        if (cached !== null) {
            return cached
        }
        if (doc.title) {
            return gettext("Encrypted Document")
        }
    }
    return (doc.title as string) || ""
}

export class DocumentOverviewActions {
    documentOverview: DocumentOverview
    dialogParts: Array<{
        title: string
        description: string
        template: (params: {doc: Record<string, unknown>}) => string
    }>
    onSave: Array<(doc: Record<string, unknown>) => Promise<void>>
    accessRightsTab: any
    accessRightsLoading: boolean

    constructor(documentOverview: DocumentOverview) {
        documentOverview.mod.actions = this
        this.documentOverview = documentOverview
        this.dialogParts = []
        this.onSave = []
        this.accessRightsTab = null
        this.accessRightsLoading = false

        this.dialogParts.push({
            title: gettext("Access Rights"),
            description: gettext("Share your document with others"),
            template: ({doc}) => {
                if (
                    !this.accessRightsLoading &&
                    (!this.accessRightsTab ||
                        this.accessRightsTab.documentIds[0] !== doc.id)
                ) {
                    this.loadAccessRightsTab(doc)
                }
                if (this.accessRightsLoading) {
                    return `<div id="access-rights-settings-tab"><table class="fw-dialog-table"><tr><th></th><td><i class="fa fa-spinner fa-pulse"></i> ${gettext("Loading access rights…")}</td></tr></table></div>`
                }
                return `<div id="access-rights-settings-tab">${this.accessRightsTab.render()}</div>`
            }
        })

        this.onSave.push(doc => {
            if (
                this.accessRightsTab &&
                this.accessRightsTab.documentIds[0] === doc.id
            ) {
                return this.accessRightsTab.submit()
            }
            return Promise.resolve()
        })
    }

    loadAccessRightsTab(doc: Record<string, unknown>): void {
        this.accessRightsLoading = true
        this.accessRightsTab = new AccessRightsTab({
            documentIds: [doc.id as number],
            contacts: this.documentOverview.contacts as any,
            newContactCall: ((memberDetails: Record<string, unknown>) =>
                this.documentOverview.contacts.push(memberDetails as any)) as any,
            e2ee: doc.e2ee as boolean,
            settings: this.documentOverview.app.settings,
            documentApi: this.documentOverview.app.apiConnectors.document,
            contactsApi: this.documentOverview.app.apiConnectors.contacts,
            isOwner: doc.is_owner as boolean
        })
        this.accessRightsTab
            .load()
            .then(() => {
                this.accessRightsLoading = false
                const container = document.querySelector("#access-rights-settings-tab")
                if (container) {
                    this.accessRightsTab.container = container
                    this.accessRightsTab.render()
                    this.accessRightsTab.bindEvents()
                }
            })
            .catch(() => {
                this.accessRightsLoading = false
                const container = document.querySelector("#access-rights-settings-tab")
                if (container) {
                    container.innerHTML = `<p class="fw-ar-error">${gettext("Could not load access rights.")}</p>`
                }
            })
    }

    deleteDocument(id: number): Promise<void> {
        const doc = this.documentOverview.documentList.find(d => d.id === id)
        if (!doc) {
            return Promise.resolve()
        }
        const displayTitle = getDisplayTitle(doc)
        return this.documentOverview.app.apiConnectors.document.deleteDocument({id}).then((json: any) => {
            if ((json as any).done) {
                addAlert(
                    "success",
                    `${gettext("Document has been deleted")}: '${escapeText(longFilePath(displayTitle, doc.path))}'`
                )
                this.documentOverview.documentList =
                    this.documentOverview.documentList.filter(d => d.id !== id)
                this.documentOverview.initTable()
            } else {
                addAlert(
                    "error",
                    `${gettext("Could not delete document")}: '${escapeText(longFilePath(displayTitle, doc.path))}'`
                )
            }
        })
    }

    deleteDocumentDialog(ids: number[], app: FrontendApp): void {
        if (app.isOffline()) {
            addAlert(
                "info",
                gettext("You cannot delete a document while you are offline.")
            )
            return
        }
        const docPaths = ids.map(id => {
            const doc = this.documentOverview.documentList.find(d => d.id === id)!
            return escapeText(longFilePath(getDisplayTitle(doc), doc.path))
        })
        const confirmDeletionDialog = new Dialog({
            title: gettext("Confirm deletion"),
            body: `<p>
                ${
                    ids.length > 1
                        ? gettext("Do you really want to delete the following documents?")
                        : gettext("Do you really want to delete the following document?")
                }
                </p>
                <p>
                ${docPaths.join("<br>")}
                </p>`,
            id: "confirmdeletion",
            icon: "exclamation-triangle",
            buttons: [
                {
                    text: gettext("Delete"),
                    classes: "fw-dark",
                    click: () => {
                        Promise.all(
                            ids.map(id => this.deleteDocument(id))
                        ).then(() => {
                            confirmDeletionDialog.close()
                            this.documentOverview.initTable()
                        })
                    }
                },
                {
                    type: "cancel"
                }
            ]
        } as any)

        confirmDeletionDialog.open()
    }

    async importDocument(): Promise<void> {
        const documentTemplates = this.documentOverview.documentTemplates || {}
        const importIds = Object.keys(documentTemplates)
        let importId = importIds[0]

        const templateSelector =
            importIds.length > 1
                ? `<label for="import-template-selector">${gettext("Import as:")}</label>
                <div class="fw-select-container">
                    <select class="fw-button fw-light fw-large" id="import-template-selector">
                        ${Object.entries(documentTemplates)
                            .map(
                                ([key, template]) =>
                                    `<option value="${escapeText(key)}">${escapeText(template.title as string)}</option>`
                            )
                            .join("")}
                    </select>
                    <div class="fw-select-arrow fa-solid fa-caret-down"></div>
                </div>`
                : ""

        const e2eeMode = this.documentOverview.app.settings.E2EE_MODE as string
        const hasPassphrase = this.documentOverview.hasPassphraseSetUp ?? false

        if (e2eeMode === "required" && !hasPassphrase) {
            addAlert(
                "warning",
                gettext(
                    "You need to set up a personal passphrase before you can import documents."
                )
            )
            return
        }

        let e2eeHtml = ""
        let forceE2EE = false
        if (e2eeMode === "required") {
            forceE2EE = true
            e2eeHtml = `<div class="e2ee-import-note" style="margin-top: 10px;">
                <em>${gettext("This document will be saved as encrypted.")}</em>
            </div>`
        } else if (e2eeMode === "enabled" && hasPassphrase) {
            e2eeHtml = `<div class="e2ee-import-choice" style="margin-top: 10px;">
                <div>
                    <input type="radio" id="import-nonencrypted" name="import-encryption" value="nonencrypted" checked>
                    <label for="import-nonencrypted">${gettext("Non-encrypted")}</label>
                </div>
                <div>
                    <input type="radio" id="import-e2ee" name="import-encryption" value="e2ee">
                    <label for="import-e2ee">${gettext("Encrypted")}</label>
                </div>
            </div>`
        }

        const {importerRegistry} = await import("../importer/register.js")
        const supportedDescriptions = Object.entries(
            importerRegistry.getAllDescriptions() as Record<string, string[]>
        )
            .map(
                ([description, extensions]) =>
                    `${description} (${(extensions as string[]).join(", ")})`
            )
            .join("<br>")
        const supportedFormatsText = `${gettext("Supported formats")}:<p>FIDUS (.fidus)<br>${supportedDescriptions}</p><p>${gettext("You can also upload a ZIP file that contains one file in any of these formats as well as images and/or bibtex file.")}</p>`

        const {FidusFileImporter} = await import("../importer/native/file.js")

        const importDialog = new Dialog({
            id: "import_document",
            title: gettext("Import a document"),
            body: importDocumentTemplate({
                templateSelector,
                e2eeHtml,
                supportedFormatsText
            }),
            height: (importIds.length > 1 ? 260 : 210) + (e2eeHtml ? 60 : 0),
            buttons: [
                {
                    text: gettext("Import"),
                    classes: "fw-dark",
                    click: async () => {
                        const file: File | null = (document.getElementById("doc-uploader") as HTMLInputElement)?.files?.[0] || null
                        if (!file) {
                            return false
                        }
                        if (104857600 < file.size) {
                            addAlert("error", gettext("File too large"))
                            return false
                        }

                        let targetE2EE = forceE2EE
                        if (e2eeMode === "enabled" && hasPassphrase) {
                            targetE2EE =
                                (document.querySelector(
                                    'input[name="import-encryption"]:checked'
                                ) as HTMLInputElement)?.value === "e2ee"
                        }

                        const doImport = async (e2eeOptions: any): Promise<any> => {
                            const isFidus =
                                file!.name.split(".").pop()!.toLowerCase() === "fidus"

                            if (isFidus) {
                                const importer = new FidusFileImporter(
                                    file!,
                                    this.documentOverview.user as unknown as Record<string, unknown>,
                                    this.documentOverview.path,
                                    true,
                                    this.documentOverview.contacts,
                                    e2eeOptions,
                                    this.documentOverview.app.apiConnectors
                                )

                                try {
                    const {ok, statusText, doc} = await (importer as any).init()
                                    deactivateWait()
                                    if (ok) {
                                        addAlert("info", statusText)
                                    } else {
                                        addAlert("error", statusText)
                                        return null
                                    }
                                    this.documentOverview.documentList.push(doc)
                                    this.documentOverview.initTable()
                                    importDialog.close()
                                    return doc
                                } catch (_error) {
                                    deactivateWait()
                                    return null
                                }
                            }

                            if (importIds.length > 1) {
                                importId = (document.getElementById(
                                    "import-template-selector"
                                ) as HTMLSelectElement).value
                            }

                            if (file!.type === "application/zip") {
                                const {default: JSZip} = await import("jszip")
                                const zip = await JSZip.loadAsync(file!)
                                const importerInfo = importerRegistry.getZipImporter(zip)

                                if (!importerInfo) {
                                    addAlert("error", gettext("No importable files found in ZIP"))
                                    deactivateWait()
                                    return
                                }

                                const files = await importerInfo.getContents()
                                const importer = new importerInfo.importer(
                                    files.mainContent,
                                    this.documentOverview.user,
                                    this.documentOverview.path,
                                    importId,
                                    {files, e2eeOptions}
                                )

                                const {ok, statusText, doc} = await (importer as any).init()
                                deactivateWait()
                                if (ok) {
                                    addAlert("info", statusText)
                                } else {
                                    addAlert("error", statusText)
                                    return null
                                }
                                this.documentOverview.documentList.push(doc)
                                this.documentOverview.initTable()
                                importDialog.close()
                                return doc
                            }

                            const fileExtension = file!.name.split(".").pop()!.toLowerCase()
                            const importerInfo = importerRegistry.getImporter(fileExtension)

                            if (!importerInfo) {
                                addAlert("error", gettext("Unsupported file format"))
                                deactivateWait()
                                return
                            }

                            const options: any = {
                                bibDB: this.documentOverview.app.bibDB,
                                files: {},
                                e2eeOptions,
                                apiConnectors: this.documentOverview.app.apiConnectors
                            }

                            const importer = new importerInfo.importer(
                                file!,
                                this.documentOverview.user,
                                this.documentOverview.path,
                                importId,
                                options
                            )

                            const {ok, statusText, doc} = await (importer as any).init()
                            deactivateWait()
                            if (ok) {
                                addAlert("info", statusText)
                            } else {
                                addAlert("error", statusText)
                                return null
                            }
                            this.documentOverview.documentList.push(doc)
                            this.documentOverview.initTable()
                            importDialog.close()
                            return doc
                        }

                        if (targetE2EE) {
                            activateWait()

                            const importWithAutoPassword = async () => {
                                const password =
                                    await PassphraseManager.generateDocumentPassword()
                                const salt = window.crypto.getRandomValues(new Uint8Array(16))
                                const iterations = 600000
                                const key = await PassphraseManager.resolvePasswordToKey(
                                    password,
                                    salt,
                                    iterations
                                )
                                const e2eeOptions = {
                                    enabled: true,
                                    key,
                                    salt: btoa(String.fromCharCode(...salt)),
                                    iterations
                                }
                                const doc = await doImport(e2eeOptions)
                                if (doc?.id) {
                                    try {
                                        await PassphraseManager.saveDocumentPassword(
                                            doc.id,
                                            password,
                                            null as any,
                                            "user",
                                            true
                                        )
                                    } catch (err) {
                                        console.error(
                                            "Failed to save document password for imported document:",
                                            err
                                        )
                                    }
                                }
                            }

                            if (PassphraseManager.hasKeysInSession()) {
                                try {
                                    await importWithAutoPassword()
                                } catch (error) {
                                    deactivateWait()
                                    addAlert("error", gettext("Could not create encrypted document."))
                                    console.error(error)
                                }
                            } else {
                                deactivateWait()
                                let errorMessage = ""
                                let done = false
                                while (!done) {
                                    const result: any = await new Promise(resolve => {
                                        enterPassphraseDialog(
                                            (pwd: string) => resolve({action: "unlock", passphrase: pwd}),
                                            () => resolve({action: "recover"}),
                                            {errorMessage}
                                        )
                                    })
                                    if (result?.action === "unlock" && result.passphrase) {
                                        activateWait()
                                        try {
                                            await PassphraseManager.unlockWithPassphrase(
                                                result.passphrase
                                            )
                                            await importWithAutoPassword()
                                            done = true
                                        } catch (err: any) {
                                            deactivateWait()
                                            if (err instanceof DOMException || err.name === "OperationError") {
                                                errorMessage = gettext("Incorrect passphrase. Please try again.")
                                            } else {
                                                addAlert("error", gettext("Could not create encrypted document."))
                                                console.error(err)
                                                done = true
                                            }
                                        }
                                    } else if (result?.action === "recover") {
                                        const {recoverWithKeyDialog, showRecoveryKeyDialog} =
                                            await import("fwtoolkit/e2ee/passphrase-dialog")
                                        const recoverResult: any = await new Promise(resolve => {
                                            recoverWithKeyDialog(resolve)
                                        })
                                        if (recoverResult) {
                                            activateWait()
                                            try {
                                                const {newRecoveryKey} =
                                                    await PassphraseManager.recoverWithRecoveryKey(
                                                        recoverResult.recoveryKey,
                                                        recoverResult.newPassphrase
                                                    )
                                                await new Promise(resolve =>
                                                    showRecoveryKeyDialog(newRecoveryKey, resolve as any)
                                                )
                                                await importWithAutoPassword()
                                                done = true
                                            } catch (_err) {
                                                deactivateWait()
                                                errorMessage = gettext(
                                                    "Recovery failed. Please check your recovery key and try again."
                                                )
                                            }
                                        }
                                    } else {
                                        done = true
                                    }
                                }
                            }
                        } else {
                            activateWait()
                            doImport(null)
                        }
                        return undefined
                    }
                },
                {type: "cancel"}
            ]
        } as any)
        importDialog.open()

        const uploader = document.getElementById("doc-uploader")
        if (uploader) {
            uploader.addEventListener("change", () => {
                const fileInput = uploader as HTMLInputElement
                const nameEl = document.getElementById("import-doc-name")
                if (nameEl) {
                    nameEl.innerHTML = fileInput.value.replace(
                        /C:\\fakepath\\/i,
                        ""
                    )
                }
                const templateContainer = document.getElementById(
                    "import-template-selector-container"
                )
                if (templateContainer) {
                    const selectedFile = fileInput.files?.[0]
                    if (selectedFile) {
                        const extension = selectedFile.name
                            .split(".")
                            .pop()
                            ?.toLowerCase()
                        templateContainer.style.display =
                            extension === "fidus" ? "none" : "block"
                    } else {
                        templateContainer.style.display = "none"
                    }
                }
            })
        }

        const docBtn = document.getElementById("import-doc-btn")
        if (docBtn) {
            docBtn.addEventListener("click", event => {
                ;(document.getElementById("doc-uploader") as HTMLElement).click()
                event.preventDefault()
            })
        }
    }

    copyFiles(ids: number[]): void {
        // Use dynamic import for tools
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() => {
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(
                        entry => entry.id === id
                    )
                    if (!doc) return
                    const copier = new SaveCopy(
                        doc,
                        {db: doc.bibliography as any},
                        {db: doc.images as any},
                        this.documentOverview.user as any,
                        null,
                        null,
                        this.documentOverview.app.apiConnectors.documentImport
                    )

                    copier
                        .init()
                        .then(({doc: newDoc}: any) => {
                            this.documentOverview.documentList.push(newDoc)
                            this.documentOverview.initTable()
                        })
                        .catch(() => false)
                })
            })
        })
    }

    copyFilesAs(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() => {
                const docs = ids.map(id =>
                    this.documentOverview.documentList.find(entry => entry.id === id)
                )
                const allE2EE = docs.every(doc => doc?.e2ee)
                const anyE2EE = docs.some(doc => doc?.e2ee)
                const e2eeMode = this.documentOverview.app.settings.E2EE_MODE as string

                const canToggleE2EE =
                    e2eeMode === "enabled" ||
                    (e2eeMode === "required" && !allE2EE) ||
                    (e2eeMode === "disabled" && anyE2EE)

                let e2eeHtml = ""
                if (canToggleE2EE) {
                    const checked = e2eeMode === "required" || allE2EE ? "checked" : ""
                    e2eeHtml = `
                        <div class="e2ee-copy-toggle" style="margin-top: 15px;">
                            <label>
                                <input type="checkbox" id="e2ee-copy-toggle" ${checked}>
                                ${gettext("Encrypt the copy")}
                            </label>
                        </div>
                    `
                }

                const selectTemplateDialog = new Dialog({
                    title: gettext("Choose document template"),
                    body: `<p>
                        ${ids.length > 1 ? gettext("Select document template for copies") : gettext("Select document template for copy.")}
                        </p>
                        <select class="fw-button fw-large fw-light">${Object.entries(
                            this.documentOverview.documentTemplates
                        )
                            .map(
                                ([importId, dt]) =>
                                    `<option value="${escapeText(importId)}">${escapeText(dt.title as string)}</option>`
                            )
                            .join("")}</select>
                        ${e2eeHtml}`,
                    buttons: [
                        {
                            text: gettext("Copy"),
                            classes: "fw-dark",
                            click: () => {
                                const targetE2EE =
                                    canToggleE2EE &&
                                    (selectTemplateDialog.dialogEl.querySelector(
                                        "#e2ee-copy-toggle"
                                    ) as HTMLInputElement)?.checked

                                const doCopy = (sourceKey: any, targetPassword: string | null) => {
                                    ids.forEach(id => {
                                        const doc = this.documentOverview.documentList.find(
                                            entry => entry.id === id
                                        )
                                        if (!doc) return
                                        const e2eeOptions: any = {}
                                        if (doc.e2ee && sourceKey) {
                                            e2eeOptions.sourceKey = sourceKey
                                        }
                                        if (targetE2EE && targetPassword) {
                                            e2eeOptions.targetE2EE = true
                                            e2eeOptions.targetPassword = targetPassword
                                        }

                                        const copier = new SaveCopy(
                                            doc,
                                            {db: doc.bibliography as any},
                                            {db: doc.images as any},
                                            this.documentOverview.user as any,
                                            (selectTemplateDialog.dialogEl.querySelector(
                                                "select"
                                            ) as HTMLSelectElement).value,
                                            e2eeOptions,
                                            this.documentOverview.app
                                                .apiConnectors.documentImport
                                        )

                                        copier
                                            .init()
                                            .then(({doc: newDoc}: any) => {
                                                this.documentOverview.documentList.push(newDoc)
                                                this.documentOverview.initTable()
                                            })
                                            .catch((error: Error) => {
                                                console.error(error)
                                                addAlert("error", gettext("Could not copy document."))
                                            })
                                    })
                                    selectTemplateDialog.close()
                                }

                                if (anyE2EE && !targetE2EE) {
                                    enterPasswordDialog(async (password: string) => {
                                        try {
                                            const sampleDoc = docs.find(doc => doc?.e2ee)!
                                            const salt = new Uint8Array(
                                                atob(sampleDoc.e2ee_salt as string)
                                                    .split("")
                                                    .map(c => c.charCodeAt(0))
                                            )
                                            const key = await E2EEKeyManager.deriveKey(
                                                password,
                                                salt,
                                                (sampleDoc.e2ee_iterations as number) || 600000
                                            )
                                            doCopy(key, null)
                                        } catch (_err) {
                                            addAlert("error", gettext("Incorrect password."))
                                        }
                                    })
                                } else if (!anyE2EE && targetE2EE) {
                                    createPasswordDialog((password: string) => {
                                        doCopy(null, password)
                                    })
                                } else if (anyE2EE && targetE2EE) {
                                    enterPasswordDialog(async (password: string) => {
                                        try {
                                            const sampleDoc = docs.find(doc => doc?.e2ee)!
                                            const salt = new Uint8Array(
                                                atob(sampleDoc.e2ee_salt as string)
                                                    .split("")
                                                    .map(c => c.charCodeAt(0))
                                            )
                                            const key = await E2EEKeyManager.deriveKey(
                                                password,
                                                salt,
                                                (sampleDoc.e2ee_iterations as number) || 600000
                                            )
                                            createPasswordDialog((targetPassword: string) => {
                                                doCopy(key, targetPassword)
                                            })
                                        } catch (_err) {
                                            addAlert("error", gettext("Incorrect password."))
                                        }
                                    })
                                } else {
                                    doCopy(null, null)
                                }
                            }
                        },
                        {type: "cancel"}
                    ]
                } as any)
                selectTemplateDialog.open()
            })
        })
    }

    downloadNativeFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    new ExportFidusFile(
                        this.documentOverview.app,
                        doc as any,
                        {db: doc.bibliography as any},
                        {db: doc.images as any}
                    )
                })
            )
        })
    }

    downloadSlimNativeFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    new ExportFidusFile(
                        this.documentOverview.app,
                        doc as any,
                        {db: doc.bibliography as any},
                        {db: doc.images as any},
                        false
                    )
                })
            )
        })
    }

    async downloadHTMLFiles(ids: number[]): Promise<void> {
        const dialog = new HtmlExportDialog()
        const options = await dialog.init()
        if (!options) {
            return
        }
        const converterOptions: Record<string, unknown> = {}
        if (options.svgMath) {
            converterOptions.mathOutput = "svg"
        }
        if (!options.resolveTrackChanges) {
            converterOptions.trackChanges = true
        }
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const found = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!found) return
                    const doc = options.resolveTrackChanges
                        ? resolveDocTrackedChanges(
                              found as Record<string, unknown>,
                              this.documentOverview.schema
                          )
                        : found
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/html/index").then(
                        ({HTMLExporter}) => {
                            const exporter = new HTMLExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000),
                                this.documentOverview.documentStyles,
                                converterOptions
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    async downloadTemplateExportFiles(
        ids: number[],
        templateUrl: string,
        templateType: string
    ): Promise<void> {
        const dialog = new TemplateExportDialog()
        const options = await dialog.init(templateType === "docx" ? "docx" : "odt")
        if (!options) {
            return
        }
        const resolveTrackChanges = options.resolveTrackChanges
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() => {
                ids.forEach(id => {
                    const found = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!found) return
                    const doc = resolveTrackChanges
                        ? resolveDocTrackedChanges(
                              found as Record<string, unknown>,
                              this.documentOverview.schema
                          )
                        : found
                    const progressCallback = exportProgressCallback(doc!)
                    if (templateType === "docx") {
                        import("@fiduswriter/document/exporter/docx/index").then(
                            ({DOCXExporter}) => {
                                const exporter = new DOCXExporter(
                                    doc as any,
                                    templateUrl,
                                    {db: doc!.bibliography as any},
                                    {db: doc!.images as any},
                                    this.documentOverview.app.csl as any
                                )
                                exporter.progressCallback = progressCallback as any
                                exporter.init()
                            }
                        )
                    } else {
                        import("@fiduswriter/document/exporter/odt/index").then(
                            ({ODTExporter}) => {
                                const exporter = new ODTExporter(
                                    doc as any,
                                    templateUrl,
                                    {db: doc!.bibliography as any},
                                    {db: doc!.images as any},
                                    this.documentOverview.app.csl as any
                                )
                                exporter.progressCallback = progressCallback as any
                                exporter.init()
                            }
                        )
                    }
                })
            })
        })
    }

    downloadLatexFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/latex/index").then(
                        ({LatexExporter}) => {
                            const exporter = new LatexExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                new Date((doc!.updated as number) * 1000)
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    downloadJATSFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/jats/index").then(
                        ({JATSExporter}) => {
                            const exporter = new JATSExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000),
                                "article"
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    downloadBITSFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/jats/index").then(
                        ({JATSExporter}) => {
                            const exporter = new JATSExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000),
                                "book-part-wrapper"
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    downloadTEIFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/tei/index").then(
                        ({TEIExporter}) => {
                            const exporter = new TEIExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000)
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    downloadMarkdownFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/markdown/index").then(
                        ({MarkdownExporter}) => {
                            const exporter = new MarkdownExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                new Date((doc!.updated as number) * 1000)
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    downloadTypstFiles(ids: number[]): void {
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const doc = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!doc) return
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/typst/index").then(
                        ({TypstExporter}) => {
                            const exporter = new TypstExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                new Date((doc!.updated as number) * 1000)
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    async downloadEpubFiles(ids: number[]): Promise<void> {
        const dialog = new EpubExportDialog()
        const options = await dialog.init()
        if (!options) {
            return
        }
        const converterOptions: Record<string, unknown> = {}
        if (options.svgMath) {
            converterOptions.mathOutput = "svg"
        }
        if (!options.resolveTrackChanges) {
            converterOptions.trackChanges = true
        }
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(() =>
                ids.forEach(id => {
                    const found = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!found) return
                    const doc = options.resolveTrackChanges
                        ? resolveDocTrackedChanges(
                              found as Record<string, unknown>,
                              this.documentOverview.schema
                          )
                        : found
                    const progressCallback = exportProgressCallback(doc!)
                    import("@fiduswriter/document/exporter/epub/index").then(
                        ({EpubExporter}) => {
                            const exporter = new EpubExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000),
                                this.documentOverview.documentStyles,
                                converterOptions
                            )
                            exporter.progressCallback = progressCallback as any
                            exporter.init()
                        }
                    )
                })
            )
        })
    }

    async downloadPdfFiles(ids: number[]): Promise<void> {
        const dialog = new PdfExportDialog()
        const options = await dialog.init()
        if (!options) {
            return
        }
        import("../tools.js").then(({getMissingDocumentListData}) => {
            getMissingDocumentListData(
                ids,
                this.documentOverview.documentList as any,
                this.documentOverview.schema,
                this.documentOverview.app.apiConnectors.document
            ).then(async () => {
                for (const id of ids) {
                    const found = this.documentOverview.documentList.find(entry => entry.id === id)
                    if (!found) {
                        continue
                    }
                    const doc = options.resolveTrackChanges
                        ? resolveDocTrackedChanges(
                              found as Record<string, unknown>,
                              this.documentOverview.schema
                          )
                        : found
                    const progressCallback = exportProgressCallback(doc!)
                    let fidusFile: Uint8Array | undefined
                    if (options.embedFidusFile && !doc!.e2ee) {
                        // Encrypted documents are skipped: their source can
                        // only be assembled with the document owner's key.
                        const blob = (await new ExportFidusFile(
                            this.documentOverview.app,
                            doc as any,
                            {db: doc!.bibliography as any},
                            {db: doc!.images as any},
                            true,
                            undefined,
                            false
                        )) as unknown as Blob
                        fidusFile = new Uint8Array(await blob.arrayBuffer())
                    }
                    await import("@fiduswriter/document/exporter/pdf/index").then(
                        ({PdfExporter}) => {
                            const exporter = new PdfExporter(
                                doc as any,
                                {db: doc!.bibliography as any},
                                {db: doc!.images as any},
                                this.documentOverview.app.csl as any,
                                new Date((doc!.updated as number) * 1000),
                                this.documentOverview.documentStyles,
                                progressCallback as any,
                                {
                                    version: (
                                        this.documentOverview.app.settings as {
                                            VERSION?: string
                                        }
                                    ).VERSION,
                                    userName:
                                        this.documentOverview.app.user?.name ||
                                        this.documentOverview.app.user
                                            ?.username ||
                                        undefined,
                                    fidusFile,
                                    pdfA: options.pdfA,
                                    pdfUa: options.pdfUa,
                                    embedSourceHtml:
                                        options.embedSourceHtml || undefined,
                                    figurePageFloats:
                                        options.figurePageFloats,
                                    tablePageFloats: options.tablePageFloats,
                                    printOptions: options.printOptions,
                                    printEngine: (
                                        this.documentOverview.app.settings as {
                                            PRINT_ENGINE?: string
                                        }
                                    ).PRINT_ENGINE
                                }
                            )
                            return exporter.init()
                        }
                    )
                }
            })
        })
    }

    settingsDocumentDialog(docId: number): void {
        const doc = this.documentOverview.documentList.find(entry => entry.id === docId)
        if (!doc || !this.dialogParts.length) {
            return
        }
        const body = documentDialogTemplate({doc, dialogParts: this.dialogParts})
        const dialog = new Dialog({
            width: 840,
            height: 520,
            title: `${gettext("Document Settings")}: ${escapeText(doc.title as string)}`,
            body,
            buttons: [
                {
                    text: gettext("Submit"),
                    classes: "fw-dark",
                    click: () => {
                        return Promise.all(
                            this.onSave.map(method => method(doc))
                        ).then(() => dialog.close())
                    }
                },
                {type: "cancel"}
            ]
        } as any)
        dialog.open()
        const dialogTabs = new DialogTabs(
            this.dialogParts.map((part, index) => ({
                id: `docOptionTab${index}`,
                title: part.title,
                description: part.description,
                template: () => ""
            })),
            {containerId: "documentoptions-tab"}
        )
        dialogTabs.bind(dialog.dialogEl.querySelector("#documentoptions-tab")!)
    }

    revisionsDialog(documentId: number, app: FrontendApp): void {
        if (app.isOffline()) {
            addAlert(
                "info",
                gettext(
                    "You cannot view the revision history of a document while you are offline."
                )
            )
            return
        }
        import("../revisions/index.js").then(({DocumentRevisionsDialog}) => {
            const revDialog = new DocumentRevisionsDialog(
                documentId,
                this.documentOverview.documentList,
                this.documentOverview.user as unknown as Record<string, unknown>,
                this.documentOverview.app.apiConnectors
            )
            revDialog.init().then((actionObject: any) => {
                switch (actionObject.action) {
                    case "added-document":
                        this.documentOverview.documentList.push(actionObject.doc)
                        this.documentOverview.initTable()
                        break
                    case "deleted-revision":
                        actionObject.doc.revisions = actionObject.doc.revisions.filter(
                            (rev: any) => rev.pk !== actionObject.id
                        )
                        this.documentOverview.initTable()
                        break
                }
            })
        })
    }
}


