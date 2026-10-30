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
const 目标 = join(补丁目录, 'dsh-qq-bridge@' + 版本 + '.patch')
writeFileSync(目标, 成品, 'utf8')
rmSync(临时, { recursive: true, force: true })
console.log('补丁已写入', 目标, '（' + 成品.split('\n').length + ' 行）')
console.log('下一步：在 profile 里 pnpm install，然后 node tools/verify-host.mjs')
