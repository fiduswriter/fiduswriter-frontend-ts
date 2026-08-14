import {CSL} from "@fiduswriter/document/citeproc-plus"

import {BibliographyDB} from "@fiduswriter/bibliography-manager/database"
import {ImageDB, ImageOverview} from "@fiduswriter/image-manager"
import {
    WebSocketConnector,
    addAlert,
    ensureCSS,
    findTarget,
    showSystemMessage
} from "fwtoolkit"
import {getSettings, initSettings} from "fwtoolkit/settings"

import {ContactInvite} from "../user/contacts/invite.js"
import {EmailConfirm} from "../user/auth/email_confirm.js"
import {LoginPage} from "../user/auth/login.js"
import {PasswordResetChangePassword} from "../user/auth/password_reset_change.js"
import {PasswordResetRequest} from "../user/auth/password_reset_request.js"
import {Signup} from "../user/auth/signup.js"
import {DocumentOverview} from "../documents/overview/index.js"
import {IndexedDB} from "../indexed_db/index.js"
import {Page404} from "../pages/404.js"
import {FlatPage} from "../pages/flatpage.js"
import {OfflinePage} from "../pages/offline.js"
import {SetupPage} from "../pages/setup.js"
import {ContactsOverview, type ContactsApp} from "../user/contacts/index.js"
import {Profile} from "../user/profile/index.js"
import {baseBodyTemplate} from "../common/index.js"
import {SiteMenu} from "../menu/index.js"
import {FeedbackTab} from "../feedback/index.js"

import type {ApiConnectors} from "../api/index.js"
import type {PreloginApp} from "../prelogin/index.js"
import type {FrontendApp, Settings} from "../types.js"

// ---- Plugin types ----

interface PluginConstructor {
    new (...args: any[]): {init(): () => void}
}

export type PluginModule = Record<string, PluginConstructor>
export type PluginList = Array<[string, PluginModule]>

export interface AppPluginOptions {
    appPlugins?: PluginList
    menuPlugins?: PluginList
    editorPlugins?: PluginList
    citationDialogPlugins?: PluginList
    bibliographyOverviewPlugins?: PluginList
    profilePlugins?: PluginList
    confirmAccountPlugins?: PluginList
}

// ---- Route types ----

interface DbTableProperties {
    keyPath?: string
    autoIncrement?: boolean
}

interface RouteEntry {
    app: string
    requireLogin?: boolean
    open: (pathnameParts: string[]) => any
    dbTables?: Record<string, DbTableProperties>
    [key: string]: unknown
}

type RouteMap = Record<string, RouteEntry>

// ---- Page interface ----

interface Page {
    init: () => Promise<void>
    close?: () => void
    onResize?: () => void
    onBeforeUnload?: () => boolean
}

// ---- App class ----

export class App {
    app: PreloginApp
    apiConnectors: ApiConnectors
    settings: Settings
    config: FrontendApp
    name: string
    menuPlugins: PluginList
    appPlugins: PluginList
    editorPlugins: PluginList
    citationDialogPlugins: PluginList
    bibliographyOverviewPlugins: PluginList
    profilePlugins: PluginList
    confirmAccountPlugins: PluginList
    routes: RouteMap

    openLoginPage: () => Page
    openOfflinePage: () => Page
    openSetupPage: () => Page
    open404Page: () => Page
    handleSWUpdate: () => void

    private _page?: Page
    ws?: FrontendApp["ws"]
    csl?: FrontendApp["csl"]
    bibDB?: any
    imageDB?: any
    indexedDB?: IndexedDB
    plugins?: Record<string, any>
    inviteKey?: string

    get page(): Page | undefined {
        return this._page
    }

    set page(page: Page | undefined) {
        this._page = page
        this.config.page = page
    }

