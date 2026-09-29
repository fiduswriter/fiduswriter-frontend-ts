import {describe, test, expect, beforeAll} from "@jest/globals"

import {profileContents} from "../src/user/profile/templates.js"

beforeAll(() => {
    ;(globalThis as Record<string, unknown>).gettext = (s: string) => s
})

const user = (preferences: Record<string, unknown>): Record<string, unknown> => ({
    username: "johndoe",
    first_name: "John",
    last_name: "Doe",
    language: "",
    avatar: null,
    emails: [],
    socialaccounts: [],
    preferences
})

const renderCheckbox = (preferences: Record<string, unknown>, id: string) => {
    const container = document.createElement("div")
    container.innerHTML = profileContents(user(preferences), [])
    return container.querySelector(`input#${id}`)
}

describe("profileContents editor preference checkboxes", () => {
    test("renders the grammar-check-continuous checkbox", () => {
        const container = document.createElement("div")
        container.innerHTML = profileContents(user({}), [])
        const checkbox = container.querySelector("input#grammar-check-continuous")
        expect(checkbox).not.toBeNull()
        expect(checkbox?.getAttribute("type")).toBe("checkbox")
        expect(container.textContent).toContain(
            "Continuous spell and grammar checking"
        )
    })

    test("grammar-check-continuous is checked when the preference is true", () => {
        const checkbox = renderCheckbox(
            {grammar_check_continuous: true},
            "grammar-check-continuous"
        )
        expect(checkbox?.hasAttribute("checked")).toBe(true)
    })

    test("grammar-check-continuous is unchecked when the preference is absent or false", () => {
        expect(
            renderCheckbox({}, "grammar-check-continuous")?.hasAttribute("checked")
        ).toBe(false)
        expect(
            renderCheckbox(
                {grammar_check_continuous: false},
                "grammar-check-continuous"
            )?.hasAttribute("checked")
        ).toBe(false)
    })

    test("still renders the inline-references and inline-math checkboxes", () => {
        const container = document.createElement("div")
        container.innerHTML = profileContents(
            user({inline_references: true, inline_math: false}),
            []
        )
        expect(
            container
                .querySelector("input#inline-references")
                ?.hasAttribute("checked")
        ).toBe(true)
        expect(
            container.querySelector("input#inline-math")?.hasAttribute("checked")
        ).toBe(false)
    })
})
