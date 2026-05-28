/**
 * OutputFormat — Constrains LLM responses to JSON Schema structured output.
 *
 * Used in SDK ask() options to request structured JSON responses conforming
 * to a specific JSON Schema. Currently supports the 'json_schema' type.
 *
 * @see /home/user/.duclaw/workspace/claude-code-source-code/src/entrypoints/sdk/coreSchemas.ts lines 34-51
 */
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

/** Literal type value for JSON Schema output format */
export type OutputFormatType = z.infer<typeof OutputFormatTypeSchema>

/** Base output format with type discriminator */
export type BaseOutputFormat = z.infer<typeof BaseOutputFormatSchema>

/** JSON Schema constrained output format */
export type JsonSchemaOutputFormat = z.infer<typeof JsonSchemaOutputFormatSchema>

/** Top-level output format (currently only json_schema) */
export type OutputFormat = z.infer<typeof OutputFormatSchema>

// ============================================================================
// Schemas
// ============================================================================

/** Literal type discriminator for JSON Schema output format */
export const OutputFormatTypeSchema = z.literal('json_schema')

/** Base output format shape — all output formats must declare a type */
export const BaseOutputFormatSchema = z.object({
  type: OutputFormatTypeSchema,
})

/** JSON Schema output format: constrains the response to a specific JSON Schema */
export const JsonSchemaOutputFormatSchema = z.object({
  type: z.literal('json_schema'),
  schema: z.record(z.string(), z.unknown()),
})

/**
 * Output format schema — currently supports only json_schema.
 * Future output format types can be added via discriminatedUnion.
 */
export const OutputFormatSchema = JsonSchemaOutputFormatSchema
