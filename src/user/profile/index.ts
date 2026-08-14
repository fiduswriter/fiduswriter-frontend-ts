import {baseBodyTemplate} from "../../common/index.js"
import {FeedbackTab} from "../../feedback/index.js"
import {SiteMenu} from "../../menu/index.js"
import {
    activateWait,
    addAlert,
    deactivateWait,
    dropdownSelect,
    ensureCSS,
    findTarget,
    setDocTitle,
    whenReady
} from "fwtoolkit"
import {DeleteUserDialog} from "./delete_user.js"
import {
    addEmailDialog,
    changeAvatarDialog,
    changePrimaryEmailDialog,
    changePwdDialog,
    deleteAvatarDialog,
    deleteEmailDialog,
    deleteSocialaccountDialog
} from "./dialogs.js"
import {profileContents} from "./templates.js"
import type {FrontendApp, User} from "../../types.js"

import type {PluginList} from "../../app/index.js"

export class Profile {
    app: FrontendApp
    user: User & {id?: number}
    socialaccount_providers: Array<Record<string, unknown>>
    pluginTemplates: string[]
    clickTargets: Record<string, (el: Record<string, any>, event: Event) => void>
    postRenderHandlers: Array<() => void>
    plugins: Record<string, {init(): void}> | null
    dom!: HTMLElement
    profilePlugins: PluginList

    constructor({
        app,
        user,
        socialaccount_providers,
        profilePlugins = []
    }: {
        app: FrontendApp
        user: User & {id?: number}
        socialaccount_providers: Array<Record<string, unknown>>
        profilePlugins?: PluginList
    }) {
        this.app = app
        this.user = user
        this.socialaccount_providers = socialaccount_providers
        this.profilePlugins = profilePlugins
        this.pluginTemplates = []
        this.plugins = null
        this.clickTargets = {
            "#add-profile-email": (_el, _event) => addEmailDialog(this.app),
            "#fw-edit-profile-pwd": (_el, _event) =>
                changePwdDialog({username: this.user.username, app: this.app}),
            "#delete-account": (_el, _event) => {
                const dialog = new DeleteUserDialog(
                    (this.dom.querySelector("#delete-account") as HTMLElement).dataset.username!,
                    this.app
                )
                dialog.init()
            },
            "#submit-profile": (_el, _event) => this.save(),
            ".delete-email": (el, _event) =>
                deleteEmailDialog(el.target, this.app),
            ".delete-socialaccount": (el, _event) =>
                deleteSocialaccountDialog(el.target, this.app)
        }

        this.postRenderHandlers = [
            () => {
                dropdownSelect(
                    this.dom.querySelector("#edit-avatar-pulldown") as HTMLSelectElement,
                    {
                        onChange: (value: string | false) => {
                            switch (value) {
                                case "change":
                                    changeAvatarDialog(this.app)
                                    break
                                case "delete":
                                    deleteAvatarDialog(this.app)
                                    break
                            }
                        },
                        button: this.dom.querySelector("#edit-avatar-btn") as HTMLElement | false | undefined
                    }
                )
            },
            () => {
                this.dom
                    .querySelectorAll(".primary-email-radio")
                    .forEach(el =>
                        el.addEventListener("change", () =>
                            changePrimaryEmailDialog(this.app)
                        )
                    )
            }
        ]
        if (this.app.settings.TWO_FACTOR_ENABLED) {
            this.clickTargets["#setup-two-factor"] = (_el, _event) => {
                import("../auth/two_factor.js").then(({twoFactorSetupDialog}) => {
                    twoFactorSetupDialog(this.app)
                })
            }
            this.clickTargets["#disable-two-factor"] = (_el, _event) => {
                import("../auth/two_factor.js").then(({twoFactorDisableDialog}) => {
                    twoFactorDisableDialog(this.app)
                })
            }

            this.postRenderHandlers.push(() => this.updateTwoFactorStatus())
        }
        if (
            this.app.settings.E2EE_MODE &&
            this.app.settings.E2EE_MODE !== "disabled"
        ) {
            this.clickTargets["#setup-e2ee-passphrase"] = (_el, _event) => {
                this.setupE2EEPassphrase()
            }
            this.clickTargets["#change-e2ee-passphrase"] = (_el, _event) => {
                this.changeE2EEPassphrase()
            }
            this.clickTargets["#recover-e2ee-passphrase"] = (_el, _event) => {
                this.recoverE2EEPassphrase()
            }

            this.postRenderHandlers.push(() =>
                this.updateE2EEPassphraseStatus()
            )
        }
    }

