/**
 * 生成可发布的干净副本：dist/。
 *
 * 它做三件事：
 *   1. 复制白名单里的文件，跳过备份、缓存、运行数据；
 *   2. 把本机绝对路径换成占位符（发布出去的东西不该带我的用户名）；
 *   3. 用 cordis.patch.yml.example 代替本机正在用的 cordis.patch.yml。
 *
 * 用法：node scripts/release.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist')

/** 只带这些文件出去。 */
const FILES = [
  'index.js',
  'client.js',
  'widget.py',
  'painter.py',
  'package.json',
  'README.md',
  'README.en.md',
  'LICENSE',
  '.gitignore',
  'icon.svg',
  'cordis.patch.yml.example',
  'docs/DETAIL.md',
  'docs/PR.md',
  'docs/preview.png',
  'scripts/apply_bridge_patch.py',
  'scripts/release.mjs',
  'docs/PATCH.md',
  'locale/zh.json',
  'locale/en.json',
  'test/recorder.test.mjs',
]

/** 本机路径 → 占位符。顺序重要：先长后短。 */
const REPLACEMENTS = [
  ['D:\\\\black-souls-mcp\\\\runtime\\\\game2', ''],
  ["D:\\\\black-souls-mcp\\\\runtime\\\\game2", ''],
  ['', ''],
  ['<你的数据目录>', '<你的数据目录>'],
  ['C:\\\\Users\\\\<user>\\\\Documents\\\\deepseek-harness\\\\default-workspace\\\\阅读记录', '<你的数据目录>'],
  ['<user>', '<user>'],
  ['black-souls-mcp', 'black-souls-mcp'],
]

function scrub(text) {
  let result = text
  for (const [from, to] of REPLACEMENTS) result = result.split(from).join(to)
  return result
}

fs.rmSync(out, { recursive: true, force: true })

// 发布版用 package.json.publish（带 keywords / repository，且指向真实的 patch 文件）
const publishPackage = path.join(root, 'package.json.publish')
const publishTarget = path.join(out, 'package.json')

let copied = 0
for (const relative of FILES) {
  const source = path.join(root, relative)
  if (!fs.existsSync(source)) {
    console.log(`跳过（不存在）: ${relative}`)
    continue
  }
  const target = path.join(out, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const copy = fs.readFileSync(source)
  const isText = /\.(js|mjs|json|yml|yaml|md|py|txt|svg|gitignore)$/.test(relative) || relative.endsWith('.gitignore')
  fs.writeFileSync(target, isText ? scrub(copy.toString('utf8')) : copy)
  copied += 1
}

// 检查一遍：dist 里不该再出现本机路径
const leaks = []
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/<user>|black-souls-mcp/.test(fs.readFileSync(full, 'utf8'))) leaks.push(path.relative(out, full))
  }
}
walk(out)

if (fs.existsSync(publishPackage)) {
  fs.copyFileSync(publishPackage, publishTarget)
  console.log('用 package.json.publish 覆盖了 dist/package.json')
}
// 仓库里给的是可直接改的配置：example → cordis.patch.yml
const example = path.join(out, 'cordis.patch.yml.example')
if (fs.existsSync(example)) {
  fs.copyFileSync(example, path.join(out, 'cordis.patch.yml'))
  console.log('已生成 dist/cordis.patch.yml（占位路径，用户自己改）')
}

console.log(`dist/ 生成完成：${copied} 个文件`)
if (leaks.length > 0) {
  console.log('仍有本机路径残留：', leaks.join(', '))
  process.exit(1)
}
console.log('检查通过：没有本机绝对路径')
