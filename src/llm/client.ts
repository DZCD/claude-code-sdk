import { AnthropicConnector, isAnthropicConfig } from './anthropic.js'
import { BedrockConnector, isBedrockConfig } from './bedrock.js'
import { FoundryConnector, isFoundryConfig } from './foundry.js'
/**
 * ClaudeCode SDK — LLM Client
 *
 * Factory and facade for the LLM communication layer.
 * Creates the appropriate connector based on configuration.
 */
import type { LLMConfig, LLMConnector, LLMProvider } from './types.js'
import { VertexConnector, isVertexConfig } from './vertex.js'

export { AnthropicConnector } from './anthropic.js'
export { BedrockConnector } from './bedrock.js'
export { VertexConnector } from './vertex.js'
export { FoundryConnector } from './foundry.js'
export type * from './types.js'

/** Create an LLM connector based on the provided configuration */
export function createLLMConnector(config: LLMConfig): LLMConnector {
  if (isAnthropicConfig(config)) return new AnthropicConnector(config)
  if (isBedrockConfig(config)) return new BedrockConnector(config)
  if (isVertexConfig(config)) return new VertexConnector(config)
  if (isFoundryConfig(config)) return new FoundryConnector(config)
  throw new Error(`Unsupported LLM provider: ${(config as { provider: string }).provider}`)
}

/** Get the list of supported providers */
export function getSupportedProviders(): LLMProvider[] {
  return ['anthropic', 'bedrock', 'vertex', 'foundry']
}
