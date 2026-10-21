import {extractTemplate} from "@fiduswriter/document-template-editor"
import {NativeImporter as GenericNativeImporter} from "@fiduswriter/document/importer/native"
import {addAlert, shortFileTitle} from "fwtoolkit"
import {E2EEEncryptor} from "fwtoolkit/e2ee/encryptor"
import {E2EEKeyManager} from "fwtoolkit/e2ee/key-manager"
import type {ApiConnectors} from "../../../api/index.js"

interface E2EEOptions {
    enabled: boolean
    key?: CryptoKey
    salt?: string
    iterations?: number
    sourceKey?: CryptoKey
}

interface CreateDocResult {
    id: number
    path: string
    e2ee: boolean
    template: string
}

interface SaveDataResult {
    added: number
    updated: number
}

interface ImageTranslationTable {
    [oldId: string]: number
}

export function createNativeImporterBackend(
    _user: Record<string, unknown>,
    _e2eeOptions: E2EEOptions | null,
    apiConnectors: ApiConnectors
): {
    createDoc: (
        template: any,
        importId: string | null,
        path: string,
        e2ee: E2EEOptions | null,
        files: Record<string, unknown>
    ) => Promise<CreateDocResult>
    saveImages: (
        images: {db: Record<string, any>},
        docId: number,
        e2ee: E2EEOptions | null
    ) => Promise<ImageTranslationTable>
    saveDocument: (saveData: any, e2ee: E2EEOptions | null) => Promise<SaveDataResult>
    extractTemplate: typeof extractTemplate
    encryptImage: typeof E2EEEncryptor.encryptImage
    encryptObject: typeof E2EEEncryptor.encryptObject
    encrypt: typeof E2EEEncryptor.encrypt
    storeKeyInSession: typeof E2EEKeyManager.storeKeyInSession
} {
    return {
        createDoc: (template, importId, path, e2ee, files) => {
            const jsonData: Record<string, unknown> = {
                template: template.content,
                export_templates: template.exportTemplates,
                document_styles: template.documentStyles,
                import_id: importId
                    ? importId
                    : template.content.attrs.import_id,
                template_title: template.content.attrs.template,
                path
            }
            if (e2ee?.enabled) {
                jsonData.e2ee = true
                if (e2ee.salt) {
                    jsonData.e2ee_salt = e2ee.salt
                }
                if (e2ee.iterations) {
                    jsonData.e2ee_iterations = e2ee.iterations
                }
            }
            return apiConnectors.documentImport.createDoc(jsonData, files as any)
                .then(({json}: any) => ({
                    id: json.id,
                    path: json.path,
                    e2ee: json.e2ee,
                    template: json.template
                }))
                .catch((error: Error) => {
                    addAlert("error", gettext("Could not create document"))
                    throw error
                })
        },
        saveImages: async (images, docId, e2ee) => {
            const isE2EE = e2ee?.enabled
            const ImageTranslationTable: ImageTranslationTable = {}
            await Promise.all(
                Object.entries(images.db as Record<string, any>).map(async ([oldId, imageEntry]: [string, any]) => {
                    await maybeDecryptImage(imageEntry, e2ee?.sourceKey)
                    const encryptedFile =
                        e2ee?.enabled && e2ee.key
                            ? await E2EEEncryptor.encryptImage(
                                  imageEntry.file,
                                  e2ee.key
                              )
                            : imageEntry.file
                    let title = imageEntry.title
                    let copyright = imageEntry.copyright
                    if (isE2EE && e2ee?.key) {
                        // Image metadata is encrypted with the target
                        // document key before upload.
                        title = await E2EEEncryptor.encryptObject(
                            title,
                            e2ee.key
                        )
                        if (copyright) {
                            copyright = await E2EEEncryptor.encryptObject(
                                copyright,
                                e2ee.key
                            )
                        }
                    }
                    const jsonData = {
                        doc_id: docId,
                        title: title,
                        copyright: copyright,
                        checksum: imageEntry.checksum
                    }
                    const files = {
                        image: {
                            file: encryptedFile,
                            filename: imageEntry.image.split("/").pop()
                        }
                    }
                    const result: any = isE2EE
                        ? await apiConnectors.documentImport.saveE2EEImage(jsonData, files as any)
                        : await apiConnectors.documentImport.saveImage(jsonData, files as any)
                    ImageTranslationTable[oldId] = result.json.id
                })
            )
            return ImageTranslationTable
        },
        saveDocument: async (saveData, e2ee) => {
            if (e2ee?.enabled && e2ee.key) {
                saveData.content = await E2EEEncryptor.encryptObject(
                    saveData.content,
                    e2ee.key
                )
                saveData.comments = await E2EEEncryptor.encryptObject(
                    saveData.comments || {},
                    e2ee.key
                )
                saveData.bibliography = await E2EEEncryptor.encryptObject(
                    saveData.bibliography,
                    e2ee.key
                )
                saveData.title = await E2EEEncryptor.encrypt(
                    saveData.title,
                    e2ee.key
                )
            }
            return apiConnectors.documentImport.saveDocument(saveData)
                .then(({json}: any) => ({added: json.added, updated: json.updated}))
                .catch((error: Error) => {
                    addAlert(
                        "error",
                        `${gettext("Could not save ")} ${shortFileTitle(
                            saveData.title,
                            ""
                        )}`
                    )
                    throw error
                })
        },
        extractTemplate,
        encryptImage: E2EEEncryptor.encryptImage.bind(E2EEEncryptor),
        encryptObject: E2EEEncryptor.encryptObject.bind(E2EEEncryptor),
        encrypt: E2EEEncryptor.encrypt.bind(E2EEEncryptor),
        storeKeyInSession: E2EEKeyManager.storeKeyInSession.bind(E2EEKeyManager)
    }
}

export class NativeImporter extends GenericNativeImporter {
    constructor(
        doc: any,
        bibliography: any,
        images: any,
        otherFiles: any,
        user: Record<string, unknown>,
        importId: string | null = null,
        requestedPath = "",
        template: any = null,
        e2eeOptions: E2EEOptions | null = null,
        apiConnectors: ApiConnectors
    ) {
        super(
            doc,
            bibliography,
            images,
            otherFiles,
            user as any,
            createNativeImporterBackend(user, e2eeOptions, apiConnectors) as any,
            {
                importId,
                requestedPath,
                template,
                e2eeOptions
            }
        )
    }
}

async function maybeDecryptImage(
    imageEntry: any,
    sourceKey: CryptoKey | undefined
): Promise<void> {
    if (!sourceKey || !imageEntry.file) {
        return
    }
    if (imageEntry.file_type !== "application/octet-stream") {
        return
    }
    const fileBuffer = await imageEntry.file.arrayBuffer()
    const bytes = new Uint8Array(fileBuffer)
    let binary = ""
    const chunkSize = 65536
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    const base64 = btoa(binary)
    const decrypted = await E2EEEncryptor.decryptBufferToBase64(base64, sourceKey)
    const mime = imageEntry.original_file_type || "image/png"
    const byteCharacters = atob(decrypted)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    imageEntry.file = new Blob([byteArray], {type: mime})
    imageEntry.file_type = mime
}
