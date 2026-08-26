// API connector interfaces for all API-calling modules.
// Each interface defines the methods that a module uses to talk to the backend.
// The default Django implementation will call postJson/getJson with hardcoded URLs.
// The interfaces exist so consuming apps can swap in alternative implementations.

import type {
    EditorDocumentApi,
    EditorDocumentImportApi
} from "@fiduswriter/editor"
import type {BibliographyApi} from "@fiduswriter/bibliography-manager"
import type {ImageApi} from "@fiduswriter/image-manager"
import type {DocumentTemplateApi} from "@fiduswriter/document-template-editor"

export type {BibliographyApi, ImageApi, DocumentTemplateApi}

// ---- ConfigApi ----

export interface ConfigApi {
    getConfiguration(): Promise<Record<string, unknown>>
}

// ---- DocumentApi ----

export interface DocumentApi extends EditorDocumentApi {
    getDocumentList(): Promise<Record<string, unknown>>
    getDocumentListExtra(ids: number[]): Promise<Record<string, unknown>>
    deleteDocument(data: {id?: number; ids?: number[]}): Promise<Record<string, unknown>>
    moveDocument(data: {id: number; path: string}): Promise<Record<string, unknown>>
    getEncryptionKeys(): Promise<Record<string, unknown>>
}

// ---- DocumentImportApi ----

export interface DocumentImportApi extends EditorDocumentImportApi {
    getTemplate(importId: string): Promise<Record<string, unknown>>
}

// ---- UserProfileApi ----

/** Response body of `POST /api/user/get_confirmkey_data/`. */
export interface ConfirmKeyDataResponse {
    username: string
    email: string
    /** The user already has another verified email address. */
    verified: boolean
    /** The currently logged-in user differs from the confirmed one. */
    logout?: boolean
}

export interface UserProfileApi {
    save(data: Record<string, unknown>): Promise<unknown>
    updatePreferences(data: Record<string, unknown>): Promise<unknown>
    avatarUpload(files: Record<string, unknown>): Promise<unknown>
    avatarDelete(): Promise<unknown>
    passwordChange(data: Record<string, unknown>): Promise<{json: Record<string, unknown>; status: number}>
    emailAdd(data: Record<string, unknown>): Promise<{json: Record<string, unknown>; status: number}>
    emailDelete(data: Record<string, unknown>): Promise<unknown>
    emailPrimary(data: Record<string, unknown>): Promise<unknown>
    deleteUser(data: Record<string, unknown>): Promise<Response>
    getSocialAccounts(): Promise<unknown>
    deleteSocialAccount(data: Record<string, unknown>): Promise<unknown>
    getConfirmKeyData(data: Record<string, unknown>): Promise<ConfirmKeyDataResponse>
    confirmEmail(key: string): Promise<unknown>
}

// ---- AuthApi ----

export interface TwoFactorSetupResponse {
    status: string
    message?: string
    secret_key: string
    device_id: string
    provisioning_uri: string
}

export interface TwoFactorVerifyResponse {
    status: string
    message: string
}

export interface TwoFactorStatusResponse {
    status: string
    enabled: boolean
}

export interface AuthApi {
    login(data: Record<string, unknown>): Promise<{json: Record<string, unknown>; status: number; requiresEmailConfirmation?: boolean}>
    signup(data: Record<string, unknown>): Promise<{json: Record<string, unknown>; requiresEmailConfirmation?: boolean}>
    passwordReset(data: {email: string}): Promise<unknown>
    passwordResetKeyGet(key: string): Promise<{url: string}>
    passwordResetKeyPost(url: string, data: Record<string, unknown>): Promise<unknown>
    logout(): Promise<unknown>
    twoFactorSetup(): Promise<TwoFactorSetupResponse>
    twoFactorVerify(data: Record<string, unknown>): Promise<TwoFactorVerifyResponse>
    twoFactorLogin(data: Record<string, unknown>): Promise<TwoFactorVerifyResponse>
    twoFactorDisable(): Promise<TwoFactorVerifyResponse>
    twoFactorStatus(): Promise<TwoFactorStatusResponse>
}

// ---- ContactsApi ----

export interface ContactsListResponse extends Record<string, unknown> {
    contacts: Array<Record<string, unknown>>
}

export interface ContactsInviteResponse {
    redirect: string
}

export interface ContactsApi {
    list(): Promise<ContactsListResponse>
    delete(data: Record<string, unknown>): Promise<{status: number}>
    add(data: {user_string: string}): Promise<{json: Record<string, unknown>; status: number}>
    accept(data: Record<string, unknown>): Promise<{json: Record<string, unknown>; status: number}>
    decline(data: Record<string, unknown>): Promise<{status: number}>
    invite(data: {key: string}): Promise<ContactsInviteResponse>
}

// ---- FlatPageApi ----

export interface FlatPageApi {
    get(key: string): Promise<Record<string, unknown>>
}

// ---- SystemMessageApi ----

export interface SystemMessageApi {
    get(): Promise<Record<string, unknown>>
    send(data: Record<string, unknown>): Promise<Record<string, unknown>>
}

// ---- ErrorHookApi ----

export interface ErrorHookApi {
    send(data: Record<string, unknown>): Promise<unknown>
}

// ---- FeedbackApi ----

export interface FeedbackApi {
    send(data: {message: string}): Promise<unknown>
}

// ---- MaintenanceApi ----

export interface OldDocsResponse {
    docs: string
}

export interface UserBibListResponse {
    bibList: Array<Record<string, unknown>>
}

export interface TemplateIdsResponse {
    template_ids: number[]
}

export interface TemplateBaseResponse {
    content: Record<string, unknown> | Array<Record<string, unknown>>
    title: string
    doc_version: string
}

export interface RevisionIdsResponse {
    revision_ids: number[]
}

export interface MaintenanceApi {
    getAllOldDocs(): Promise<OldDocsResponse>
    getUserBibList(data: {user_id: number}): Promise<UserBibListResponse>
    saveDoc(data: Record<string, unknown>): Promise<unknown>
    addImagesToDoc(data: Record<string, unknown>): Promise<unknown>
    getAllTemplateIds(): Promise<TemplateIdsResponse>
    getTemplateBase(data: {id: number}): Promise<TemplateBaseResponse>
    saveTemplate(data: Record<string, unknown>): Promise<unknown>
    getAllRevisionIds(): Promise<RevisionIdsResponse>
    getRevision(id: number): Promise<Response>
    updateRevision(id: number, blob: Blob): Promise<unknown>
}

// ---- RevisionApi ----

export interface RevisionApi {
    getRevisionBlob(id: number): Promise<Blob>
    deleteRevision(data: {id: number}): Promise<unknown>
}

// ---- Bundled connectors ----

export interface ApiConnectors {
    document: DocumentApi
    documentImport: DocumentImportApi
    userProfile: UserProfileApi
    auth: AuthApi
    contacts: ContactsApi
    documentTemplate: DocumentTemplateApi
    flatPage: FlatPageApi
    systemMessage: SystemMessageApi
    errorHook: ErrorHookApi
    feedback: FeedbackApi
    config: ConfigApi
    maintenance: MaintenanceApi
    revision: RevisionApi
    bibliography: BibliographyApi
    image: ImageApi
}
