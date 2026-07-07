#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs")
const http = require("node:http")
const net = require("node:net")
const path = require("node:path")
const { spawn } = require("node:child_process")
const ts = require("typescript")
const { chromium } = require("playwright")

const repoRoot = path.resolve(__dirname, "../..")
const outputRoot = path.join(repoRoot, ".ux-output")

require.extensions[".ts"] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8")
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      strict: true,
    },
    fileName: filename,
  })
  module._compile(output.outputText, filename)
}

const { flows } = require("./flows")
const { installNetworkFixtures } = require("./fixtures/routes")

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "step"
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function readAllowlist() {
  const allowlistPath = path.join(__dirname, "console-allowlist.txt")
  if (!fs.existsSync(allowlistPath)) return []
  return fs
    .readFileSync(allowlistPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new RegExp(line))
}

function discoverExecutablePath() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_EXECUTABLE_PATH
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ]

  return candidates.find((candidate) => fs.existsSync(candidate))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolve()
          return
        }
        retry()
      })
      req.on("error", retry)
      req.setTimeout(2_000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for ${url}`))
        return
      }
      setTimeout(attempt, 500)
    }
    attempt()
  })
}

async function startDevServerIfNeeded() {
  if (process.env.BASE_URL) {
    return { baseUrl: process.env.BASE_URL.replace(/\/$/, ""), stop: async () => {} }
  }

  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const logPath = path.join(outputRoot, "next-dev.log")
  const log = fs.createWriteStream(logPath, { flags: "a" })
  const child = spawn("npm", ["run", "dev", "--", "--port", String(port)], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.pipe(log)
  child.stderr.pipe(log)

  await waitForHttp(baseUrl, 60_000)

  return {
    baseUrl,
    stop: async () => {
      if (child.exitCode !== null) return
      child.kill("SIGTERM")
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          resolve()
        }, 5_000)
        child.once("exit", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

function selectFlows(args) {
  if (args.length === 0 || args.includes("all")) return flows
  const selected = []
  for (const arg of args) {
    const found = flows.find((flow) => flow.name === arg || (flow.aliases || []).includes(arg))
    if (!found) {
      throw new Error(`Unknown UX flow "${arg}". Available: ${flows.map((flow) => [flow.name, ...(flow.aliases || [])].join(" / ")).join(", ")}`)
    }
    selected.push(found)
  }
  return selected
}

async function writeContactSheet(results) {
  const cards = results
    .map((result) => {
      const shots = result.screenshots
        .map((shot) => {
          const rel = path.relative(outputRoot, shot.path).split(path.sep).join("/")
          return `<figure><img src="${escapeHtml(rel)}" alt="${escapeHtml(result.flow)} ${escapeHtml(shot.name)}"><figcaption>${escapeHtml(shot.name)}</figcaption></figure>`
        })
        .join("")
      const pending = result.pendingAssertions
        .map((item) => `<li><strong>${escapeHtml(item.status)}</strong>: ${escapeHtml(item.name)} - ${escapeHtml(item.expected)}</li>`)
        .join("")
      const errors = result.consoleErrors.length
        ? `<pre>${escapeHtml(result.consoleErrors.join("\n\n"))}</pre>`
        : "<p>No console errors.</p>"
      return `<section class="flow ${result.ok ? "ok" : "fail"}">
        <h2>${escapeHtml(result.flow)} <span>${result.ok ? "green" : "failed"}</span></h2>
        <p>${escapeHtml(result.description)}</p>
        ${pending ? `<h3>Spec-pending assertions</h3><ul>${pending}</ul>` : ""}
        <h3>Screenshots</h3><div class="shots">${shots}</div>
        <h3>Console</h3>${errors}
      </section>`
    })
    .join("")

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Interlace UX Harness Contact Sheet</title>
<style>
body{margin:0;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f4ef;color:#211f1a}
header{padding:24px 28px;border-bottom:1px solid #d9d2c4;background:#fffaf0}
h1{margin:0 0 6px;font-size:24px}
main{padding:20px;display:grid;gap:20px}
.flow{background:#fff;border:1px solid #d8d2c6;border-left:4px solid #7f8f6a;border-radius:8px;padding:16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.flow.fail{border-left-color:#a5483b}
h2{margin:0 0 4px;font-size:18px;display:flex;gap:8px;align-items:center}
h2 span{font-size:11px;text-transform:uppercase;letter-spacing:.08em;background:#eef3e9;color:#536344;padding:2px 7px;border-radius:999px}
.fail h2 span{background:#f7e9e6;color:#8b3429}
h3{margin:18px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#6f685f}
ul{margin:0;padding-left:18px}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
figure{margin:0;border:1px solid #ddd7cc;border-radius:6px;overflow:hidden;background:#fbfaf7}
img{display:block;width:100%;height:auto}
figcaption{padding:8px 10px;font-size:12px;color:#5d574f;border-top:1px solid #e4ded3}
pre{white-space:pre-wrap;background:#211f1a;color:#f8f3e8;border-radius:6px;padding:10px;overflow:auto}
</style>
</head>
<body>
<header>
<h1>Interlace UX Harness Contact Sheet</h1>
<div>${new Date().toISOString()}</div>
</header>
<main>${cards}</main>
</body>
</html>`
  fs.writeFileSync(path.join(outputRoot, "index.html"), html)
}

