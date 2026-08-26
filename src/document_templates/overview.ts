import {baseBodyTemplate} from "../common/index.js"
import {FeedbackTab} from "../feedback/index.js"
import {SiteMenu} from "../menu/index.js"
import {
    OverviewDataTable,
    OverviewMenuView,
    addAlert,
    ensureCSS,
    escapeText,
    findTarget,
    setDocTitle,
    whenReady
} from "fwtoolkit"

import type {FrontendApp, User} from "../types.js"
import {DocTemplatesActions} from "./actions.js"
import {bulkMenuModel, menuModel} from "./menu.js"

interface AppLike extends FrontendApp {
    csl: {getStyles: () => Promise<any>}
    indexedDB: {
        readAllData: (store: string) => Promise<Array<Record<string, unknown>>>
        clearData: (store: string) => Promise<void>
        insertData: (store: string, data: Array<Record<string, unknown>>) => Promise<void>
    }
    page: unknown
}

export class DocTemplatesOverview {
    app: AppLike
    user: User
    mod: {actions?: DocTemplatesActions}
    templateList: Array<Record<string, unknown>>
    styles: any
    lastSort: {column: number; dir: string}
    dom!: HTMLElement
    table: any
    overviewTable: any
    dtBulk: any
    menu: any

    constructor({app, user}: {app: AppLike; user: User}) {
        this.app = app
        this.user = user
        this.mod = {}
        this.templateList = []
        this.styles = false

        this.lastSort = {column: 0, dir: "asc"}
    }

