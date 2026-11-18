import { visibleChatText } from './orchestratorChat.js'

const INLINE_CODE = /(?<!`)(?<ticks>`+)(?!`)(?<code>[^\n]*?)(?<!`)\k<ticks>(?!`)/
const INLINE_LINK = /\[(?<label>[^[\]\n]+)\]\((?<url>(?:[^()\s]|\([^()\n]*\))+)\)/
const EMPHASIS = /(?<marker>\*{1,3}|(?<!\w)_{1,3})(?![\s*_])(?<content>[^\n]*?[^\s*_])\k<marker>(?![*_])/
const INLINE = new RegExp([INLINE_CODE, INLINE_LINK, EMPHASIS].map((pattern) => pattern.source).join('|'), 'g')
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*[^`]*$/
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/
const LIST = /^ {0,3}(?:[-*+]|(\d+)[.)])[ \t]+(.+)$/

function inline(text, depth = 0) {
  if (depth >= 4) return text
  const parts = []
  let end = 0
  for (const match of text.matchAll(INLINE)) {
    const { ticks, code, label, url, marker, content } = match.groups
    const key = match.index
    const next = key + match[0].length
    if (marker?.startsWith('_') && /\w/.test(text[next] ?? '')) continue
    if (key > end) parts.push(text.slice(end, key))
    if (ticks) {
      parts.push(<code className="mr-orch-code" key={key}>{code}</code>)
    } else if (label) {
      const href = /^(?:https?:\/\/|mailto:)/i.test(url) && !/[\s\\]/.test(url) ? url : ''
      parts.push(href ? <a key={key} href={href} target="_blank" rel="noreferrer">{label}</a> : label)
    } else {
      const body = inline(content, depth + 1)
      parts.push(marker.length === 1 ? <em key={key}>{body}</em> : <strong key={key}>{body}</strong>)
    }
    end = next
  }
  if (end < text.length) parts.push(text.slice(end))
  return parts
}

export default function Markdown({ text }) {
  const lines = visibleChatText(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let index = 0
  while (index < lines.length) {
    const key = index
    const line = lines[index++]
    if (!line.trim()) continue
    const fence = FENCE.exec(line)
    const heading = HEADING.exec(line)
    const item = LIST.exec(line)
    if (fence) {
      const marker = fence[1]
      const end = new RegExp('^ {0,3}' + marker[0] + '{' + marker.length + ',}[ \t]*$')
      const code = []
      while (index < lines.length && !end.test(lines[index])) code.push(lines[index++])
      if (index < lines.length) index += 1
      blocks.push(<pre key={key} className="mr-orch-block is-code"><code>{code.join('\n')}</code></pre>)
    } else if (heading) {
      const Tag = 'h' + heading[1].length
      blocks.push(<Tag key={key} className="mr-orch-block is-heading">{inline(heading[2])}</Tag>)
    } else if (item) {
      const number = item[1]
      const Tag = number ? 'ol' : 'ul'
      const items = [item[2]]
      while (index < lines.length) {
        const next = LIST.exec(lines[index])
        if (next && Boolean(number) === Boolean(next[1])) {
          items.push(next[2])
        } else if (!next && /^(?: {2,}|\t)\S/.test(lines[index]) && !FENCE.test(lines[index]) && !HEADING.test(lines[index])) {
          items[items.length - 1] += '\n' + lines[index].trim()
        } else {
          break
        }
        index += 1
      }
      blocks.push(
        <Tag key={key} className="mr-orch-block is-list" start={number ? Number(number) : undefined}>
          {items.map((entry, at) => <li key={at}>{inline(entry)}</li>)}
        </Tag>
      )
    } else {
      const paragraph = [line]
      while (index < lines.length && lines[index].trim() && !FENCE.test(lines[index])
        && !HEADING.test(lines[index]) && !LIST.test(lines[index])) paragraph.push(lines[index++])
      blocks.push(<p key={key} className="mr-orch-block is-para">{inline(paragraph.join('\n'))}</p>)
    }
  }
  return blocks
}
