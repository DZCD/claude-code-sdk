# ConfigManager

配置管理器，支持多来源配置加载和合并。

## 创建 ConfigManager

```typescript
import { ConfigManager } from 'claude-code-sdk-ts'

const config = new ConfigManager(initialConfig?: Partial<SDKConfig>)
```

## 方法

### `getConfig()`

获取完整配置的拷贝：

```typescript
const cfg = config.getConfig()
```

### `update(partial)`

更新配置（深合并）：

```typescript
config.update({
  llm: { provider: 'vertex', projectId: 'my-project' },
})
```

### `loadFromFile(path)`

从 JSON 文件加载配置：

```typescript
config.loadFromFile('./settings.json')
```

### `saveToFile(path)`

保存配置到 JSON 文件（自动过滤默认值）：

```typescript
config.saveToFile('./settings.json')
```

### `loadFromEnv()`

从环境变量加载配置：

```typescript
const envConfig = config.loadFromEnv()
```

### `mergeFromEnv()`

将环境变量合并到当前配置：

```typescript
config.mergeFromEnv()
```

### `loadFromSources(sources)`

按优先级从多个来源加载：

```typescript
config.loadFromSources({
  filePath: './settings.json',
  env: process.env,
  cliArgs: { permissionMode: 'bypass' },
})
```

### `validate()`

使用内置规则验证配置（兼容旧版）：

```typescript
const result = config.validate()
console.log(result.errors) // string[]
```

### `validateZod()`

使用 Zod schema 验证配置，返回结构化错误：

```typescript
const result = config.validateZod()
if (!result.valid) {
  result.errors.forEach(e => {
    console.log(`${e.path}: ${e.message} (期望: ${e.expected}, 实际: ${e.actual})`)
  })
}
// "llm.apiKey: Required (期望: string, 实际: undefined)"
```

### `onDidChange(callback)`

监听配置变更事件：

```typescript
const unsubscribe = config.onDidChange((event) => {
  console.log(`配置变更: ${event.key} = ${event.newValue}`)
})
```

### `watch(path)`

监听配置文件的外部修改（热更新）：

```typescript
config.watch('./settings.json')
```

### `unwatch()`

停止监听配置文件。
