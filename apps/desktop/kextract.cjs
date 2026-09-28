const fs = require('fs')
const path = require('path')
const dir = path.join(process.env.TEMP, 'kprobe')
const names = ['sf-gemma4-train-main', 'sf-gemma4-adapter-test', 'sf-gemma4-e2b-train']
for (const n of names) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, n + '.zip'), 'utf8'))
  console.log('='.repeat(70))
  console.log(n, '| slug:', j.blob.slug, '| lang:', j.blob.language, '| hasSource:', j.blob.hasSource)
  const raw = j.blob.source || j.blob.sourceNullable
  if (!raw) { console.log('  NO SOURCE'); continue }
  let nb
  try { nb = typeof raw === 'string' ? JSON.parse(raw) : raw } catch (e) { console.log('  parse fail', e.message.slice(0, 80)); continue }
  if (nb.__notebookBase) { const w = {}; for (const k of Object.keys(nb)) if (!k.startsWith('__')) w[k] = nb[k]; nb = w }
  const cells = nb.cells || []
  const src = cells.map((c, i) => `# [cell ${i}] ${c.cell_type}\n` + (Array.isArray(c.source) ? c.source.join('') : c.source || '') + '\n').join('\n')
  fs.writeFileSync(path.join(dir, n + '.py'), src, 'utf8')
  console.log('  ->', n + '.py', (src.length / 1024).toFixed(1) + 'KB, cells:', cells.length)
}
