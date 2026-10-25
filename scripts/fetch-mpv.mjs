// Downloads a Windows build of mpv into resources/mpv so the installer can ship it.
// Builds come from the mpv-player-windows project (shinchiro's builds) on SourceForge.
// Usage: node scripts/fetch-mpv.mjs [--force]

import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'resources', 'mpv')
const FEED = 'https://sourceforge.net/projects/mpv-player-windows/rss?path=/64bit'
// The generic x86_64 build runs on any 64-bit Windows PC (the -v3 builds need newer CPUs).
const BUILD = /mpv-x86_64-(\d{8})-git-[0-9a-f]+\.7z/

if (existsSync(join(target, 'mpv.exe')) && !process.argv.includes('--force')) {
  console.log('mpv is already in resources/mpv (use --force to download again).')
  process.exit(0)
}

const feed = await (await fetch(FEED)).text()
const name = feed.match(BUILD)?.[0]
if (!name) throw new Error(`Couldn't find an mpv build in ${FEED}`)
const url = `https://sourceforge.net/projects/mpv-player-windows/files/64bit/${name}/download`

console.log(`Downloading ${name}…`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
const archive = join(tmpdir(), name)
await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))

const sevenZip = createRequire(import.meta.url)('7zip-bin').path7za
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
execFileSync(sevenZip, ['x', archive, `-o${target}`, 'mpv.exe', 'd3dcompiler_43.dll', 'mpv/fonts.conf', '-y'], { stdio: 'ignore' })
rmSync(archive, { force: true })

if (!existsSync(join(target, 'mpv.exe'))) throw new Error('mpv.exe was not in the archive.')
writeFileSync(join(target, 'VERSION'), `${name}\n`)
console.log(`mpv ready in resources/mpv (${name}).`)
