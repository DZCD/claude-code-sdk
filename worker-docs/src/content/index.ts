import contentMap from './content-map'

export function getContent(path: string): string | undefined {
  return contentMap[path]
}
