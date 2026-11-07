/**
 * verify-host.mjs —— 改完 / 更新完 bridge，先看「自动唤醒」还在不在
 *
 * 为什么要这个：2026-10-29 一次批量改写把「自动唤醒」整段盖掉了，
 * 表现不是报错，而是 QQ 发消息没人回、日志只刷「先把它打开」——
 * 从外面完全看不出是代码被覆盖了。10-30 又踩过一回：
 * 函数还在，但 inject 里漏了 sessionController，等于白装。
 *
 * 怎么做的：本地改动包在 ===== LOCAL-PATCH:自动唤醒 START/END ===== 里，
 * 装机走 profile/vendor 里的 tarball（node tools/deploy.mjs 生成），
 * 不再靠 pnpm 安装时打补丁。这份体检逐条对：
 *
 *   node tools/verify-host.mjs
 *
 * 退出码 0 = 还在；非 0 = 被覆盖 / 装错副本，按打印的提示恢复。
 *
 * ⚠ 不要用 link: 装这个包。2026-10-30 试过，DSH 的 client-modules 不认符号链接，
 *   web-boot 直接「3 entries did not activate」，网页半边打不开。装机走 vendor tgz。
 */

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

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
const DSH家 = process.env.DSH_HOME || join(homedir(), '.dsh')
const 本包 = JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8'))
const 装好 = join(DSH家, 'profiles', 'desktop', 'node_modules', 本包.name, 'lib', 'host.js')
if (!existsSync(装好)) {
  备注('没找到装好的那份（' + 装好 + '），跳过这条')
} else {
  const 装好源 = readFileSync(装好, 'utf8')
  const 装好有注入 = 注入行(装好源).includes('sessionController')
  if (装好源.includes('拉活agent') && 装好源.includes('LOCAL-PATCH:自动唤醒 START') && 装好有注入) {
    过('装机目录那份带着本地改动（vendor tgz 装出来的，inject 也在）')
  } else {
    挂('装机那份缺本地改动：' + 装好 + ' —— 跑 node tools/deploy.mjs 重新打包部署')
  }
}

// 3.2 profile 依赖还指着 vendor tgz 吗
//     市场更新 / 「重装插件」会把依赖改回版本号或 git 地址，一改回去本地改动就没人装了。
const 配置路径 = join(DSH家, 'profiles', 'desktop', 'package.json')
if (existsSync(配置路径)) {
  const 配置 = JSON.parse(readFileSync(配置路径, 'utf8'))
  const 依赖 = 配置.dependencies || {}
  const 本地包 = [本包.name, 'dsh-ntr', 'dsh-whale-memory']
  const 裸的 = 本地包.filter((n) => 依赖[n] && !String(依赖[n]).startsWith('file:vendor/'))
  if (裸的.length) {
    挂('依赖不是 vendor tgz 了：' + 裸的.map((n) => n + '=' + 依赖[n]).join('，') +
      ' —— 八成是市场更新顶掉了，重装前先跑各自的 tools/deploy.mjs')
  } else if (依赖[本包.name] === undefined) {
    挂('profile 依赖里没有 ' + 本包.name + ' —— 先关 DSH，跑 node tools/deploy.mjs')
  } else {
    过(本地包.join(' / ') + ' 都指着 profile/vendor 里的 tgz')
  }
  const 捆 = 配置.dsh && 配置.dsh.profile && 配置.dsh.profile.bundles
  if (Array.isArray(捆)) {
    if (!捆.includes(本包.name)) 挂('dsh.profile.bundles 里没有 ' + 本包.name + ' —— 插件不会被加载')
    if (本包.name !== 'dsh-qq-bridge' && 捆.includes('dsh-qq-bridge')) 挂('bundles 里还留着旧包名 dsh-qq-bridge —— 先跑 deploy 迁移')
  }
  if (本包.name !== 'dsh-qq-bridge' && 依赖['dsh-qq-bridge'] !== undefined) {
    挂('旧包名 dsh-qq-bridge 还在 profile 依赖里 —— 先关 DSH，跑 node tools/deploy.mjs 迁到 ' + 本包.name)
  }
}

// 3.5 附赠：dsh-ntr 的 qq 兼容（不是 bridge，但以前每次 pnpm 安装都会被连带冲掉）
const ntr目录 = join(DSH家, 'profiles', 'desktop', 'node_modules', 'dsh-ntr')
const ntr文件 = ['presets/acp/acp-guard.mjs', 'lib/impl.js', 'src/impl.ts']
if (existsSync(ntr目录)) {
  const 缺 = ntr文件.filter((f) => {
    try { return !readFileSync(join(ntr目录, f), 'utf8').includes("kind === 'qq'") } catch (e) { return true }
  })
  if (缺.length) 备注('⚠ dsh-ntr 的 qq 兼容不在了（NTR 群会只收不回）：' + 缺.join('、') +
    ' —— 跑 dsh-ntr-local/tools/deploy.mjs 重新部署')
  else 过('dsh-ntr 的 qq 兼容还在（NTR 群能回）')
}

// 4. 汇总
for (const m of 通过) console.log('[ok]   ' + m)
for (const m of 说明) console.log('[note] ' + m)
for (const m of 挂了) console.log('[FAIL] ' + m)

if (挂了.length) {
  console.log('')
  console.log('自动唤醒/本地改动被覆盖了。恢复：')
  console.log('  · 装机那份不对：先关 DSH，再 node tools/deploy.mjs（重新打包 + 装 + 校验）')
  console.log('  · 依赖被市场更新顶回版本号/git 地址：同样跑 deploy.mjs，它会改回 file:vendor/…')
  console.log('  · 仓库 lib 少了自动唤醒那块：对照 git 历史或 profile/patches/*.patch（已标 .obsolete）补回来，')
  console.log('    补完 inject 里一定要有 sessionController，否则功能等于没装')
  console.log('  · dsh-ntr 的三处 qq 兼容：改 dsh-ntr-local 里的 lib/impl.js + src/impl.ts + presets/acp/acp-guard.mjs，')
  console.log('    再跑那边的 node tools/deploy.mjs')
  console.log('  · ⚠ 不要改回 link: —— 2026-10-30 试过，client-modules 不认链接，web-boot 起不来')
  console.log('  · 改完再跑一遍：node tools/verify-host.mjs')
  process.exit(1)
}

console.log('')
console.log('通过 ' + 通过.length + ' 项，可以重启。')
