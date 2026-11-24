import {escapeText} from "fwtoolkit"
import {PreloginPage, type PreloginApp} from "../../prelogin/index.js"
import {socialProviderIcon} from "./social_icons.js"

export class LoginPage extends PreloginPage {
    socialaccount_providers: Array<Record<string, unknown>>

    constructor({
        app,
        language,
        socialaccount_providers
    }: {
        app: PreloginApp
        language: string
        socialaccount_providers: Array<Record<string, unknown>>
    }) {
        super({app, language})
        this.socialaccount_providers = socialaccount_providers
        this.title = gettext("Login")
        this.pluginLoaders = []
        this.headerLinks = (
            this.app.settings?.REGISTRATION_OPEN &&
            this.app.settings?.PASSWORD_LOGIN
                ? [
                      {type: "label", text: gettext("New here?"), link: ""},
                      {
                          type: "button",
                          text: gettext("Sign up"),
                          link: "/account/sign-up/"
                      }
                  ]
                : []) as any
    }

    render(): void {
        this.contents = `<div class="fw-login-left">
            <h1 class="fw-login-title">${gettext("Log in")}</h1>
            ${
                this.app.settings?.SOCIALACCOUNT_OPEN
                    ? this.socialaccount_providers.length
                        ? `<div class="socialaccount_ballot">
                    <ul class="socialaccount_providers">
                        ${this.socialaccount_providers
                            .map(
                                (provider: any) => `<li>
                                <a title="${provider.name}" class="fw-button fw-socialaccount fw-${provider.id}"
                                    href="${provider.login_url}">
                                        <span class="fab fa-${socialProviderIcon(provider.id)}"></span>
                                            ${gettext("Login with")} ${provider.name}
                                </a>
                            </li>`
                            )
                            .join("")}
                    </ul>
                </div>`
                        : ""
                    : ""
            }
        </div>
            ${
                this.app.settings?.PASSWORD_LOGIN
                    ? `<div class="fw-login-right">
            <form>
                    <ul id="non-field-errors" class="fw-errorlist"></ul>
                    <div class="input-wrapper">
                        <label for="id-login">${gettext("Username")}</label>
                        <input type="text" name="login" placeholder="${gettext("Username or e-mail")}" autofocus="autofocus" required="" id="id-login" autocomplete="username">
                        <ul id="id-login-errors" class="fw-errorlist"></ul>
                    </div>
                    <div class="input-wrapper">
                        <label for="id-password">${gettext("Password")}</label>
                        <input type="password" name="password" placeholder="${gettext("Password")}" required="" id="id-password" autocomplete="current-password">
                        <ul id="id-password-errors" class="fw-errorlist"></ul>
                    </div>
                    <div class="submit-wrapper">
                        <button class="fw-button fw-dark fw-uppercase" type="submit" id="login-submit">${gettext("Log in")}</button>
                        <br>
                        <input type="checkbox" name="remember" id="id-remember">
                        <label for="id-remember">${gettext("Remember me")}</label>
                    </div>
                    <a id="lost-passwd" href="/account/password-reset/">${gettext("Forgot Password?")}</a>
                </form>
            </div>`
                    : ""
            }`
        super.render()
    }

    bind(): void {
        super.bind()
        const socialButtons = document.body.querySelectorAll(".fw-button.fw-socialaccount")
        let btnWidth = 1

        socialButtons.forEach((button: Element) => {
            const theWidth = (button as HTMLElement).clientWidth
            if (btnWidth < theWidth) {
                btnWidth = theWidth
            }
        })
        btnWidth += 15
        socialButtons.forEach(button => ((button as HTMLElement).style.width = `${btnWidth}px`))

        const loginSubmit = document.querySelector("#login-submit")
        if (!loginSubmit) {
            return
        }

        loginSubmit.addEventListener("click", (event: Event) => {
            event.preventDefault()

            const nonFieldErrors = document.querySelector("#non-field-errors")
            const idLogin = document.querySelector("#id-login") as HTMLInputElement
            const idLoginErrors = document.querySelector("#id-login-errors")
            const idPassword = document.querySelector("#id-password") as HTMLInputElement
            const idPasswordErrors = document.querySelector("#id-password-errors")
            const idRemember = document.querySelector("#id-remember") as HTMLInputElement
            const fwContents = document.querySelector(".fw-contents")

            if (!idLogin || !idLoginErrors || !idPassword || !idPasswordErrors || !idRemember || !fwContents) {
                return
            }

            nonFieldErrors!.innerHTML = ""
            idLoginErrors.innerHTML = ""
            idPasswordErrors.innerHTML = ""

            const login = idLogin.value
            const password = idPassword.value
            const remember = idRemember.checked
            let errors = false
            if (!login.length) {
                idLoginErrors.innerHTML = `<li>${gettext("This field is required.")}</li>`
                errors = true
            }
            if (!password.length) {
                idPasswordErrors.innerHTML = `<li>${gettext("This field is required.")}</li>`
                errors = true
            }
            if (errors) {
                return
            }
            return this.app.apiConnectors.auth.login({login, password, remember})
                .catch((response: any) => {
                    if (!(response instanceof Response) || response.status !== 400) {
                        return Promise.reject(response)
                    }
                    return response.json().then((json: any) => {
                        const needCode =
                            json.form.fields.twofactor.errors.includes("required")
                        if (
                            needCode &&
                            !json.form.errors.length &&
                            !json.form.fields.login.errors.length &&
                            !json.form.fields.password.errors.length
                        ) {
                            import("./two_factor.js").then(({twoFactorLoginDialog}) => {
                                twoFactorLoginDialog({
                                    login,
                                    password,
                                    remember,
                                    loginPage: this,
                                    app: this.app
                                })
                            })
                        } else {
                            json.form.errors.forEach(
                                (error: string) =>
                                    (nonFieldErrors!.innerHTML += `<li>${escapeText(error)}</li>`)
                            )
                            json.form.fields.login.errors.forEach(
                                (error: string) =>
                                    (idLoginErrors.innerHTML += `<li>${escapeText(error)}</li>`)
                            )
                            json.form.fields.password.errors.forEach(
                                (error: string) =>
                                    (idPasswordErrors.innerHTML += `<li>${escapeText(error)}</li>`)
                            )
                        }

                        return {json, status: response.status}
                    })
                })
                .then((result: any) => {
                    if (!result) return
                    const {json, status, requiresEmailConfirmation} = result
                    if (status === 400) {
                        return
                    }
                    this.afterLogin(json, requiresEmailConfirmation)
                })
        })
    }

    afterLogin(json: any, requiresEmailConfirmation?: boolean): void {
        const currentLang = document.documentElement.lang
        if (requiresEmailConfirmation) {
            const contentsEl = document.querySelector(".fw-contents")
            if (contentsEl) {
                contentsEl.innerHTML = `<div class="fw-login-left">
                    <h1 class="fw-login-title">${gettext("Verify Your E-mail Address")}</h1>
                    <p>
                        ${gettext("We have sent an e-mail to your email address for verification. Follow the link provided to finalize the signup process.")}
                        <br />
                        ${gettext("Please contact us if you do not receive it within a few minutes.")}
                    </p>
                </div>`
            }
            return
        }
        if (json.html && json.html.length > 0) {
            const htmlValues = JSON.parse(json.html)
            if (
                htmlValues.user?.language &&
                htmlValues.user?.language !== currentLang
            ) {
                window.location.reload()
            } else {
                this.app.init()
            }
        } else {
            this.app.init()
        }
    }
}