    init(): Promise<void> {
        return whenReady().then(() => {
            this.render()
            const smenu = new SiteMenu(this.app, "templates")
            smenu.init()
            new DocTemplatesActions(this)
            this.menu = new OverviewMenuView(this, menuModel as any)
            this.menu.init()
            this.bind()
            return this.getTemplateListData()
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
        document.body = this.dom
        ensureCSS([
            staticUrl("css/fwtoolkit/add_remove_dialog.css"),
            staticUrl("css/editor/access_rights_dialog.css")
        ])
        setDocTitle(gettext("Document Templates Overview"), this.app)
        const feedbackTab = new FeedbackTab(this.app)
        feedbackTab.init()
    }

    onResize(): void {
        if (!this.table) {
            return
        }
        this.initTable()
    }

    initTable(): void {
        if (this.overviewTable) {
            this.overviewTable.destroy()
            this.overviewTable = null
        }
        this.table = null
        this.dtBulk = null

        const contentsEl = this.dom.querySelector(".fw-contents") as HTMLElement
        contentsEl.innerHTML = ""

        const hiddenCols = [0]

        if (window.innerWidth < 500) {
            hiddenCols.push(1)
        }

        this.overviewTable = new OverviewDataTable({
            dom: contentsEl,
            classes: ["fw-data-table", "fw-large"],
            columns: [
                {select: 0, type: "number"},
                {select: 1, sortable: false, type: "boolean"},
                {select: hiddenCols, hidden: true},
                {select: 5, sortable: false},
                {select: [this.lastSort.column], sort: this.lastSort.dir}
            ],
            data: this.templateList.map(docTemplate =>
                this.createTableRow(docTemplate)
            ),
            idColumn: 0,
            checkboxColumn: 1,
            bulkMenu: bulkMenuModel(),
            bulkMenuPage: this,
            searchable: true,
            scrollY: `${Math.max(window.innerHeight - 360, 100)}px`,
            tabIndex: 1,
            labels: {
                noRows: gettext("No document templates available"),
                noResults: gettext("No document templates found")
            },
            headings: [
                "", "",
                gettext("Title"),
                gettext("Created"),
                gettext("Last changed"),
                ""
            ],
            template: (options: any, _dom: any) =>
                `<div class='${options.classes.container}'${options.scrollY.length ? ` style='height: ${options.scrollY}; overflow-Y: auto;'` : ""}></div>
            <div class='${options.classes.bottom}'>
                <nav class='${options.classes.pagination}'></nav>
            </div>`,
            rowRender: (row: any, tr: any, _index: number) => {
                const id = row.cells[0].data
                const inputNode: any = {
                    nodeName: "input",
                    attributes: {
                        type: "checkbox",
                        class: "entry-select fw-check",
                        "data-id": String(id),
                        id: `template-${id}`
                    }
                }
                if (row.cells[1].data) {
                    inputNode.attributes.checked = true
                }
                tr.childNodes[0].childNodes = [
                    inputNode,
                    {
                        nodeName: "label",
                        attributes: {for: `template-${id}`}
                    }
                ]
            },
            onEnter: (row: any, _event: any) => {
                if (this.getSelected().length > 0) {
                    return
                }
                const rowIndex = this.table.data.data.indexOf(row)
                const link = this.table.dom.querySelector(
                    `tr[data-index="${rowIndex}"] a`
                )
                if (link) {
                    link.click()
                }
            },
            onDelete: (row: any) => {
                const templateId = row.cells[0].data
                this.mod.actions!.deleteDocTemplatesDialog([templateId])
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

    createTableRow(docTemplate: Record<string, unknown>): Array<any> {
        return [
            docTemplate.id,
            false,
            `<span class="${docTemplate.is_owner ? "fw-data-table-title " : ""}fw-inline">
                <i class="far fa-file"></i>
                ${
                    docTemplate.is_owner
                        ? `<a href='/templates/${docTemplate.id}/'>
                        ${
                            (docTemplate.title as string)?.length
                                ? escapeText(docTemplate.title as string)
                                : gettext("Untitled")
                        }
                    </a>`
                        : (docTemplate.title as string)?.length
                          ? escapeText(docTemplate.title as string)
                          : gettext("Untitled")
                }
            </span>`,
            docTemplate.added,
            docTemplate.updated,
            `<span class="delete-doc-template fw-inline fw-link-text" data-id="${docTemplate.id}" data-title="${escapeText((docTemplate.title as string) || "")}">
                ${docTemplate.is_owner ? '<i class="fa fa-trash-can"></i>' : ""}
           </span>`
        ]
    }

    removeTableRows(ids: number[]): void {
        const existingRows = this.table.data.data
            .map((row: any, index: number) => {
                const id = row.cells[0].data
                if (ids.includes(id)) {
                    return index
                } else {
                    return false
                }
            })
            .filter((rowIndex: number | false) => rowIndex !== false)

        if (existingRows.length) {
            this.table.rows.remove(existingRows)
        }
    }

    addDocTemplateToTable(docTemplate: Record<string, unknown>): void {
        this.table.insert({data: [this.createTableRow(docTemplate)]})
        this.table.columns.sort(this.lastSort.column, this.lastSort.dir)
    }

    getTemplateListData(): Promise<void> {
        if (this.app.isOffline()) {
            return this.showCached()
        }
        return this.app.apiConnectors.documentTemplate.list()
            .then((json: any) => {
                this.updateIndexedDB(json)
                this.initializeView(json)
            })
            .catch((error: Error) => {
                if (this.app.isOffline()) {
                    return this.showCached()
                } else {
                    addAlert("error", gettext("Document templates loading failed."))
                    throw error
                }
            })
    }

    initializeView(json: any): void {
        if (this.app.page === this) {
            this.templateList = json.document_templates
            this.initTable()
            window.scrollTo(0, 0)
        }
    }

    showCached(): Promise<void> {
        return this.loaddatafromIndexedDB().then(json =>
            this.initializeView(json)
        )
    }

    loaddatafromIndexedDB(): Promise<any> {
        return this.app.indexedDB
            .readAllData("templates_list")
            .then(response => ({document_templates: response}))
    }

    updateIndexedDB(json: any): void {
        this.app.indexedDB.clearData("templates_list").then(() => {
            this.app.indexedDB.insertData("templates_list", json.document_templates)
        })
    }

    bind(): void {
        this.dom.addEventListener("click", (event: Event) => {
            const el: Record<string, any> = {}
            switch (true) {
                case findTarget(event, ".delete-doc-template", el): {
                    const docTemplateId = Number.parseInt(el.target.dataset.id)
                    this.mod.actions!.deleteDocTemplatesDialog([docTemplateId])
                    break
                }
                case findTarget(event, "a", el):
                    if (
                        el.target.hostname === window.location.hostname &&
                        (el.target.getAttribute("href") as string)[0] === "/"
                    ) {
                        event.preventDefault()
                        this.app.goTo(el.target.href)
                    }
                    break
                default:
                    break
            }
        })
    }

    getSelected(): number[] {
        return Array.from(
            this.dom.querySelectorAll(".entry-select:checked:not(:disabled)")
        ).map(el => Number.parseInt((el as HTMLElement).getAttribute("data-id")!))
    }

    close(): void {
        if (this.table) {
            this.table.destroy()
            this.table = null
        }
        if (this.dtBulk) {
            this.dtBulk.destroy()
            this.dtBulk = null
        }
        if (this.menu) {
            this.menu.destroy()
            this.menu = null
        }
    }
}
