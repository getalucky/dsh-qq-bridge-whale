/**
 * repair-bridge.mjs —— 装机目录被上游覆盖时，把本地版 lib 拷回去（带版本闸门）
 *
 * 为什么不用 pnpm：
 *   · `pnpm install` 状态没变时会说 "Already up to date"，不会重装；
 *   · `pnpm install --force` 实测会跳过 patchedDependencies，还会重装所有包，
 *     把 dsh-ntr 的 4 处兼容补丁一起冲掉（NTR 群变成只收不回）。2026-10-30 踩过。
 *
 * 这里只做一件确定的事：版本号一致才从仓库拷 lib/host.js + lib/client.js，
 * 先备份、先 node --check，失败自动回滚；版本不一致直接拒绝（防止拿旧版盖新版）。
 * 正常安装仍然走 pnpm patch（profile/patches/dsh-qq-bridge@1.1.2.patch）。
 *
 * 用法：node tools/repair-bridge.mjs
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 包根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH家 = process.env.DSH_HOME || 'D:/DSH'
const 装机 = join(DSH家, 'profiles', 'desktop', 'node_modules', 'dsh-qq-bridge')
const 戳 = new Date().toISOString().replace(/[:.]/g, '-')

const 读版本 = (目录) => {
  try { return JSON.parse(readFileSync(join(目录, 'package.json'), 'utf8')).version || '' } catch (e) { return '' }
}
const 本版 = 读版本(包根)
const 装版 = 读版本(装机)

if (!existsSync(装机)) {
  console.error('装机目录不存在：' + 装机 + ' —— 先在 profile 里正常 pnpm install')
  process.exit(2)
}
if (!本版 || 本版 !== 装版) {
  console.error('版本不一致：仓库 ' + (本版 || '?') + ' / 装机 ' + (装版 || '?') + '，拒绝拷贝')
  console.error('上游更新过的话，先对照 upstream/ 重新生成补丁，不要拿旧版盖新版。')
  process.exit(2)
}

const 改过 = []
const 回滚 = []
for (const f of ['lib/host.js', 'lib/client.js']) {
  const 源 = join(包根, f)
  const 标 = join(装机, f)
  if (!existsSync(源) || !existsSync(标)) continue
  const 甲 = readFileSync(源, 'utf8')
  const 乙 = readFileSync(标, 'utf8')
  if (甲 === 乙) continue
  const 备 = 标 + '.bak-repair-' + 戳
  copyFileSync(标, 备)
  回滚.push([备, 标])
  writeFileSync(标, 甲, 'utf8')
  try {
    execFileSync(process.execPath, ['--check', 标], { stdio: 'pipe' })
  } catch (e) {
    for (const [a, b] of 回滚.reverse()) copyFileSync(a, b)
    console.error(f + ' 拷回去后语法检查没过，已回滚：' + String(e.stderr || e.message || '').split('\n')[0])
    process.exit(3)
  }
  改过.push(f + '（旧文件备份为 ' + 备.split(/[\/]/).pop() + '）')
}

if (改过.length) {
  console.log('已从仓库拷回：')
  for (const m of 改过) console.log('  · ' + m)
} else {
  console.log('lib 已经和仓库一致，不用拷。')
}

// dsh-ntr 安全网：只在本机是 0.2.1 时才补快照
const ntr = join(装机, '..', 'dsh-ntr')
const 快照 = 'D:/Workspace/patches/dsh-ntr'
if (existsSync(ntr) && existsSync(快照) && 读版本(ntr) === '0.2.1') {
  for (const f of ['presets/acp/acp-guard.mjs', 'lib/impl.js', 'src/impl.ts']) {
    const 标 = join(ntr, f)
    const 源 = join(快照, f)
    if (!existsSync(标) || !existsSync(源)) continue
    if (readFileSync(标, 'utf8').includes("kind === 'qq'")) continue
    copyFileSync(标, 标 + '.bak-repair-' + 戳)
    copyFileSync(源, 标)
    console.log('已补回 dsh-ntr：' + f)
  }
}

try {
  execFileSync(process.execPath, [join(包根, 'tools', 'verify-host.mjs')], { stdio: 'inherit' })
} catch (e) {
  process.exit(4)
}
