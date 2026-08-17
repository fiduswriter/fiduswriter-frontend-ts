import JSZip from "jszip"

import {updateFile} from "@fiduswriter/document/importer/native/update"
import {updateDoc} from "@fiduswriter/document/schema/convert"
import {FW_DOCUMENT_VERSION} from "@fiduswriter/document/schema/index"
import {addAlert, findTarget, whenReady} from "fwtoolkit"

import type {
    OldDocsResponse,
    RevisionIdsResponse,
    TemplateBaseResponse,
    TemplateIdsResponse,
    UserBibListResponse
} from "../api/index.js"
import type {FrontendApp} from "../types.js"

export class DocMaintenance {
    app: FrontendApp
    batch: number
    revSavesLeft: number
    docTemplatesSavesLeft: number

    constructor(app: FrontendApp) {
        this.app = app
        this.batch = 0
        this.revSavesLeft = 0
        this.docTemplatesSavesLeft = 0
    }

    init(): void {
        whenReady().then(() =>
            document.body.addEventListener("click", (event: Event) => {
                const el: Record<string, any> = {}
                switch (true) {
                    case findTarget(event, "input#update:not(.fw-disabled)", el):
                        ;(document.querySelector("input#update") as HTMLInputElement).disabled = true
                        ;(document.querySelector("input#update") as HTMLInputElement).value =
                            gettext("Updating...")
                        addAlert("info", gettext("Updating documents."))
                        this.getDocBatch()
                        break
                    default:
                        break
                }
            })
        )
    }

    getDocBatch(): void {
        this.batch++
        this.app.apiConnectors.maintenance.getAllOldDocs()
            .then((json: OldDocsResponse) => {
                const docs = window.JSON.parse(json.docs)
                if (docs.length) {
                    addAlert("info", `${gettext("Downloaded batch")}: ${this.batch}`)
                    Promise.all(docs.map((doc: any) => this.fixDoc(doc))).then(() =>
                        this.getDocBatch()
                    )
                } else {
                    if (this.batch > 1) {
                        addAlert("success", gettext("All documents updated!"))
                    } else {
                        addAlert("info", gettext("No documents to update."))
                    }
                    this.updateDocumentTemplates()
                }
            })
            .catch((error: Error) => {
                addAlert("error", `${gettext("Could not download batch")}: ${this.batch}`)
                throw error
            })
    }

    fixDoc(doc: any): Promise<void> {
        const oldDoc = {
            content: doc.fields.content,
            diffs: doc.fields.diffs,
            bibliography: doc.fields.bibliography,
            comments: doc.fields.comments,
            title: doc.fields.title,
            version: doc.fields.version,
            id: doc.pk
        }
        const docVersion = Number.parseFloat(doc.fields.doc_version)
        let p: Promise<any>
        if (docVersion < 2) {
            p = this.app.apiConnectors.maintenance.getUserBibList({
                user_id: doc.fields.owner
            }).then((json: UserBibListResponse) => {
                return json.bibList.reduce((db: any, item: any) => {
                    const id = item["id"]
                    const bibDBEntry: any = {}
                    bibDBEntry["fields"] = JSON.parse(item["fields"])
                    bibDBEntry["bib_type"] = item["bib_type"]
                    bibDBEntry["entry_key"] = item["entry_key"]
                    db[id] = bibDBEntry
                    return db
                }, {})
            })
        } else {
            p = Promise.resolve(doc.bibliography)
        }
        return p.then((bibliography: any) => {
            const updatedDoc = updateDoc(oldDoc, docVersion, bibliography)
            return this.saveDoc(updatedDoc)
        })
    }

    saveDoc(doc: any): Promise<void> {
        const p1 = this.app.apiConnectors.maintenance.saveDoc({
            id: doc.id,
            content: doc.content,
            bibliography: doc.bibliography,
            comments: doc.comments,
            version: doc.version,
            diffs: doc.diffs
        })
        const promises = [p1]
        if (doc.imageIds) {
            const p2 = this.app.apiConnectors.maintenance.addImagesToDoc({
                doc_id: doc.id,
                ids: doc.imageIds
            })
            promises.push(p2)
        }
        return Promise.all(promises).then(() => {
            addAlert("success", `${gettext("The document has been updated")}: ${doc.id}`)
        })
    }

