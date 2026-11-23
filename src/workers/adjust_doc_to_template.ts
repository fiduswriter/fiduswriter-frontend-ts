import {recreateTransform} from "@fiduswriter/editor/collab/merge/recreate_transform"
import {adjustDocToTemplate} from "@fiduswriter/document-template-editor/fix_doc"
import {Schema} from "prosemirror-model"

export class AdjustDocToTemplateWorker {
    schema: Schema
    doc: Record<string, unknown>
    template: Record<string, unknown>
    documentStyleSlugs: string[]
    sendMessage: (message: Record<string, unknown>) => void

    constructor(
        schemaSpec: Record<string, unknown>,
        doc: Record<string, unknown>,
        template: Record<string, unknown>,
        documentStyleSlugs: string[],
        sendMessage: (message: Record<string, unknown>) => void
    ) {
        this.schema = new Schema(schemaSpec as any)
        this.doc = doc
        this.template = template
        this.documentStyleSlugs = documentStyleSlugs
        this.sendMessage = sendMessage
    }

    init(): void {
        try {
            const stateDoc = this.schema.nodeFromJSON(this.doc)
            const newStateDoc = this.schema.nodeFromJSON(
                adjustDocToTemplate(
                    this.doc as any,
                    this.template as any,
                    this.documentStyleSlugs,
                    this.schema
                )
            )
            const transform = recreateTransform(stateDoc, newStateDoc)
            const steps: Array<Record<string, unknown>> = []
            transform.steps.forEach((step: any) => steps.push(step.toJSON()))
            this.sendMessage({type: "result", steps})
        } catch (error) {
            // Report the failure so the editor can clear its wait cover
            // instead of waiting forever for a result message.
            this.sendMessage({type: "error", error: String(error)})
        }
    }
}
