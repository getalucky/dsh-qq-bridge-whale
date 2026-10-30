/**
 * verify-host.mjs —— 改完 / 更新完 bridge，先看「自动唤醒」还在不在
 *
 * 为什么要这个：2026-10-29 一次批量改写把「自动唤醒」整段盖掉了，
 * 表现不是报错，而是 QQ 发消息没人回、日志只刷「先把它打开」——
 * 从外面完全看不出是代码被覆盖了。10-30 又踩过一回：
 * 函数还在，但 inject 里漏了 sessionController，等于白装。
 *
 * 怎么做的：本地改动包在 ===== LOCAL-PATCH:自动唤醒 START/END ===== 里，
 * 补丁由 profile/patches/dsh-qq-bridge@1.1.2.patch 在 pnpm install 时打上。
 * 这份体检逐条对：
 *
 *   node tools/verify-host.mjs
 *
 * 退出码 0 = 还在；非 0 = 被覆盖 / 装错副本，按打印的提示恢复。
 *
 * ⚠ 不要用 link: 装这个包。2026-10-30 试过，DSH 的 client-modules 不认符号链接，
 *   web-boot 直接「3 entries did not activate」，网页半边打不开。用 git 依赖 + pnpm patch。
 */

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const 包根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const 宿主 = join(包根, 'lib', 'host.js')

const 通过 = []
const 挂了 = []
const 说明 = []
const 过 = (m) => 通过.push(m)
const 挂 = (m) => 挂了.push(m)
const 备注 = (m) => 说明.push(m)

// 找 export const inject 那一行（可能换行、可能带注释，按行找最稳）
const 注入行 = (源) => {
  const 行 = String(源 || '').split(/\r?\n/).find((l) => l.trimStart().startsWith('export const inject ='))
  return 行 || ''
}

// 1. 文件在不在、能不能解析（host.js 进不来 = 整个 DSH 起不来）
if (!existsSync(宿主)) {
  挂('lib/host.js 不见了')
} else {
  过('lib/host.js 在（' + readFileSync(宿主, 'utf8').length + ' 字）')
  try {
    execFileSync(process.execPath, ['--check', 宿主], { stdio: 'pipe' })
    过('语法检查通过（node --check）')
  } catch (e) {
    const 输出 = String(e.stderr || e.stdout || e.message || '')
    挂('语法检查失败，别重启 —— ' + 输出.split('\n').slice(0, 3).join(' / ').trim())
  }
}

// 2. 自动唤醒的每一环都还在
if (existsSync(宿主)) {
  const 源 = readFileSync(宿主, 'utf8')
  const 要 = [
    ['inject 里声明了 sessionController（不写就永远拿不到服务）', () => 注入行(源).includes('sessionController')],
    ['自动唤醒函数本身（拉活agent）', () => 源.includes('const 拉活agent = async')],
    ['会话没开着时真的去拉活（调用点）', () => 源.includes('await 拉活agent(')],
    ['用宿主的 sessionController.resolveAgent 恢复会话', () => 源.includes('resolveAgent(')],
    ['拿不到 agent 会冷却，不会每条都重试刷屏', () => 源.includes('拉活冷却')],
    ['失败原因写进日志（不再静默返回）', () => 源.includes('想自动唤醒会话') && 源.includes('没成功')],
    ['「只回QQ唤醒」靠的唤醒时间记账', () => 源.includes('唤醒时间.set(')],
    ['唤醒尾巴（一次触发的后半段也认）', () => 源.includes('唤醒尾巴秒')],
  ]
  for (const [名, 判] of 要) {
    if (判()) 过(名)
    else 挂('缺了：' + 名)
  }

  if (源.includes('LOCAL-PATCH:自动唤醒 START') && 源.includes('LOCAL-PATCH:自动唤醒 END')) {
    过('本地改动有 START/END 标记（下次重写好找）')
  } else {
    备注('没找到 LOCAL-PATCH 标记 —— 功能还在就行，但重写时容易再被盖掉')
  }
}

// 3. 装的那份到底带不带本地改动
//    这里不比路径，比内容 —— 装的那份里有拉活 + inject，才算数。
const DSH家 = process.env.DSH_HOME || 'D:/DSH'
const 装好 = join(DSH家, 'profiles', 'desktop', 'node_modules', 'dsh-qq-bridge', 'lib', 'host.js')
if (!existsSync(装好)) {
  备注('没找到装好的那份（' + 装好 + '），跳过这条')
} else {
  const 装好源 = readFileSync(装好, 'utf8')
  const 装好有注入 = 注入行(装好源).includes('sessionController')
  if (装好源.includes('拉活agent') && 装好源.includes('LOCAL-PATCH:自动唤醒 START') && 装好有注入) {
    过('装机目录那份带着本地改动（pnpm patch 生效，inject 也在）')
  } else {
    挂('装机那份缺本地改动（补丁没打上，或补丁里漏了 inject）：' + 装好 +
      ' —— 看 profile/pnpm-workspace.yaml 的 patchedDependencies 和 patches/ 里的补丁')
  }
}

// 4. 汇总
for (const m of 通过) console.log('[ok]   ' + m)
for (const m of 说明) console.log('[note] ' + m)
for (const m of 挂了) console.log('[FAIL] ' + m)

if (挂了.length) {
  console.log('')
  console.log('自动唤醒/本地改动被覆盖了。恢复：')
  console.log('  · 仓库里只是少了这段：对照 patches/ 里的补丁或上一个提交把 LOCAL-PATCH 块补回来')
  console.log('  · 装机那份被覆盖：node tools/repair-bridge.mjs（版本一致才从仓库拷回 lib；不要用 pnpm install --force）')
  console.log('    --force 会跳过补丁，还会把 dsh-ntr 的兼容补丁一起冲掉（10-30 已踩）')
  console.log('  · 仓库 lib 丢了：node tools/make-patch.mjs 1.1.2 重新生成（会先检查块在不在）')
  console.log('  · ⚠ 不要改回 link: —— 2026-10-30 试过，client-modules 不认链接，web-boot 起不来')
  console.log('  · 改完再跑一遍：node tools/verify-host.mjs')
  process.exit(1)
}

console.log('')
console.log('通过 ' + 通过.length + ' 项，可以重启。')
