// Browser server: web access. HTTP requests and page text extraction.
// No persistent session state. Future additions might include a headless
// browser (puppeteer/playwright) as a `browse` tool for JS-rendered pages,
// but v1 is just fetch + scrape.
//
// Metadata-only for now — implementation lands in a later commit.

import type { McpServerInfo } from './registry.js'

export const info: McpServerInfo = {
  id:          'browser',
  name:        'Browser',
  description: 'Web access: HTTP requests and page text extraction.',
  tools: [
    { name: 'fetch',  description: 'Make an HTTP request (GET/POST/etc.) and return the body.' },
    { name: 'scrape', description: 'Fetch a web page and return extracted text.' },
  ],
}