    init(): Promise<void> {
        return whenReady().then(() => {
            this.activateFidusPlugins()
            this.render()
            const smenu = new SiteMenu(this.app, "")
            smenu.init()
            this.dom.addEventListener("click", (event: Event) => {
                const el: Record<string, any> = {}
                Object.entries(this.clickTargets).find(([selector, handler]) => {
                    if (findTarget(event, selector, el)) {
                        handler(el, event)
                        return true
                    }
                    return false
                })
            })
            this.postRenderHandlers.forEach(handler => handler())
        })
    }

    activateFidusPlugins(): void {
        if (this.plugins) {
            return
        }
        // Add plugins.
        this.plugins = {}

        this.profilePlugins.forEach(([app, plugin]) => {
            if (!this.app.settings.APPS.includes(app)) {
                return
            }
            Object.values(plugin).forEach(pluginExport => {
                if (typeof pluginExport === "function") {
                    const name = (pluginExport as any).name
                    this.plugins![name] = new (pluginExport as any)(this)
                    this.plugins![name].init()
                }
            })
        })
    }

    render(): void {
        this.dom = document.createElement("body")
        this.dom.classList.add("fw-scrollable")
        this.dom.innerHTML = baseBodyTemplate({
            contents: profileContents(
                this.user,
                this.socialaccount_providers,
                this.app.settings,
                this.pluginTemplates
            ),
            user: this.user,
            app: this.app
        })
        document.body = this.dom

        ensureCSS([
            staticUrl("css/show_profile.css"),
            staticUrl("css/two_factor.css")
        ])

        setDocTitle(gettext("Configure profile"), this.app as {name: string})
        const feedbackTab = new FeedbackTab(this.app)
        feedbackTab.init()
    }

    updateTwoFactorStatus(): void {
        import("../auth/two_factor.js").then(({checkTwoFactorStatus}) => {
            checkTwoFactorStatus(this.app).then((enabled: boolean) => {
                const enabledStatus = this.dom.querySelector(
                    "#two-factor-enabled-status"
                ) as HTMLElement
                const disabledStatus = this.dom.querySelector(
                    "#two-factor-disabled-status"
                ) as HTMLElement
                const setupBtn = this.dom.querySelector("#setup-two-factor") as HTMLElement
                const disableBtn = this.dom.querySelector(
                    "#disable-two-factor"
                ) as HTMLElement

                if (enabled) {
                    enabledStatus.style.display = "inline"
                    disabledStatus.style.display = "none"
                    setupBtn.style.display = "none"
                    disableBtn.style.display = "inline"
                } else {
                    enabledStatus.style.display = "none"
                    disabledStatus.style.display = "inline"
                    setupBtn.style.display = "inline"
                    disableBtn.style.display = "none"
                }
            })
        })
    }

    updateE2EEPassphraseStatus(): void {
        import("fwtoolkit/e2ee/passphrase-manager").then(
            ({PassphraseManager}) => {
                PassphraseManager.hasEncryptionKeys().then((hasKeys: boolean) => {
                    const enabledStatus = this.dom.querySelector(
                        "#e2ee-passphrase-enabled-status"
                    ) as HTMLElement
                    const disabledStatus = this.dom.querySelector(
                        "#e2ee-passphrase-disabled-status"
                    ) as HTMLElement
                    const setupBtn = this.dom.querySelector(
                        "#setup-e2ee-passphrase"
                    ) as HTMLElement
                    const changeBtn = this.dom.querySelector(
                        "#change-e2ee-passphrase"
                    ) as HTMLElement
                    const recoverBtn = this.dom.querySelector(
                        "#recover-e2ee-passphrase"
                    ) as HTMLElement

                    if (hasKeys) {
                        enabledStatus.style.display = "inline"
                        disabledStatus.style.display = "none"
                        setupBtn.style.display = "none"
                        changeBtn.style.display = "inline"
                        recoverBtn.style.display = "inline"
                    } else {
                        enabledStatus.style.display = "none"
                        disabledStatus.style.display = "inline"
                        setupBtn.style.display = "inline"
                        changeBtn.style.display = "none"
                        recoverBtn.style.display = "none"
                    }
                })
            }
        )
    }