    constructor(
        apiConnectors: ApiConnectors,
        settings: Settings = {
            APPS: [],
            apiUrl: (url: string) => url,
            getCsrfToken: () => ""
        },
        pluginOpts: AppPluginOptions = {}
    ) {
        this.apiConnectors = apiConnectors

        ;(settings as Record<string, unknown>).gettext = (window as any).gettext
        ;(settings as Record<string, unknown>).staticUrl = (window as any).staticUrl
        ;(settings as Record<string, unknown>).interpolate = (window as any).interpolate
        initSettings(settings)
        this.settings = getSettings() as Settings
        this.config = {} as FrontendApp
        this.config.settings = this.settings
        this.name = "Fidus Writer"
        this.app = this as unknown as PreloginApp
        this.config.app = this.app
        this.config.name = this.name
        this.config.isOffline = this.isOffline.bind(this)
        this.config.getConfiguration = this.getConfiguration.bind(this)
        this.config.selectPage = this.selectPage.bind(this)

        this.appPlugins = pluginOpts.appPlugins ?? []
        this.menuPlugins = pluginOpts.menuPlugins ?? []
        this.editorPlugins = pluginOpts.editorPlugins ?? []
        this.citationDialogPlugins = pluginOpts.citationDialogPlugins ?? []
        this.bibliographyOverviewPlugins =
            pluginOpts.bibliographyOverviewPlugins ?? []
        this.profilePlugins = pluginOpts.profilePlugins ?? []
        this.confirmAccountPlugins = pluginOpts.confirmAccountPlugins ?? []

        this.config.goTo = (url: string) => this.goTo(url)
        this.config.menuPlugins = this.menuPlugins
        this.config.apiConnectors = this.apiConnectors

        this.routes = {
            "": {
                app: "document",
                requireLogin: true,
                open: () => {
                    const overview = new DocumentOverview(
                        {app: this.config, user: this.config.user},
                        "/"
                    )
                    return Promise.resolve(overview)
                }
            },
            account: {
                app: "user",
                requireLogin: false,
                open: (pathnameParts: string[]) => {
                    let returnValue: any
                    switch (pathnameParts[2]) {
                        case "confirm-email": {
                            const key = pathnameParts[3]
                            returnValue = new EmailConfirm(
                                {
                                    app: this.config.app as PreloginApp,
                                    language: this.config.language || "",
                                    plugins: this.confirmAccountPlugins
                                },
                                key
                            )
                            break
                        }
                        case "password-reset":
                            returnValue = new PasswordResetRequest({
                                app: this.config.app as PreloginApp,
                                language: this.config.language || ""
                            })
                            break
                        case "change-password": {
                            const key = pathnameParts[3]
                            returnValue = new PasswordResetChangePassword(
                                {app: this.config.app as PreloginApp, language: this.config.language || ""},
                                key
                            )
                            break
                        }
                        case "sign-up":
                            returnValue = new Signup({
                                app: this.config.app as PreloginApp,
                                language: this.config.language || ""
                            })
                            break
                        default:
                            returnValue = false
                    }
                    return returnValue
                }
            },
            bibliography: {
                app: "bibliography",
                requireLogin: true,
                open: () => {
                    const dom = document.createElement("body")
                    document.body = dom
                    dom.classList.add("fw-scrollable")
                    dom.innerHTML = baseBodyTemplate({
                        contents: "",
                        user: this.config.user,
                        hasOverview: true,
                        app: this.config
                    })
                    new SiteMenu(this.app, "bibliography").init()
                    new FeedbackTab(this.config).init()
                    const container = dom.querySelector(
                        ".fw-contents"
                    ) as HTMLElement
                    return import(
                        "@fiduswriter/bibliography-manager/overview"
                    ).then(
                        ({BibliographyOverview}: any) =>
                            new BibliographyOverview(
                                {
                                    app: this.config.app,
                                    container
                                },
                                this.bibliographyOverviewPlugins
                            )
                    )
                }
            },
            document: {
                app: "document",
                requireLogin: true,
                open: (pathnameParts: string[]) => {
                    let id = pathnameParts.pop()!
                    if (!id.length) {
                        id = pathnameParts.pop()!
                    }
                    const path = (
                        "/" + pathnameParts.slice(2).join("/")
                    ).replace(/\/?$/, "/")
                    return import(
                        /* webpackPrefetch: true */ /* webpackChunkName: "editor" */ "@fiduswriter/editor"
                    ).then(
                        ({Editor}: any) =>
                            new Editor(
                                this.config,
                                path,
                                id,
                                this.editorPlugins,
                                this.citationDialogPlugins
                            )
                    )
                },
                dbTables: {
                    data: {
                        keyPath: "id"
                    }
                }
            },
            share: {
                // Document shared via document link
                app: "document",
                requireLogin: false,
                open: (pathnameParts: string[]) => {
                    let token = pathnameParts.pop()!
                    if (!token.length) {
                        token = pathnameParts.pop()!
                    }
                    const path = "/"
                    return import(
                        /* webpackPrefetch: true */ /* webpackChunkName: "editor" */ "@fiduswriter/editor"
                    ).then(
                        ({Editor}: any) =>
                            new Editor(
                                this.config,
                                path,
                                token,
                                this.editorPlugins,
                                this.citationDialogPlugins
                            )
                    )
                }
            },
            documents: {
                app: "document",
                requireLogin: true,
                open: (pathnameParts: string[]) => {
                    const path = (
                        "/" + pathnameParts.slice(2).join("/")
                    ).replace(/\/?$/, "/")
                    const overview = new DocumentOverview(
                        {app: this.config, user: this.config.user},
                        path
                    )
                    return Promise.resolve(overview)
                }
            },
            pages: {
                app: "base",
                open: (pathnameParts: string[]) => {
                    const url = `/${pathnameParts[2]}/`
                    return new FlatPage(
                        {app: this.config.app as PreloginApp, language: this.config.language || ""},
                        url
                    )
                }
            },
            user: {
                app: "user",
                requireLogin: true,
                open: (pathnameParts: string[]) => {
                    let returnValue: any
                    switch (pathnameParts[2]) {
                        case "profile":
                            returnValue = new Profile({
                                app: this.config,
                                user: this.config.user,
                                socialaccount_providers:
                                    this.config.socialaccount_providers ?? [],
                                profilePlugins: this.profilePlugins
                            })
                            break
                        case "contacts":
                            returnValue = new ContactsOverview({
                                app: this.config as ContactsApp,
                                user: this.config.user
                            })
                            break
                        default:
                            returnValue = false
                    }
                    return returnValue
                },
                dbTables: {
                    data: {
                        keyPath: "id"
                    }
                }
            },
            invite: {
                app: "user",
                open: (pathnameParts: string[]) => {
                    const id = pathnameParts[2]
                    return new ContactInvite({app: this.config.app as PreloginApp}, id)
                }
            },
            usermedia: {
                app: "usermedia",
                requireLogin: true,
                open: () => {
                    const dom = document.createElement("body")
                    document.body = dom
                    dom.classList.add("fw-scrollable")
                    dom.innerHTML = baseBodyTemplate({
                        contents: "",
                        user: this.config.user,
                        hasOverview: true,
                        app: this.config
                    })
                    new SiteMenu(this.app, "images").init()
                    new FeedbackTab(this.config).init()
                    const container = dom.querySelector(
                        ".fw-contents"
                    ) as HTMLElement
                    return Promise.resolve(
                        new ImageOverview({
                            app: this.app,
                            container
                        } as any)
                    )
                }
            },

        }
        this.config.routes = this.routes
        this.openLoginPage = () =>
            new LoginPage({
                app: this.config.app as PreloginApp,
                language: this.config.language || "",
                socialaccount_providers: this.config.socialaccount_providers ?? []
            })
        this.openOfflinePage = () =>
            new OfflinePage({app: this.config.app as PreloginApp, language: this.config.language || ""})
        this.openSetupPage = () =>
            new SetupPage({app: this.config.app as PreloginApp, language: this.config.language || ""})
        this.open404Page = () =>
            new Page404({app: this.config.app as PreloginApp, language: this.config.language || ""})
        this.handleSWUpdate = () => window.location.reload()
    }

