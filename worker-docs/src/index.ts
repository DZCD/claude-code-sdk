import { Hono } from 'hono'
import { marked } from 'marked'
import { NAV_ITEMS } from './nav'
import { getContent } from './generated-content'

const app = new Hono()

const sidebarToggleJS = `var s=document.querySelector('.sidebar');var h=document.querySelector('.hamburger');var o=document.querySelector('.sidebar-overlay');if(s.classList.contains('open')){s.classList.remove('open');h.classList.remove('open');o.classList.remove('open')}else{s.classList.add('open');h.classList.add('open');o.classList.add('open')}`

function renderPage(
  title: string,
  htmlContent: string,
  currentSection: string,
  currentFile: string,
): string {
  const sectionLabel = NAV_ITEMS.find((s) => s.section === currentSection)
  const pageTitle = sectionLabel?.pages.find((p) => p.file === currentFile)?.title ?? title
  const sectionTitle = sectionLabel?.label ?? currentSection

  const sidebarHtml = NAV_ITEMS.map(
    (section) => `
    <div class="nav-section">
      <div class="nav-section-title">${section.label}</div>
      ${section.pages
        .map(
          (page) =>
            `<a href="/${section.section}/${page.file}" class="nav-link${currentSection === section.section && currentFile === page.file ? ' active' : ''}">${page.title}</a>`,
        )
        .join('')}
    </div>`,
  ).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${pageTitle} — Claude Code SDK</title>
<link rel="stylesheet" href="/style.css" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📖</text></svg>" />
</head>
<body class="bg-bg text-text font-sans">
  <div class="mobile-header">
    <button class="hamburger" onclick="${sidebarToggleJS}" aria-label="Toggle menu">
      <span></span><span></span><span></span>
    </button>
    <a href="/" class="mobile-logo">Claude Code SDK</a>
  </div>
  <div class="sidebar-overlay" onclick="${sidebarToggleJS}"></div>
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-header">
        <a href="/" class="logo">Claude Code SDK</a>
      </div>
      <nav class="sidebar-nav">
        ${sidebarHtml}
      </nav>
    </aside>
    <main class="main">
      <div class="breadcrumb"><a href="/">首页</a><span class="sep">/</span><span>${sectionTitle}</span><span class="sep">/</span><span>${pageTitle}</span></div>
      <article class="content prose-custom">${htmlContent}</article>
      <footer class="footer"><p>Claude Code SDK — MIT License <span class="sep">|</span> <a href="https://github.com/DZCD/claude-code-sdk">GitHub</a></p></footer>
    </main>
  </div>
</body>
</html>`
}

// Landing page
app.get('/', (c) => {
  const cards = [
    { icon: '🚀', title: '快速开始', desc: '5 分钟集成 Claude Code SDK', link: '/getting-started/installation' },
    { icon: '🔌', title: '多 Provider', desc: 'Anthropic、Bedrock、Vertex、Foundry', link: '/llm-providers/anthropic' },
    { icon: '🛠', title: '内置工具', desc: '8 个内置工具开箱即用', link: '/tools/bash' },
    { icon: '📖', title: '核心概念', desc: 'Session Engine、对话管理详解', link: '/core-concepts/sdk-overview' },
    { icon: '💡', title: '示例', desc: '基本对话、流式、工具调用', link: '/examples/basic-chat' },
    { icon: '🔍', title: '进阶', desc: '权限、上下文、错误处理', link: '/advanced/permission-system' },
  ]
    .map(
      (card) =>
        `<a href="${card.link}" class="feature-card"><div class="feature-icon">${card.icon}</div><div class="feature-title">${card.title}</div><div class="feature-desc">${card.desc}</div></a>`,
    )
    .join('')

  return c.html(`<!DOCTYPE html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Claude Code SDK — TypeScript SDK for Claude Code</title>
<link rel="stylesheet" href="/style.css" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📖</text></svg>" />
</head>
<body class="bg-bg text-text font-sans">
  <div class="landing">
    <header class="landing-header">
      <h1 class="landing-h1">Claude Code SDK</h1>
      <p class="subtitle">Standalone TypeScript SDK for Claude Code</p>
      <p class="desc">在任意 TypeScript 项目中集成 Claude 能力，不依赖 Claude Code 运行时</p>
      <div class="install-code"><code>npm install claude-code-sdk-ts</code></div>
      <div class="landing-links">
        <a href="/getting-started/quick-start" class="btn btn-primary">5 分钟快速上手</a>
        <a href="/core-concepts/sdk-overview" class="btn btn-secondary">了解架构</a>
      </div>
    </header>
    <div class="feature-grid">${cards}</div>
    <footer class="footer"><p>Claude Code SDK — MIT License <span class="sep">|</span> v0.5.0</p></footer>
  </div>
</body>
</html>`)
})

// Legacy redirects
app.get('/examples/basic-conversation', (c) => c.redirect('/examples/basic-chat', 301))
app.get('/examples/tool-calling', (c) => c.redirect('/examples/tool-usage', 301))

// Dynamic doc pages
app.get('/:section/:page', async (c) => {
  const { section, page } = c.req.param()
  const navItem = NAV_ITEMS.find((s) => s.section === section)
  if (!navItem) return c.notFound()
  const pageMeta = navItem.pages.find((p) => p.file === page)
  if (!pageMeta) return c.notFound()
  const markdown = getContent(`${section}/${page}`)
  if (!markdown) return c.notFound()
  const htmlContent = await marked.parse(markdown, { async: true })
  return c.html(renderPage(pageMeta.title, htmlContent, section, page))
})

// Section index redirect
app.get('/:section', (c) => {
  const { section } = c.req.param()
  const navItem = NAV_ITEMS.find((s) => s.section === section)
  if (!navItem || navItem.pages.length === 0) return c.notFound()
  return c.redirect(`/${section}/${navItem.pages[0].file}`)
})

export default app
