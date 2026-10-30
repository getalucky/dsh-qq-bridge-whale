/**
 * deploy.mjs —— 把仓库里的 dsh-qq-bridge-whale 打成 tarball 装进 desktop profile
 *
 * 为什么不再用 pnpm patch：
 *   · patchedDependencies 按「名字@版本」匹配，上游一发 1.1.3 或市场更新一次，
 *     key 就对不上，pnpm 只提示补丁未使用、照样装裸包 —— 本地那十几项优化整体消失。
 *   · 补丁的上下文锚在手工存的 upstream/1.1.2 快照上，而装机工件来自 git commit
 *     6731c02，基准和工件对不齐。
 *   · nodeLinker: hoisted 下改了 .patch，普通 install 常判「已最新」不重新解包，
 *     要 --force —— 看起来就像“又被覆盖回去了”。
 * 现在 profile 依赖 vendor 里的 tgz，lockfile 锁的是这个制品自己的 integrity，
 * 没人能在重装时把它换成裸包。
 *
 * 用法：
 *   node tools/deploy.mjs        （或双击 tools/deploy.cmd）
 *
 * 要求：先关掉 DSH。安装会重写 profile/node_modules，运行中装容易触发同类崩溃。
 * 装完再打开 DSH；以后每次改完 lib/ 都跑一次，不跑就还是旧代码。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const 根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH家 = process.env.DSH_HOME || 'D:/DSH'
const profile = join(DSH家, 'profiles', 'desktop')
const vendor = join(profile, 'vendor')
const 包 = JSON.parse(readFileSync(join(根, 'package.json'), 'utf8'))
const 包名 = 包.name
const 旧包名 = 'dsh-qq-bridge' // 2026-10-30 改名前的包名，仅用于 profile 迁移
const 装机 = join(profile, 'node_modules', 包名)
const pnpm = join(
  DSH家,
  'dsh-runtimes',
  'dsh-primary-runtime',
  'dependencies',
  'pnpm',
  'bin',
  'pnpm.cjs',
)

const 跑 = (cmd, args, opts = {}) => {
  console.log('> ' + cmd + ' ' + args.join(' '))
  execFileSync(cmd, args, { stdio: 'inherit', ...opts })
}

const 出 = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts })

const DSH在跑 = () => {
  try {
    return 出('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe']).includes('DeepSeek Harness.exe')
  } catch {
    return false
  }
}

const 摘要 = (路径) => createHash('sha256').update(readFileSync(路径)).digest('hex')

// Windows 上 execFileSync 不能直接 spawn .cmd（EINVAL），npm 裸名有时又解析不到 —— 两条路都试。
const npm备用 = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
function 跑npm(args, opts) {
  try {
    return 出('npm', args, opts)
  } catch (错) {
    if (existsSync(npm备用)) return 出(process.execPath, [npm备用, ...args], opts)
    throw 错
  }
}

const 是备份 = (名) => /\.bak[-.]/i.test(名) || /~$/.test(名)
const 忽略目录 = new Set(['.git', 'node_modules', 'patches', 'upstream', '.pack', 'tools'])

function 走本地(目录, 前缀) {
  const 结果 = []
  for (const 项 of readdirSync(目录)) {
    if (忽略目录.has(项) || 是备份(项)) continue
    const 相对 = join(前缀, 项)
    const 绝对 = join(目录, 项)
    if (statSync(绝对).isDirectory()) 结果.push(...走本地(绝对, 相对))
    else if (相对 !== 'package.json') 结果.push(相对)
  }
  return 结果
}

// 真正发出去的文件 = package.json 的 files 白名单（npm 另外会自己塞 README/LICENSE）
// tools/ 里那些是开发脚本，只有一件是运行时真需要的：host.js 会拼 PACKAGE_ROOT/tools/asr_cli.py。
const 运行时必需 = ['tools/asr_cli.py']

function 要装的() {
  const 结果 = []
  for (const 项 of 包.files || []) {
    if (忽略目录.has(项)) continue
    const 绝对 = join(根, 项)
    if (!existsSync(绝对)) continue
    if (statSync(绝对).isDirectory()) 结果.push(...走本地(绝对, 项))
    else 结果.push(项)
  }
  for (const 项 of 运行时必需) {
    if (existsSync(join(根, 项)) && !结果.includes(项)) 结果.push(项)
  }
  return 结果
}

// ---------------------------------------------------------------- 前置检查

const 试跑 = process.argv.includes('--dry-run')

if (!试跑 && DSH在跑()) {
  console.error('\nDSH 正在运行。先把它关掉，再跑这个脚本；装完再打开。')
  console.error('（运行中替换 node_modules 就是 2026-10-30 那几次崩溃的成因。）')
  process.exit(1)
}
if (!existsSync(pnpm)) {
  console.error('找不到 pnpm：' + pnpm + '（DSH_HOME 设成了 ' + DSH家 + '？）')
  process.exit(1)
}

// 防呆：仓库 lib 要是被上游文件盖回去过，打出来的包就没有自动唤醒，
// 装上等于亲手把装机也带坏。
const 源host = join(根, 'lib', 'host.js')
const host文本 = readFileSync(源host, 'utf8')
const inject行 = (host文本.match(/^export const inject =.*$/m) || [''])[0]
const 缺 = []
if (!host文本.includes('LOCAL-PATCH:自动唤醒 START')) 缺.push('LOCAL-PATCH:自动唤醒 块')
if (!host文本.includes('拉活agent')) 缺.push('拉活agent')
if (!inject行.includes('sessionController')) 缺.push('inject 里的 sessionController')
if (缺.length) {
  console.error('仓库 lib/host.js 里缺：' + 缺.join('、') + ' —— 先别打包。')
  console.error('对照 git 历史把自动唤醒那套补回来（inject 里没有 sessionController 的话，功能等于没装）。')
  process.exit(1)
}

// ---------------------------------------------------------------- 打包

const 时间 = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').slice(0, 14)
const 暂存 = join(tmpdir(), 'dsh-qq-bridge-pack-' + Date.now())
const 打包根 = join(暂存, 'pkg')
mkdirSync(打包根, { recursive: true })

console.log('\n[1/5] 准备打包目录（按 package.json 的 files，剔掉 *.bak-*）')
const 清单 = 要装的()
for (const 项 of 清单) {
  const 目标 = join(打包根, 项)
  mkdirSync(dirname(目标), { recursive: true })
  copyFileSync(join(根, 项), 目标)
}
// npm pack 会自己带上 README / LICENSE，顺手拷过来，免得市场页显示「无说明」
for (const 项 of ['README.md', 'CHANGELOG.md', 'LICENSE', 'LICENCE']) {
  if (existsSync(join(根, 项))) copyFileSync(join(根, 项), join(打包根, 项))
}
copyFileSync(join(根, 'package.json'), join(打包根, 'package.json'))
console.log('      ' + 清单.length + ' 个文件')

console.log('\n[2/5] npm pack')
const 落地 = 试跑 ? join(根, '.pack') : vendor
mkdirSync(落地, { recursive: true })
let 包文件名 = ''
try {
  const 产物 = 跑npm(['pack', '--pack-destination', 落地], { cwd: 打包根 })
    .trim()
    .split(/\r?\n/)
    .filter((行) => 行.trim().endsWith('.tgz'))
    .pop()
  if (!产物) throw new Error('npm pack 没报出 tgz 文件名')
  包文件名 = `${包名}-${包.version}-local-${时间}.tgz`
  renameSync(join(落地, 产物.trim()), join(落地, 包文件名)) // 同盘改名，跨盘会 EXDEV
} catch (错) {
  console.error('\n打包失败：' + String((错 && 错.message) || 错))
  process.exit(1)
} finally {
  rmSync(暂存, { recursive: true, force: true })
}
const 包路径 = join(落地, 包文件名)
console.log('      ' + 包路径 + '（' + 清单.length + ' 个文件）')
if (试跑) {
  console.log('\n[试跑] 只验证打包，profile 一点没动。清单：')
  for (const 项 of 清单) console.log('      ' + 项)
  process.exit(0)
}

// ---------------------------------------------------------------- 改 profile

const 配置路径 = join(profile, 'package.json')
const 锁路径 = join(profile, 'pnpm-lock.yaml')
const 工作路径 = join(profile, 'pnpm-workspace.yaml')
for (const p of [配置路径, 锁路径, 工作路径]) {
  if (existsSync(p)) copyFileSync(p, p + '.bak-before-deploy')
}

console.log('\n[3/5] 依赖改成 vendor tgz，并摘掉本包的 patchedDependencies')
const 配置 = JSON.parse(readFileSync(配置路径, 'utf8'))
配置.dependencies[包名] = 'file:vendor/' + 包文件名
if (旧包名 !== 包名 && 配置.dependencies[旧包名] !== undefined) {
  delete 配置.dependencies[旧包名]
  console.log(`      已从依赖里移除旧包名 ${旧包名}`)
}
const 捆 = 配置.dsh && 配置.dsh.profile && 配置.dsh.profile.bundles
if (Array.isArray(捆)) {
  const 留下 = 旧包名 === 包名 ? [...捆] : 捆.filter((n) => n !== 旧包名)
  if (!留下.includes(包名)) 留下.push(包名)
  配置.dsh.profile.bundles = 留下
  if (留下.length !== 捆.length || !捆.includes(包名)) {
    console.log(`      bundles 已切到 ${包名}${旧包名 !== 包名 ? `（移除 ${旧包名}）` : ''}`)
  }
} else {
  console.log('      ⚠ profile 里没有 dsh.profile.bundles，跳过 bundle 切换')
}
writeFileSync(配置路径, JSON.stringify(配置, null, 2) + '\n', 'utf8')
console.log(`      ${包名}: file:vendor/${包文件名}`)
摘补丁(工作路径, 包名, 包.version)

// 留着指向 file: 依赖的 patchedDependencies 会出事：条目清空后 pnpm 读到 null 直接报错，
// 所以整块空了要把键本身一起删掉。
function 摘补丁(路径, 名, 版本) {
  if (!existsSync(路径)) return
  const 行 = readFileSync(路径, 'utf8').split(/\r?\n/)
  const 头 = 行.findIndex((l) => /^\s*patchedDependencies:\s*$/.test(l))
  if (头 < 0) {
    console.log('      pnpm-workspace.yaml 里没有 patchedDependencies')
    return
  }
  const 缩进 = (行[头].match(/^\s*/) || [''])[0].length
  let 尾 = 头 + 1
  while (尾 < 行.length) {
    const l = 行[尾]
    if (l.trim() === '' || (l.match(/^\s*/) || [''])[0].length > 缩进) {
      尾 += 1
      continue
    }
    break
  }
  while (尾 > 头 + 1 && 行[尾 - 1].trim() === '') 尾 -= 1 // 块尾的空行不属于这个块
  const 内容 = 行.slice(头 + 1, 尾).filter((l) => l.trim() !== '')
  const 本包 = (l) => l.trim().replace(/^['"]/, '').startsWith(`${名}@`)
  const 留下 = 内容.filter((l) => !本包(l))
  if (留下.length === 内容.length) {
    console.log(`      patchedDependencies 里没有 ${名}@${版本}，不动`)
    return
  }
  const 新行 = 留下.length
    ? [...行.slice(0, 头 + 1), ...留下, ...行.slice(尾)]
    : [...行.slice(0, 头), ...行.slice(尾)]
  writeFileSync(路径, 新行.join('\n').replace(/\n{3,}/g, '\n\n'), 'utf8')
  console.log(
    留下.length
      ? `      已移除 ${名}@${版本} 的补丁条目`
      : `      patchedDependencies 只剩本包，键和条目一起删掉`,
  )
}

// ---------------------------------------------------------------- 安装

console.log('\n[4/5] pnpm install')
const 装 = (额外 = []) => 跑(process.execPath, [pnpm, 'install', '--dir', profile, '--prefer-offline', ...额外])
try {
  装()
} catch {
  console.error('\n安装失败，恢复 package.json / pnpm-lock.yaml / pnpm-workspace.yaml')
  for (const p of [配置路径, 锁路径, 工作路径]) {
    if (existsSync(p + '.bak-before-deploy')) copyFileSync(p + '.bak-before-deploy', p)
  }
  process.exit(1)
}

// ---------------------------------------------------------------- 校验

console.log('\n[5/5] 校验装机产物')
const 比对 = () => {
  const 问题 = []
  for (const 项 of 清单) {
    const 源 = join(根, 项)
    const 标 = join(装机, 项)
    if (!existsSync(标)) 问题.push(项 + '：装机里没有')
    else if (摘要(源) !== 摘要(标)) 问题.push(项 + '：与仓库不一致')
  }
  return 问题
}

let 问题 = 比对()
if (问题.length) {
  console.warn('      ' + 问题.slice(0, 5).join('；') + ' —— pnpm 大概走了“已最新”的快路径，加 --force 重装')
  装(['--force'])
  问题 = 比对()
}
if (问题.length) {
  console.error('\n装机仍然对不上（前 10 条）：\n  ' + 问题.slice(0, 10).join('\n  '))
  console.error('先别开 DSH。检查 ' + 包路径 + ' 和 ' + 装机)
  process.exit(1)
}
console.log('      ' + 清单.length + ' 个文件与仓库逐字节一致')
跑(process.execPath, [join(根, 'tools', 'verify-host.mjs')], { cwd: 根 })

// 旧补丁留在磁盘上但不再生效，标一下免得以后误用
const 旧补丁 = join(profile, 'patches', `${包名}@${包.version}.patch`)
if (existsSync(旧补丁) && !existsSync(旧补丁 + '.obsolete')) {
  writeFileSync(旧补丁 + '.obsolete', '已改用 vendor tgz，补丁不再参与安装；留着只为查历史。\n', 'utf8')
  console.log('      旧补丁已标记 .obsolete：' + 旧补丁)
}

console.log('\n好了：' + 包文件名)
console.log('现在可以打开 DSH。以后改完 lib/，再跑一次这个脚本 + 重启 DSH 才生效。')