    isOffline(): boolean {
        const ws = this.ws
        return (
            !navigator.onLine ||
            (ws !== undefined && !!ws.connectionCount && !ws.connected)
        )
    }

    alertCached(): void {
        addAlert(
            "info",
            gettext("You are viewing a cached version of this page.")
        )
    }

    installServiceWorker(): void {
        /* This function is used for testing SW with Django tests */
        if ("serviceWorker" in navigator) {
            navigator.serviceWorker
                .register("/sw.js")
                .then(registration => {
                    console.log("SW registered: ", registration)
                })
                .catch(registrationError => {
                    console.log("SW registration failed: ", registrationError)
                })
        }
    }

    init(): Promise<any> {
        if (
            !this.settings.DEBUG &&
            this.settings.USE_SERVICE_WORKER &&
            "serviceWorker" in navigator
        ) {
            navigator.serviceWorker
                .register("/sw.js")
                .then(registration => {
                    console.log("SW registered: ", registration)
                })
                .catch(registrationError => {
                    console.log("SW registration failed: ", registrationError)
                })
        }
        ensureCSS([staticUrl("css/fontawesome/css/all.css")])
        // Disable automatic scroll restoration to prevent Safari from
        // auto-scrolling to focused elements (like the document table)
        // which causes the header/menu to be hidden on page load
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual"
        }
        // Ensure we start at the top of the page
        window.scrollTo(0, 0)
        if (this.isOffline()) {
            this.page = this.openOfflinePage()
            return this.page.init()
        } else {
            return this.getConfiguration()
                .catch(error => {
                    if (error instanceof TypeError) {
                        // We could not fetch user info from server, so let's
                        // assume we are disconnected.
                        this.page = this.openOfflinePage()
                        this.page.init()
                    } else if (error.status === 405) {
                        // 405 indicates that the server is running but the
                        // method is not allowed. This must be the setup server.
                        // We show a setup message instead.
                        this.page = this.openSetupPage()
                        this.page.init()
                    } else if (this.settings.DEBUG) {
                        throw error
                    } else {
                        // We don't know what is going on, but we are in production
                        // mode. Hopefully the app will update soon.
                        this.page = this.openOfflinePage()
                        this.page.init()
                    }
                    return Promise.reject(false)
                })
                .then(() => this.setup())
                .catch(error => {
                    if (error === false) {
                        return
                    }
                    throw error
                })
        }
    }

    setup(): Promise<any> {
        this.csl = new CSL()
        this.config.csl = this.csl
        if (!this.config.user.is_authenticated) {
            this.activateFidusPlugins()
            return this.selectPage().then(() => this.bind())
        }
        this.bibDB = new BibliographyDB(this as any)
        this.config.bibDB = this.bibDB
        this.imageDB = new ImageDB(this as any)
        this.config.imageDB = this.imageDB
        this.connectWs()
        return Promise.all([this.bibDB.getDB(), this.imageDB.getDB()])
            .then(() => {
                this.activateFidusPlugins()
                // Initialize the indexedDB after the plugins have loaded.
                this.indexedDB = new IndexedDB(
                    this.config.user.username,
                    this.routes
                )
                return this.indexedDB.init()
            })
            .then(() => {
                this.config.indexedDB = this.indexedDB
                return this.selectPage()
            })
            .then(() => this.bind())
            .then(() => this.showNews())
    }

    bind(): void {
        window.onpopstate = () => this.selectPage()
        document.addEventListener("click", event => {
            const el: Record<string, any> = {}
            switch (true) {
                case findTarget(event, "a", el):
                    if (
                        el.target.hostname === window.location.hostname &&
                        el.target.getAttribute("href")[0] === "/" &&
                        el.target.getAttribute("href").slice(0, 7) !==
                            "/media/" &&
                        el.target.getAttribute("href").slice(0, 5) !== "/api/"
                    ) {
                        event.preventDefault()
                        event.stopImmediatePropagation()
                        this.goTo(decodeURI(el.target.href))
                    }
                    break
            }
        })
        let resizeDone: ReturnType<typeof setTimeout>
        window.addEventListener("resize", () => {
            clearTimeout(resizeDone)
            resizeDone = setTimeout(() => {
                if (this.page && this.page.onResize) {
                    this.page.onResize()
                }
            }, 250)
        })
        window.addEventListener("beforeunload", event => {
            if (this.page && this.page.onBeforeUnload) {
                if (this.page.onBeforeUnload()) {
                    event.preventDefault()
                    // To stop the event for chrome and safari
                    ;(event as any).returnValue = ""
                    return ""
                }
            }
            return undefined
        })
    }

    showNews(): void {
        if (
            window.location.pathname !== "/user/contacts/" &&
            this.config.user.waiting_invites
        ) {
            showSystemMessage(
                gettext(
                    "Other users have requested to connect with you. Go to the contacts page to accept their invites."
                ),
                [
                    {
                        text: gettext("Go to contacts"),
                        classes: "fw-dark",
                        click: (_event: any) => {
                            return this.goTo("/user/contacts/")
                        }
                    },
                    {type: "close"}
                ] as any
            )
        }
    }

    connectWs(): void {
        if (!this.config.ws_url_base) {
            return
        }
        this.ws = new (WebSocketConnector as any)({
            base: this.config.ws_url_base!,
            path: "/base/",
            appLoaded: () => true,
            receiveData: (data: any) => {
                switch (data.type) {
                    case "system_message":
                        showSystemMessage(data.message)
                        break
                    default:
                        break
                }
            }
        })
        this.config.ws = this.ws
        this.ws?.init()
    }

    activateFidusPlugins(): void {
        if (this.plugins) {
            // Plugins have been activated already
            return
        }
        // Add plugins.
        this.plugins = {}

        this.appPlugins.forEach(([app, plugin]) => {
            if (!this.settings.APPS.includes(app)) {
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

    selectPage(): Promise<void> {
        if (this.page && this.page.close) {
            this.page.close()
        }
        // Disable automatic scroll restoration to prevent Safari from
        // auto-scrolling to focused elements (like the document table)
        // which causes the header/menu to be hidden on page load
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual"
        }
        // Ensure we start at the top of the page
        window.scrollTo(0, 0)
        const pathnameParts = decodeURI(window.location.pathname).split("/")
        const route = this.routes[pathnameParts[1]]
        if (route) {
            if (
                route.requireLogin &&
                !(this.config.user || {}).is_authenticated
            ) {
                this.page = this.openLoginPage()
                return this.page.init()
            }
            const page = route.open(pathnameParts)
            if (page.then) {
                return page.then((thisPage: Page) => {
                    this.page = thisPage
                    return this.page.init().then(() => {
                        if (this.isOffline()) {
                            this.alertCached()
                        }
                    })
                })
            } else if (page) {
                this.page = page
                return page.init().then(() => {
                    if (this.isOffline()) {
                        this.alertCached()
                    }
                })
            }
        }
        this.page = this.open404Page()
        return this.page.init()
    }

    getConfiguration(): Promise<void> {
        return this.apiConnectors.config
            .getConfiguration()
            .then((json: Record<string, any>) =>
                Object.entries(json).forEach(
                    ([key, value]) => (this.config[key] = value)
                )
            )
            .catch((error: any) => {
                if (error instanceof Response && error.status === 403) {
                    // We could not fetch user info from server, so let's
                    // assume we are disconnected and delete all cookies.
                    // This will force the user to log in again.
                    //
                    // This is a bit of a hack, but it is the only way to make sure
                    // that the user is logged out when the server is not reachable.
                    document.cookie.split(";").forEach(cookie => {
                        const eqPos = cookie.indexOf("=")
                        const name =
                            eqPos > -1 ? cookie.substring(0, eqPos) : cookie
                        document.cookie =
                            name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT"
                    })
                    return Promise.reject(error)
                }
                throw error
            })
    }

    goTo(url: string): Promise<void> {
        window.history.pushState({}, "", encodeURI(url))
        return this.selectPage()
    }
}