async function runFlow(browser, baseUrl, flow, allowlist) {
  const flowDir = path.join(outputRoot, flow.name)
  fs.mkdirSync(flowDir, { recursive: true })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
  })
  await installNetworkFixtures(context)
  const page = await context.newPage()
  const consoleErrors = []
  const pendingAssertions = []
  const screenshots = []

  function recordConsole(kind, message) {
    const line = `[${kind}] ${message}`
    if (allowlist.some((regex) => regex.test(line))) return
    consoleErrors.push(line)
  }

  page.on("console", (msg) => {
    if (msg.type() === "error") recordConsole("console.error", msg.text())
  })
  page.on("pageerror", (error) => recordConsole("pageerror", error.stack || error.message))

  const ctx = {
    page,
    baseUrl,
    flowName: flow.name,
    pendingAssertions,
    markSpecPending: async (name, expected, probe) => {
      let present = false
      try {
        present = await probe()
      } catch {
        present = false
      }
      pendingAssertions.push({
        flow: flow.name,
        name,
        expected,
        status: present ? "present" : "pending",
      })
    },
  }

  let ok = true
  let failure = null
  try {
    for (let index = 0; index < flow.steps.length; index += 1) {
      const step = flow.steps[index]
      await step.run(ctx)
      const shotPath = path.join(flowDir, `${String(index + 1).padStart(2, "0")}-${slug(step.name)}.png`)
      await page.screenshot({ path: shotPath, fullPage: true })
      screenshots.push({ name: step.name, path: shotPath })
    }
  } catch (error) {
    ok = false
    failure = error instanceof Error ? error.stack || error.message : String(error)
    const shotPath = path.join(flowDir, "failure.png")
    await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {})
    screenshots.push({ name: "failure", path: shotPath })
  }

  const consoleLogPath = path.join(flowDir, "console-errors.log")
  fs.writeFileSync(consoleLogPath, consoleErrors.join("\n\n"))

  await context.close()

  if (consoleErrors.length > 0) ok = false
  return {
    flow: flow.name,
    description: flow.description,
    ok,
    failure,
    consoleErrors,
    pendingAssertions,
    screenshots,
  }
}

async function main() {
  const args = process.argv.slice(2).filter(Boolean)
  const selectedFlows = selectFlows(args)
  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true })

  const server = await startDevServerIfNeeded()
  const allowlist = readAllowlist()
  let browser
  const executablePath = discoverExecutablePath()

  const results = []
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath,
    })

    for (const flow of selectedFlows) {
      process.stdout.write(`ux:${flow.name} ... `)
      const result = await runFlow(browser, server.baseUrl, flow, allowlist)
      results.push(result)
      process.stdout.write(result.ok ? "green\n" : "failed\n")
      if (result.failure) process.stderr.write(`${result.failure}\n`)
      if (result.consoleErrors.length) {
        process.stderr.write(`Console errors in ${flow.name}: ${result.consoleErrors.length}\n`)
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    await server.stop().catch(() => {})
    await writeContactSheet(results).catch((error) => {
      process.stderr.write(`Failed to write contact sheet: ${error.stack || error.message}\n`)
    })
  }

  const failed = results.filter((result) => !result.ok)
  const pendingCount = results.flatMap((result) => result.pendingAssertions).filter((item) => item.status === "pending").length
  process.stdout.write(`UX output: ${path.relative(repoRoot, path.join(outputRoot, "index.html"))}\n`)
  process.stdout.write(`Spec-pending assertions: ${pendingCount}\n`)
  if (failed.length > 0) {
    process.stderr.write(`Failed flows: ${failed.map((result) => result.flow).join(", ")}\n`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
