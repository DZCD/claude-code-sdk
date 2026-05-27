# Examples

This directory contains example scripts that demonstrate the Claude Code SDK's core capabilities.

## Prerequisites

- Node.js >= 18
- The SDK must be built (`npm run build` or `pnpm build`)
- A valid API Key for an Anthropic-compatible LLM endpoint

## Quick Start

The [`quickstart.ts`](./quickstart.ts) example demonstrates the SDK's core features:

1. **LLM Connector Initialization** — Connect to an Anthropic-compatible API
2. **Custom Tool Registration** — Define and register a `get_weather` tool
3. **ask() — Auto Tool Execution** — Send a message and let the LLM use tools automatically
4. **streamToText — Stream Text Only** — Consume a streaming response as plain text
5. **StreamConsumer — Event Subscription** — Subscribe to specific stream events

### Run

```bash
# From the project root
npx tsx examples/quickstart.ts
```

The example uses a pre-configured API Key. To use your own:

```bash
export MY_API_KEY="your-key-here"
npx tsx examples/quickstart.ts
```

> **Note:** Because the quickstart calls a real LLM API, it requires network access
> and a valid API Key. The tool calls are simulated (no real API calls to weather
> services), but the LLM interaction is real.
