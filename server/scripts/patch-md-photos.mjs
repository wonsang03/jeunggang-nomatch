/** 증강.md에서 seed에 imageUrl 있는 항목의 「사진 | 없음」→「있음」 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const mdPath = path.join(root, '증강.md')
const seed = fs.readFileSync(path.join(root, 'server/prisma/seed.ts'), 'utf8')

const names = new Set()
const re = /name:\s*'([^']+)'[\s\S]*?imageUrl:\s*(\/[^\s']+|null|'[^']+')/g
let m
while ((m = re.exec(seed))) {
  const url = m[2]
  if (url && url !== 'null' && !url.includes('null')) names.add(m[1])
}

let md = fs.readFileSync(mdPath, 'utf8')
let n = 0
for (const name of names) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sectionRe = new RegExp(`(### ${esc}[\\s\\S]*?\\| 사진 \\| )없음`)
  if (sectionRe.test(md)) {
    md = md.replace(sectionRe, '$1있음')
    n += 1
  }
}
fs.writeFileSync(mdPath, md)
console.log(`photo flags updated: ${n}`)
