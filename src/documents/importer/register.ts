import {
    ImporterRegistry,
    registerImporter
} from "@fiduswriter/document/importer/registry"

import {DocxImporter} from "./docx/index.js"
import {OdtImporter} from "./odt/index.js"
import {HtmlImporter} from "./html/index.js"

export {ImporterRegistry, registerImporter}

export const importerRegistry = new ImporterRegistry()

importerRegistry.register([["DOCX", ["docx"]]], DocxImporter)
importerRegistry.register([["ODT", ["odt"]]], OdtImporter)
importerRegistry.register([["HTML", ["html"]]], HtmlImporter)
