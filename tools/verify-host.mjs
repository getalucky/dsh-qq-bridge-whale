/**
 * verify-host.mjs —— 改完 / 更新完 bridge，先看「自动唤醒」还在不在
 *
 * 为什么要这个：2026-10-29 一次批量改写把「自动唤醒」整段盖掉了，
 * 表现不是报错，而是 QQ 发消息没人回、日志只刷「先把它打开」——
 * 从外面完全看不出是代码被覆盖了。10-30 又踩过一回。
 *
 * 所以本地改动包在 ===== LOCAL-PATCH:自动唤醒 START/END ===== 里，
 * 再配这份体检，逐条对一遍：
 *
 *   node tools/verify-host.mjs
 *
 * 退出码 0 = 还在；非 0 = 被覆盖 / 装错副本，按打印的提示恢复。
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
    ['自动唤醒函数本身（拉活agent）', /const\s+拉活agent\s*=\s*async/],
    ['会话没开着时真的去拉活（调用点）', /await\s+拉活agent\(/],
    ['用宿主的 sessionController.resolveAgent 恢复会话', /resolveAgent\(/],
    ['拿不到 agent 会冷却，不会每条都重试刷屏', /拉活冷却/],
    ['失败原因写进日志（不再静默返回）', /想自动唤醒会话[^\r\n]*没成功/],
    ['「只回QQ唤醒」靠的唤醒时间记账', /唤醒时间\.set\(/],
    ['唤醒尾巴（一次触发的后半段也认）', /唤醒尾巴秒/],
  ]
  for (const [名, 正则] of 要) {
    if (正则.test(源)) 过(名)
    else 挂('缺了：' + 名)
  }

  if (/LOCAL-PATCH:自动唤醒 START/.test(源) && /LOCAL-PATCH:自动唤醒 END/.test(源)) {
    过('本地改动有 START/END 标记（下次重写好找）')
  } else {
    备注('没找到 LOCAL-PATCH 标记 —— 功能还在就行，但重写时容易再被盖掉')
  }
}

// 3. 装的那份到底带不带本地改动
//    2026-10-30：试过把依赖改成 link:，DSH 的 client-modules 不认符号链接 ——
//    web-boot 直接报「3 entries did not activate」（qq-bridge / dsh-ntr / dshmarket 的网页半边全挂），
//    所以改回 npm 包 + pnpm patch：profile/patches/dsh-qq-bridge@1.1.2.patch 在 install 时自动打上。
//    这里不比路径，比内容 —— 装的那份里有拉活，才算数。
const DSH家 = process.env.DSH_HOME || 'D:/DSH'
const 装好 = join(DSH家, 'profiles', 'desktop', 'node_modules', 'dsh-qq-bridge', 'lib', 'host.js')
if (!existsSync(装好)) {
  备注('没找到装好的那份（' + 装好 + '），跳过这条')
} else {
  const 装好源 = readFileSync(装好, 'utf8')
  if (装好源.includes('拉活agent') && 装好源.includes('LOCAL-PATCH:自动唤醒 START')) {
    过('装机目录那份带着本地改动（pnpm patch 生效）')
  } else {
    挂('装的是上游原版，补丁没打上：' + 装好 + ' —— 看 profile/pnpm-workspace.yaml 的 patchedDependencies 和 patches/ 里的补丁')
  }
}

// 4. 汇总
for (const m of 通过) console.log('[ok]   ' + m)
for (const m of 说明) console.log('[note] ' + m)
for (const m of 挂了) console.log('[FAIL] ' + m)

if (挂了.length) {
  console.log('')
  console.log('自动唤醒/本地改动被覆盖了。恢复：')
  console.log('  · 仓库里 HEAD 是好的：git checkout -- lib/host.js（会丢掉 host.js 上其它没提交的改动）')
  console.log('  · 装机目录是另一份 npm 包：把 profile 依赖改回 link:D:/Workspace/dsh-qq-bridge 再装')
  console.log('  · 改完再跑一遍：node tools/verify-host.mjs')
  process.exit(1)
}

console.log('')
console.log('通过 ' + 通过.length + ' 项，可以重启。')
