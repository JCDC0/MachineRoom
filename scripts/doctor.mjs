#!/usr/bin/env node
import { compareSurface, describeSurface, normalizePaperclipUrl, readSpec, shownPaperclipUrl } from '../server/surface.js'

const DEFAULT_URL = 'http://127.0.0.1:3100'
const HELP = [
  'npm run doctor',
  '',
  'Fetch the spec from a running Paperclip and compare it with the routes the bridge uses.',
  '',
  'Options:',
  '  --url <address>   Paperclip address, default http://127.0.0.1:3100',
  '  --help            Show this text.',
].join('\n')

function parse(argv) {
  const out = { url: process.env.PAPERCLIP_URL || DEFAULT_URL, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--url') {
      const value = argv[index + 1]
      if (!value) throw new Error('--url needs an address.')
      out.url = value
      index += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}. Run npm run doctor -- --help.`)
  }
  return out
}

function countLine(result) {
  const counts = []
  if (result.missing.length > 0) counts.push(`${result.missing.length} missing`)
  if (result.changed.length > 0) counts.push(`${result.changed.length} changed`)
  return `${result.checked} routes checked${counts.length > 0 ? `. ${counts.join(', ')}.` : '.'}`
}

async function main() {
  const args = parse(process.argv.slice(2))
  if (args.help) {
    console.log(HELP)
    return 0
  }
  const base = normalizePaperclipUrl(args.url)
  const place = shownPaperclipUrl(base)
  const spec = await readSpec(base)
  const version = typeof spec.info?.version === 'string' && spec.info.version ? spec.info.version : ''
  const result = compareSurface(spec)
  const lines = describeSurface(result)
  console.log(`Paperclip at ${place}`)
  if (version) console.log(`spec version: ${version}`)
  console.log('')
  if (lines.length > 0) {
    console.log('The spec does not match the routes the bridge uses.')
    for (const text of lines) console.log(text)
  } else {
    console.log('Every route the bridge uses is in the spec.')
  }
  console.log('')
  console.log(countLine(result))
  if (result.untypedAnswers > 0) {
    console.log(`note: the spec does not describe the answers of ${result.untypedAnswers} routes, so the fields the bridge reads were not compared.`)
  }
  if (result.untypedBodies > 0) {
    const word = result.untypedBodies === 1 ? 'route' : 'routes'
    console.log(`note: the spec does not describe the request body of ${result.untypedBodies} ${word}, so its fields were not compared.`)
  }
  if (result.sockets.length > 0) {
    const word = result.sockets.length === 1 ? 'route is' : 'routes are'
    console.log(`note: ${result.sockets.length} socket ${word} not in the spec, so it was not compared.`)
  }
  return result.ok ? 0 : 1
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  })
