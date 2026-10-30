/**
 * make-patch.mjs —— 把仓库里的 lib 和上游原版对一遍，生成 pnpm 补丁
 *
 * 用法：
 *   node tools/make-patch.mjs            # 用 upstream/ 里最新的版本
 *   node tools/make-patch.mjs 1.1.2      # 指定版本
 *
 * 为什么要这一步：装机目录是 npm 包，升级/重装会整个换掉 ——
 * 本地改动必须留在 profile/patches 里，install 时自动打上，才算真的活下来。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const 包根 = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const 包名 = JSON.parse(readFileSync(join(包根, 'package.json'), 'utf8')).name
const 版本 = process.argv[2] || '1.1.2'
const 上游目录 = join(包根, 'upstream', 版本)
if (!existsSync(上游目录)) {
  console.log('没有 upstream/' + 版本 + '，先把原版放进去（lib/host.js、lib/client.js）')
  process.exit(1)
}

const 补丁目录 = process.env.DSH_HOME
  ? join(process.env.DSH_HOME, 'profiles', 'desktop', 'patches')
  : 'D:/DSH/profiles/desktop/patches'
mkdirSync(补丁目录, { recursive: true })

const 临时 = join(tmpdir(), 'qq-patch-' + Date.now())
mkdirSync(join(临时, 'old', 'lib'), { recursive: true })
mkdirSync(join(临时, 'new', 'lib'), { recursive: true })

const 文件们 = ['host.js', 'client.js']
for (const f of 文件们) {
  const 旧 = join(上游目录, f)
  if (!existsSync(旧)) continue
  cpSync(旧, join(临时, 'old', 'lib', f))
  const 新 = readFileSync(join(包根, 'lib', f), 'utf8').replace(/\r\n/g, '\n')
  writeFileSync(join(临时, 'new', 'lib', f), 新)
}

let diff = ''
try {
  diff = execFileSync('git', ['diff', '--no-index', 'old', 'new'], { cwd: 临时, encoding: 'utf8' })
} catch (e) {
  diff = String(e.stdout || '')
}
if (!diff.trim()) {
  console.log('和上游一模一样，没有补丁可生成')
  process.exit(0)
}

const 成品 = diff.replace(/a\/old\//g, 'a/').replace(/b\/new\//g, 'b/')

// 防呆：仓库自己的 lib 要是被「批量改写」盖回上游，这里会生成一个没有自动唤醒的空补丁，
// 一 install 就把装机目录也带坏。宁可拒绝写，也不能把好的补丁冲掉。
if (!process.argv.includes('--force')) {
  const 缺 = []
  if (!成品.includes('LOCAL-PATCH:自动唤醒 START')) 缺.push('LOCAL-PATCH:自动唤醒 块')
  if (!成品.includes("'sessionController'")) 缺.push('inject 里的 sessionController')
  if (缺.length) {
    console.error('补丁里缺：' + 缺.join('、') + ' —— 仓库 lib 可能被覆盖了，拒绝写入')
    console.error('先对照 git 历史 / patches 里的旧补丁把这两处补回来，确认后再跑；真要生成半成品加 --force')
    process.exit(2)
  }
}

const 目标 = join(补丁目录, 包名 + '@' + 版本 + '.patch')
const 仓库副本 = join(包根, 'patches', 包名 + '@' + 版本 + '.patch')
mkdirSync(join(包根, 'patches'), { recursive: true })
writeFileSync(目标, 成品, 'utf8')
writeFileSync(仓库副本, 成品, 'utf8')
rmSync(临时, { recursive: true, force: true })
console.log('补丁已写入', 目标, '（' + 成品.split('\n').length + ' 行）')
console.log('仓库留档', 仓库副本)
console.log('下一步：在 profile 里 pnpm install，然后 node tools/verify-host.mjs')
