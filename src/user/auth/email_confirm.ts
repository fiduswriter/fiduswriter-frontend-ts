import {
    activateWait,
    addAlert,
    deactivateWait,
    whenReady
} from "fwtoolkit"
import {PreloginPage, type PreloginApp} from "../../prelogin/index.js"
import {
    checkTermsTemplate,
    confirmAccountTemplate,
    testServerQuestionTemplate,
    verifiedAccountTemplate
} from "./email_confirm_templates.js"

export class EmailConfirm extends PreloginPage {
    key: string
    validKey: boolean
    loggedIn: boolean
    verified: boolean
    username: string
    email: string
    submissionReady: boolean
    formChecks: Array<() => boolean>
    confirmQuestionsTemplates: Array<() => string>
    confirmMethods: Array<() => Promise<unknown>>
    firstVerification: boolean

    constructor({app, language, plugins = []}: {app: PreloginApp; language: string; plugins?: Array<[string, Record<string, any>]>}, key: string) {
        super({app, language, plugins})

        this.title = gettext("Confirm Email")
        this.pluginLoaders = []

        this.key = key

        this.validKey = false
        this.loggedIn = false
        this.verified = false
        this.username = ""
        this.email = ""

        this.submissionReady = false
        this.formChecks = []
        this.confirmQuestionsTemplates = []
        this.confirmMethods = [
            () => this.app.apiConnectors.userProfile.confirmEmail(this.key)
        ]
        this.firstVerification = false
    }

    init(): Promise<void> {
        return Promise.all([whenReady(), this.getConfirmData()]).then(() => {
            this.activateFidusPlugins()
            this.render()
            this.bind()
        })
    }

    getConfirmData(): Promise<void> {
        return this.app.apiConnectors.userProfile.getConfirmKeyData({key: this.key})
            .then((json: any) => {
                this.username = json.username
                this.email = json.email
                this.validKey = true
                this.verified = json.verified
                this.firstVerification = !json.verified
                if (json.logout) {
                    this.app.config.user = {is_authenticated: false} as PreloginApp["user"]
                }
            })
            .catch(() => {})
    }

    render(): void {
        if (!this.verified) {
            if (this.app.settings?.TEST_SERVER) {
                this.formChecks.push(() =>
                    !!(document.getElementById("test-check") as HTMLInputElement)?.matches(
                        ":checked"
                    )
                )
                this.confirmQuestionsTemplates.unshift(testServerQuestionTemplate)
            }
            this.formChecks.push(() =>
                !!(document.getElementById("terms-check") as HTMLInputElement)?.matches(
                    ":checked"
                )
            )
            this.confirmQuestionsTemplates.unshift(checkTermsTemplate)
        }
        this.contents = confirmAccountTemplate({
            validKey: this.validKey,
            username: this.username,
            verified: this.verified,
            email: this.email,
            confirmQuestionsTemplates: this.confirmQuestionsTemplates
        })
        super.render()
    }

    bind(): void {
        super.bind()
        if (!this.formChecks.length) {
            const submitBtn = document.getElementById("submit")
            if (submitBtn) submitBtn.removeAttribute("disabled")
            this.submissionReady = true
        }
        document.querySelectorAll(".checker").forEach(el =>
            el.addEventListener("click", () => {
                if (this.formChecks.every(check => check())) {
                    const submitBtn = document.getElementById("submit")
                    if (submitBtn) submitBtn.removeAttribute("disabled")
                    this.submissionReady = true
                } else {
                    const submitBtn = document.getElementById("submit")
                    if (submitBtn) submitBtn.setAttribute("disabled", "disabled")
                    this.submissionReady = false
                }
            })
        )
        const submissionButton = document.getElementById("submit")
        if (submissionButton) {
            submissionButton.addEventListener("click", () => {
                if (!this.submissionReady) {
                    return
                }
                activateWait()
                Promise.all(this.confirmMethods.map(method => method())).then(() => {
                    deactivateWait()
                    if (this.app.config.user.is_authenticated) {
                        const emailObject = this.app.config.user.emails.find(
                            email => email.address === this.email
                        )
                        if (emailObject) {
                            emailObject.verified = true
                        }
                        return this.app.goTo("/user/profile/")
                            .then(() =>
                                addAlert("info", gettext("Email verified!"))
                            )
                    }
                    const contentsDOM = document.querySelector(".fw-contents")
                    if (contentsDOM) {
                        contentsDOM.innerHTML = verifiedAccountTemplate()
                    }
                    return undefined
                })
            })
        }
    }
}