    updateDocumentTemplates(): void {
        addAlert("info", gettext("Updating document templates."))
        this.app.apiConnectors.maintenance.getAllTemplateIds().then((json: TemplateIdsResponse) => {
            const count = json.template_ids.length
            if (count) {
                json.template_ids.forEach((templateId: number) =>
                    this.updateDocumentTemplate(templateId)
                )
            } else {
                addAlert("info", gettext("No document templates to update."))
                this.updateRevisions()
            }
        })
    }

    updateDocumentTemplate(id: number): void {
        this.app.apiConnectors.maintenance.getTemplateBase({id}).then(
            (json: TemplateBaseResponse) => {
                const oldDoc = {
                    content: json.content,
                    diffs: [],
                    bibliography: {},
                    comments: {},
                    title: json.title,
                    version: 1,
                    id
                }
                const docVersion = Number.parseFloat(json.doc_version)
                const doc = updateDoc(oldDoc, docVersion)
                this.saveDocumentTemplate(doc)
            }
        )
    }

    saveDocumentTemplate(doc: any): void {
        this.docTemplatesSavesLeft++
        this.app.apiConnectors.maintenance.saveTemplate({
            id: doc.id,
            content: doc.content
        }).then(() => {
            addAlert(
                "success",
                `${gettext("The document template has been updated")}: ${doc.id}`
            )
            this.docTemplatesSavesLeft--
            if (!this.docTemplatesSavesLeft) {
                addAlert("success", gettext("All document templates updated!"))
                this.updateRevisions()
            }
        })
    }

    updateRevisions(): void {
        addAlert("info", gettext("Updating saved revisions."))
        this.app.apiConnectors.maintenance.getAllRevisionIds().then((json: RevisionIdsResponse) => {
            this.revSavesLeft = json.revision_ids.length
            if (this.revSavesLeft) {
                json.revision_ids.forEach((revId: number) => this.updateRevision(revId))
            } else {
                addAlert("info", gettext("No document revisions to update."))
                this.done()
            }
        })
    }

    updateRevision(id: number): void {
        this.app.apiConnectors.maintenance.getRevision(id)
            .then((response: Response) => response.blob())
            .then((blob: Blob) => {
                const zipfs = new JSZip()
                return zipfs.loadAsync(blob).then(() => {
                    const openedFiles: Record<string, string> = {}
                    const p: Array<Promise<void>> = []
                    const fileNames = [
                        "filetype-version",
                        "document.json",
                        "bibliography.json"
                    ]

                    fileNames.forEach(fileName => {
                        p.push(
                            (zipfs.files[fileName] as any)
                                .async("text")
                                .then((fileContent: string) => {
                                    openedFiles[fileName] = fileContent
                                })
                        )
                    })
                    return Promise.all(p).then(() => {
                        const filetypeVersion = Number.parseFloat(
                            openedFiles["filetype-version"]
                        )
                        // @ts-ignore
                        const {bibliography, doc} = updateFile(
                            window.JSON.parse(openedFiles["document.json"]),
                            filetypeVersion,
                            window.JSON.parse(openedFiles["bibliography.json"])
                        )
                        zipfs.file("filetype-version", FW_DOCUMENT_VERSION)
                        zipfs.file("document.json", window.JSON.stringify(doc))
                        zipfs.file("bibliography.json", window.JSON.stringify(bibliography))
                        this.saveRevision(id, zipfs)
                    })
                })
            })
    }

    saveRevision(id: number, zipfs: JSZip): void {
        zipfs
            .generateAsync({type: "blob", mimeType: "application/vnd.fiduswriter+zip"})
            .then((blob: Blob) => {
                this.app.apiConnectors.maintenance.updateRevision(id, blob).then(() => {
                    addAlert(
                        "success",
                        gettext("The document revision has been updated: ") + id
                    )
                    this.revSavesLeft--
                    if (this.revSavesLeft === 0) {
                        this.done()
                    }
                })
            })
    }

    done(): void {
        ;(document.querySelector("input#update") as HTMLInputElement).value = gettext(
            "All documents, document templates and document revisions updated!"
        )
    }
}
