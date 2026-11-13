// Teste de ponta a ponta do bug "botão Sync travado em Sincronizando…":
// sem conta Google conectada, o login abre o popup do GIS; aqui o popup é
// SIMULADO sendo fechado pelo usuário (error_callback 'popup_closed').
//
// Precisa do servidor Vite rodando (npm run dev):
//   node scripts/e2e-sync-cancel.mjs [url] [close|success]
//
// O script falha (exit 1) se o botão ficar travado ou se não aparecer o aviso
// de "login cancelado".
// Modo "success": o popup devolve um token falso — o botão também não pode
// ficar travado (a sync segue e falha na API do Drive, como esperado).
import { chromium } from 'playwright'

const URL = process.argv[2] ?? 'http://127.0.0.1:3000/'
const MODO = process.argv[3] ?? 'close'
const TIMEOUT_MS = 25_000

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

// Falso do Google Identity Services: o popup "abre" e é fechado pelo usuário.
await context.addInitScript((modo) => {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => {
          const client = {
            callback: cfg.callback,
            error_callback: cfg.error_callback,
            requestAccessToken() {
              setTimeout(() => {
                if (modo === 'success') {
                  const cb = client.callback || cfg.callback;
                  cb?.({ access_token: 'token-falso', expires_in: 3600 });
                } else {
                  const cb = client.error_callback || cfg.error_callback;
                  cb?.({ type: 'popup_closed' });
                }
              }, 300);
            },
          };
          return client;
        },
      },
    },
  };
}, MODO);

const page = await context.newPage()
const erros = []
page.on('pageerror', (e) => erros.push(String(e)))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
// sem conta Google conectada
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('header', { timeout: 15_000 })

const botao = page.locator('header button[title*="Google Drive"]')
await botao.waitFor({ timeout: 15_000 })
console.log('estado inicial do botão:', JSON.stringify((await botao.innerText()).trim()))

await botao.click()

// o botão NÃO pode ficar preso em "Sincronizando…"
const inicio = Date.now()
let texto = ''
while (Date.now() - inicio < TIMEOUT_MS) {
  texto = ((await botao.innerText()) || '').trim()
  if (!/Sincronizando/i.test(texto)) break
  await page.waitForTimeout(250)
}

const travado = /Sincronizando/i.test(texto)
console.log(`após ${Math.round((Date.now() - inicio) / 1000)}s o botão diz: ${JSON.stringify(texto)}`)

const corpo = await page.evaluate(() => document.body.innerText)
const aviso = /cancelado/i.test(corpo)
console.log('aviso de cancelamento na tela:', aviso ? 'SIM' : 'NÃO')

if (erros.length) console.log('erros de página:', erros)

await browser.close()

if (travado) {
  console.error('FALHOU: o botão ficou travado em "Sincronizando…"')
  process.exit(1)
}
if (MODO === 'close' && !aviso) {
  console.error('FALHOU: não apareceu o aviso de login cancelado')
  process.exit(1)
}
console.log('OK — o botão destravou' + (MODO === 'close' ? ' e o aviso apareceu.' : '.'))
