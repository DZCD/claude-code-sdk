/**
 * Tests for OutputFormat type and Zod schemas.
 *
 * OutputFormat constrains LLM responses to JSON Schema structured output.
 */
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { JsonSchemaOutputFormatSchema, OutputFormatSchema, OutputFormatTypeSchema } from '../types/output-format.js'
import type { JsonSchemaOutputFormat, OutputFormat, OutputFormatType } from '../types/output-format.js'

// ============================================================================
// Type-level tests
// ============================================================================

describe('OutputFormatType', () => {
  it('should only accept the literal "json_schema"', () => {
    const result = OutputFormatTypeSchema.safeParse('json_schema')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('json_schema')
    }
  })

  it('should reject non-matching strings', () => {
    const invalid = ['json', 'text', 'structured', ''] as const
    for (const val of invalid) {
      const result = OutputFormatTypeSchema.safeParse(val)
      expect(result.success).toBe(false, `Expected "${val}" to be rejected`)
    }
  })

  it('should reject non-string types', () => {
    const invalid = [null, 42, true, {}, []]
    for (const val of invalid) {
      const result = OutputFormatTypeSchema.safeParse(val)
      expect(result.success).toBe(false, `Expected ${JSON.stringify(val)} to be rejected`)
    }
  })
})

// ============================================================================
// JsonSchemaOutputFormat
// ============================================================================

describe('JsonSchemaOutputFormat', () => {
  it('should accept a valid JSON Schema output format', () => {
    const valid = {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      },
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.type).toBe('json_schema')
      expect(result.data.schema).toEqual(valid.schema)
    }
  })

  it('should accept a minimal schema (empty object)', () => {
    const valid = {
      type: 'json_schema',
      schema: {},
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should accept a schema with nested definitions', () => {
    const valid = {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              address: {
                type: 'object',
                properties: {
                  street: { type: 'string' },
                  city: { type: 'string' },
                },
              },
            },
          },
        },
      },
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should reject when type is not "json_schema"', () => {
    const invalid = {
      type: 'text',
      schema: {},
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should reject when schema is missing', () => {
    const invalid = {
      type: 'json_schema',
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should reject when schema is not an object', () => {
    const invalid = {
      type: 'json_schema',
      schema: 'not an object',
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should reject when schema is null', () => {
    const invalid = {
      type: 'json_schema',
      schema: null,
    }

    const result = JsonSchemaOutputFormatSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})

// ============================================================================
// OutputFormat (top-level union)
// ============================================================================

describe('OutputFormat', () => {
  it('should accept a JsonSchemaOutputFormat', () => {
    const valid = {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { result: { type: 'string' } },
      },
    }

    const result = OutputFormatSchema.safeParse(valid)
    expect(result.success).toBe(true)
  })

  it('should reject an object without type field', () => {
    const result = OutputFormatSchema.safeParse({
      schema: { type: 'object' },
    })
    expect(result.success).toBe(false)
  })

  it('should reject an unknown type value', () => {
    const result = OutputFormatSchema.safeParse({
      type: 'unknown_format',
      schema: {},
    })
    expect(result.success).toBe(false)
  })

  it('should produce the same result as JsonSchemaOutputFormatSchema for valid input', () => {
    const input = {
      type: 'json_schema' as const,
      schema: { type: 'object', properties: { x: { type: 'number' } } },
    }

    const viaOutputFormat = OutputFormatSchema.safeParse(input)
    const viaJsonSchema = JsonSchemaOutputFormatSchema.safeParse(input)

    expect(viaOutputFormat.success).toBe(viaJsonSchema.success)
    if (viaOutputFormat.success && viaJsonSchema.success) {
      expect(viaOutputFormat.data).toEqual(viaJsonSchema.data)
    }
  })

  // Edge: complex real-world JSON Schema
  it('should accept a complex JSON Schema with allOf/anyOf/oneOf', () => {
    const complex = {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              anyOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    label: { type: 'string' },
                  },
                  required: ['id'],
                },
              ],
            },
          },
        },
        additionalProperties: false,
      },
    }

    const result = OutputFormatSchema.safeParse(complex)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// Type inference
// ============================================================================

describe('Type inference', () => {
  it('should infer OutputFormatType from schema', () => {
    type Inferred = z.infer<typeof OutputFormatTypeSchema>
    const val: Inferred = 'json_schema'
    expect(val).toBe('json_schema')
  })

  it('should infer JsonSchemaOutputFormat from schema', () => {
    type Inferred = z.infer<typeof JsonSchemaOutputFormatSchema>
    const val: Inferred = {
      type: 'json_schema',
      schema: { type: 'object' },
    }
    expect(val.type).toBe('json_schema')
    expect(val.schema).toEqual({ type: 'object' })
  })

  it('should infer OutputFormat from schema', () => {
    type Inferred = z.infer<typeof OutputFormatSchema>
    const val: Inferred = {
      type: 'json_schema',
      schema: { type: 'object' },
    }
    expect(val.type).toBe('json_schema')
  })
})
