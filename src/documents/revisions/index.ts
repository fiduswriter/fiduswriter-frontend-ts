import download from "downloadjs"

import {
    Dialog,
    addAlert,
    cancelPromise,
    deactivateWait,
    escapeText,
    findTarget,
    longFilePath,
    shortFileTitle
} from "fwtoolkit"

import {FidusFileImporter} from "../importer/native/file.js"
import {documentrevisionsTemplate} from "./templates.js"
import type {ApiConnectors} from "../../api/index.js"

export class DocumentRevisionsDialog {
    documentId: number
    documentList: Array<Record<string, unknown>>
    user: Record<string, unknown>
    apiConnectors: ApiConnectors
    dialog: any

    constructor(
        documentId: number,
        documentList: Array<Record<string, unknown>>,
        user: Record<string, unknown>,
        apiConnectors: ApiConnectors
    ) {
        this.documentId = documentId
        this.documentList = documentList
        this.user = user
        this.apiConnectors = apiConnectors
        this.dialog = false
    }

    init(): Promise<any> {
        const doc = this.documentList.find(doc => doc.id === this.documentId)
        if (!doc) {
            return Promise.reject(new Error("Document not found"))
        }
        this.dialog = new Dialog({
            title: `${gettext("Saved revisions of")} ${escapeText(shortFileTitle(doc.title as string, doc.path as string))}`,
            id: "revisions-dialog",
            width: 620,
            height: 480,
            buttons: [{type: "close"}],
            body: documentrevisionsTemplate({doc})
        } as any)
        this.dialog.open()
        return this.bind()
    }

    bind(): Promise<any> {
        const dialogEl = this.dialog.dialogEl

        return new Promise(resolve => {
            dialogEl.addEventListener("click", (event: Event) => {
                const el: Record<string, any> = {}
                let revisionId: number
                let revisionFilename: string
                switch (true) {
                    case findTarget(event, ".download-revision", el):
                        revisionId = Number.parseInt(el.target.dataset.id)
                        revisionFilename = el.target.dataset.filename
                        this.download(revisionId, revisionFilename)
                        break
                    case findTarget(event, ".recreate-revision", el):
                        revisionId = Number.parseInt(el.target.dataset.id)
                        resolve(
                            this.recreate(revisionId, this.user)
                        )
                        break
                    case findTarget(event, ".delete-revision", el):
                        revisionId = Number.parseInt(el.target.dataset.id)
                        resolve(this.delete(revisionId))
                        break
                    default:
                        break
                }
            })
        })
    }

    recreate(id: number, user: Record<string, unknown>): Promise<any> {
        const doc = this.documentList.find(doc => doc.id === this.documentId)
        if (!doc) {
            return Promise.reject(new Error("Document not found"))
        }
        return this.apiConnectors.revision.getRevisionBlob(id)
            .then(blob => {
                const importer = new FidusFileImporter(
                    blob,
                    user,
                    longFilePath(
                        doc.title as string,
                        doc.path as string,
                        `${gettext("Revision of")} `
                    ),
                    false,
                    [],
                    null,
                    this.apiConnectors
                )
                return (importer as any).init()
            })
            .then(({ok, statusText, doc: newDoc}: any) => {
                deactivateWait()
                if (ok) {
                    addAlert("info", statusText)
                    return {
                        action: "added-document",
                        doc: newDoc
                    }
                } else {
                    addAlert("error", statusText)
                    return Promise.reject(new Error(statusText))
                }
            })
    }

    download(id: number, filename: string): void {
        this.apiConnectors.revision.getRevisionBlob(id)
            .then(blob => download(blob, filename, "application/vnd.fiduswriter+zip"))
    }

    delete(id: number): Promise<any> {
        const buttons: Array<Record<string, unknown>> = []
        const returnPromise = new Promise((resolve, _reject) => {
            buttons.push({
                text: gettext("Delete"),
                classes: "fw-dark",
                click: () => {
                    const revisionsConfirmDeleteDialog = buttons_container.dialog
                    revisionsConfirmDeleteDialog.close()
                    resolve(this.deleteRevision(id))
                }
            })
            buttons.push({
                type: "cancel",
                click: () => {
                    const revisionsConfirmDeleteDialog = buttons_container.dialog
                    revisionsConfirmDeleteDialog.close()
                    resolve(cancelPromise())
                }
            })
        })

        const revisionsConfirmDeleteDialog = new Dialog({
            id: "confirmdeletion",
            title: gettext("Confirm deletion"),
            icon: "exclamation-triangle",
            body: `${gettext("Do you really want to delete the revision?")}`,
            height: 80,
            buttons
        } as any)

        const buttons_container = {dialog: revisionsConfirmDeleteDialog}

        revisionsConfirmDeleteDialog.open()

        return returnPromise
    }

    deleteRevision(id: number): Promise<any> {
        return this.apiConnectors.revision.deleteRevision({id})
            .then(() => {
                const thisTr = document.querySelector(`tr.revision-${id}`) as HTMLElement
                const documentId = thisTr.dataset.document
                const doc = this.documentList.find(
                    d => d.id === Number.parseInt(documentId!)
                )
                thisTr.parentElement!.removeChild(thisTr)
                addAlert("success", gettext("Revision deleted"))
                return Promise.resolve({
                    action: "deleted-revision",
                    id,
                    doc
                })
            })
            .catch(() => {
                addAlert("error", gettext("Could not delete revision."))
                return Promise.reject(new Error("Could not delete revision."))
            })
    }
}
