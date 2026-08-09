/**
 * seed.ts의 name/description/effectType/effectValue/tier/imageUrl을 DB에 반영 (증강만, 문제 유지 유지)
 * node scripts/sync-augment-meta.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const seedPath = path.join(__dirname, '../prisma/seed.ts')
const prisma = new PrismaClient()

function extractAugmentsFromSeed(src) {
  const sf = ts.createSourceFile(seedPath, src, ts.ScriptTarget.Latest, true)
  /** @type {Array<{name:string,description:string,effectType:string,effectValue:string,tier:string,imageUrl:string|null}>} */
  const out = []

  function lit(node) {
    if (!node) return null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isTemplateExpression(node)) {
      let s = node.head.text
      for (const span of node.templateSpans) {
        s += lit(span.expression) ?? ''
        s += span.literal.text
      }
      return s
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return `${lit(node.left) ?? ''}${lit(node.right) ?? ''}`
    }
    if (ts.isCallExpression(node) && node.expression.getText(sf) === 'JSON.stringify') {
      const arg = node.arguments[0]
      // evaluate simple object literals via Function
      try {
        const text = arg.getText(sf)
        // eslint-disable-next-line no-new-func
        const val = new Function(`return (${text})`)()
        return JSON.stringify(val)
      } catch {
        return '{}'
      }
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) return null
    if (ts.isAsExpression(node)) return lit(node.expression)
    return null
  }

  function walk(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(sf) === 'augments' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const el of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(el)) continue
        /** @type {Record<string, unknown>} */
        const row = {}
        for (const prop of el.properties) {
          if (!ts.isPropertyAssignment(prop)) continue
          const key = prop.name.getText(sf).replace(/['"]/g, '')
          row[key] = lit(prop.initializer)
        }
        if (row.name && row.effectType) {
          out.push({
            name: String(row.name),
            description: String(row.description || ''),
            effectType: String(row.effectType),
            effectValue: row.effectValue == null ? '{}' : String(row.effectValue),
            tier: String(row.tier || 'bronze'),
            imageUrl: row.imageUrl == null ? null : String(row.imageUrl),
          })
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

async function main() {
  const src = fs.readFileSync(seedPath, 'utf8')
  const augs = extractAugmentsFromSeed(src)
  if (!augs.length) throw new Error('seed에서 증강을 못 찾았습니다')

  let updated = 0
  let created = 0
  for (const a of augs) {
    const existing = await prisma.augment.findFirst({ where: { name: a.name, tier: a.tier } })
    if (existing) {
      await prisma.augment.update({
        where: { id: existing.id },
        data: {
          description: a.description,
          effectType: a.effectType,
          effectValue: a.effectValue,
          imageUrl: a.imageUrl,
          enabled: true,
        },
      })
      updated += 1
    } else {
      await prisma.augment.create({
        data: {
          name: a.name,
          description: a.description,
          effectType: a.effectType,
          effectValue: a.effectValue,
          tier: a.tier,
          imageUrl: a.imageUrl,
          enabled: true,
        },
      })
      created += 1
    }
  }
  console.log(`sync ok · updated ${updated} · created ${created} · seed ${augs.length}`)

  // seed에 없는 증강은 비활성 (삭제 대신 enabled=false)
  const seedKeys = new Set(augs.map((a) => `${a.name}::${a.tier}`))
  const all = await prisma.augment.findMany({ select: { id: true, name: true, tier: true, enabled: true } })
  let disabled = 0
  for (const row of all) {
    const key = `${row.name}::${row.tier}`
    if (!seedKeys.has(key) && row.enabled) {
      await prisma.augment.update({ where: { id: row.id }, data: { enabled: false } })
      disabled += 1
    }
  }
  if (disabled) console.log(`disabled ${disabled} augments not in seed`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