    async setupE2EEPassphrase(): Promise<void> {
        const {PassphraseManager} = await import(
            "fwtoolkit/e2ee/passphrase-manager"
        )
        const {setupPassphraseDialog} = await import(
            "fwtoolkit/e2ee/passphrase-dialog"
        )

        setupPassphraseDialog(async (passphrase: string) => {
            try {
                const {recoveryKey} =
                    await PassphraseManager.setupEncryption(
                        passphrase
                    )
                const {showRecoveryKeyDialog} = await import(
                    "fwtoolkit/e2ee/passphrase-dialog"
                )
                await showRecoveryKeyDialog(recoveryKey, () => {})
                this.updateE2EEPassphraseStatus()
            } catch (e: any) {
                addAlert("error", gettext("Failed to set up passphrase: ") + e.message)
            }
        })
    }

    async recoverE2EEPassphrase(): Promise<void> {
        const {PassphraseManager} = await import(
            "fwtoolkit/e2ee/passphrase-manager"
        )
        const {recoverWithKeyDialog, showRecoveryKeyDialog} = await import(
            "fwtoolkit/e2ee/passphrase-dialog"
        )

        const recoverResult: any = await new Promise(resolve => {
            recoverWithKeyDialog(resolve)
        })
        if (!recoverResult) {
            return
        }
        try {
            const {newRecoveryKey} =
                await PassphraseManager.recoverWithRecoveryKey(
                    recoverResult.recoveryKey,
                    recoverResult.newPassphrase
                )
            await new Promise<void>(resolve => {
                showRecoveryKeyDialog(newRecoveryKey, resolve)
            })
            this.updateE2EEPassphraseStatus()
        } catch (e: any) {
            addAlert("error", gettext("Recovery failed: ") + e.message)
        }
    }

    async changeE2EEPassphrase(): Promise<void> {
        const {PassphraseManager} = await import(
            "fwtoolkit/e2ee/passphrase-manager"
        )
        const {changePassphraseDialog} = await import(
            "fwtoolkit/e2ee/passphrase-dialog"
        )

        const changeResult: any = await new Promise(resolve => {
            changePassphraseDialog(resolve)
        })
        if (!changeResult) {
            return
        }
        try {
            await PassphraseManager.changePassphrase(
                changeResult.oldPassphrase,
                changeResult.newPassphrase
            )
            addAlert("success", gettext("Passphrase changed successfully."))
        } catch (e: any) {
            addAlert("error", gettext("Failed to change passphrase: ") + e.message)
        }
    }

    save(): Promise<void> {
        activateWait()
        const newLang = (this.dom.querySelector("#language") as HTMLSelectElement).value
        const inlineReferences = (this.dom.querySelector("#inline-references") as HTMLInputElement).checked
        const inlineMath = (this.dom.querySelector("#inline-math") as HTMLInputElement).checked
        return this.app.apiConnectors.userProfile.save({
            username: (this.dom.querySelector("#username") as HTMLInputElement).value,
            first_name: (this.dom.querySelector("#first_name") as HTMLInputElement).value,
            last_name: (this.dom.querySelector("#last_name") as HTMLInputElement).value,
            language: newLang
        })
            .catch(() => addAlert("error", gettext("Could not save profile data")))
            .then(() =>
                this.app.apiConnectors.userProfile.updatePreferences({
                    inline_references: inlineReferences,
                    inline_math: inlineMath
                })
            )
            .catch(() => addAlert("error", gettext("Could not save preferences")))
            .then(() => {
                deactivateWait()
                return this.app.getConfiguration()
            })
            .then(() => {
                const currentLang = document.documentElement.lang

                if (currentLang !== newLang) {
                    window.location.reload()
                }
            })
    }
}
