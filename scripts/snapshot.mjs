// Daily price snapshot for OPTCG Collector. Run by the GitHub Action once a day (Node 20+, no dependencies).
//
// Saves today's prices into data/YYYY-MM.json:
//   usd: TCGplayer market price per printing, from optcgapi.com, keyed like the app ("OP-05/OP05-069_p1")
//   eur: Cardmarket trend price per product, from Cardmarket's public price guide, English versions only
//
// Monthly file format (compact on purpose):
//   { version: 1, keys: { usd: [key...], eur: [productId...] },
//     days: { "2026-10-31": { usd: [[index, cents], ...], eur: [[index, cents], ...] } } }
// The first day of a month lists every price; later days only list prices that changed.
// A price of -1 means the printing no longer has a price.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const DATA = join(import.meta.dirname, '..', 'data')
const OPTCG = 'https://optcgapi.com/api'
const CM = 'https://downloads.s3.cardmarket.com/productCatalog'
const NON_ENGLISH = /\((Non-English|Japanese|Asia Region Lega)/i

async function json(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'optcg-price-history (daily snapshot)' } })
    if (res.ok) return res.json()
    if (attempt === 3) throw new Error(`${url}: HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 5000 * attempt))
  }
}

const cents = (n) => (typeof n === 'number' && n > 0 ? Math.round(n * 100) : null)

async function usdPrices() {
  const out = new Map()
  for (const ep of ['allSetCards', 'allSTCards', 'allPromos']) {
    for (const r of await json(`${OPTCG}/${ep}/`)) {
      if (!r.card_set_id) continue
      const imageId = (r.card_image_id ?? r.card_set_id).trim().replace(/\.(jpg|png)$/i, '')
      const key = `${ep === 'allPromos' ? 'PROMO' : r.set_id}/${imageId}`
      const c = cents(r.market_price)
      if (c != null && !out.has(key)) out.set(key, c)
    }
  }
  return out
}

async function eurPrices() {
  const [sealed, guide] = await Promise.all([
    json(`${CM}/productList/products_nonsingles_18.json`),
    json(`${CM}/priceGuide/price_guide_18.json`)
  ])
  const singles = await json(`${CM}/productList/products_singles_18.json`)
  const nonEnglish = new Set(sealed.products.filter((p) => NON_ENGLISH.test(p.name)).map((p) => p.idExpansion))
  const english = new Set(singles.products.filter((p) => !nonEnglish.has(p.idExpansion)).map((p) => p.idProduct))
  const out = new Map()
  for (const g of guide.priceGuides) {
    if (!english.has(g.idProduct)) continue
    const c = cents(g.trend || g.avg7 || g.avg30 || g.low)
    if (c != null) out.set(String(g.idProduct), c)
  }
  return { prices: out, guideDate: guide.createdAt ?? null }
}

/** Latest known price per key in a month file (replaying the days in order). */
function currentPrices(file, kind) {
  const now = new Map()
  for (const date of Object.keys(file.days).sort()) {
    for (const [i, c] of file.days[date][kind] ?? []) now.set(file.keys[kind][i], c)
  }
  return now
}

function addDay(file, kind, prices, full) {
  const index = new Map(file.keys[kind].map((k, i) => [k, i]))
  const before = full ? new Map() : currentPrices(file, kind)
  const changes = []
  for (const [key, c] of prices) {
    if (!index.has(key)) {
      index.set(key, file.keys[kind].length)
      file.keys[kind].push(key)
    }
    if (before.get(key) !== c) changes.push([index.get(key), c])
  }
  for (const [key, c] of before) if (c !== -1 && !prices.has(key)) changes.push([index.get(key), -1])
  return changes
}

const today = new Date().toISOString().slice(0, 10)
const month = today.slice(0, 7)
const [usd, eur] = await Promise.all([usdPrices(), eurPrices()])
if (usd.size < 1000 || eur.prices.size < 1000) throw new Error(`Suspiciously few prices (usd ${usd.size}, eur ${eur.prices.size})`)

mkdirSync(DATA, { recursive: true })
const path = join(DATA, `${month}.json`)
const file = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, keys: { usd: [], eur: [] }, days: {} }
const full = Object.keys(file.days).filter((d) => d !== today).length === 0
delete file.days[today] // re-running the same day replaces it
file.days[today] = { usd: addDay(file, 'usd', usd, full), eur: addDay(file, 'eur', eur.prices, full) }
writeFileSync(path, JSON.stringify(file))

const indexPath = join(DATA, 'index.json')
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { months: [] }
index.months = [...new Set([...index.months, month])].sort()
index.lastDate = today
index.cardmarketGuideDate = eur.guideDate
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')

const d = file.days[today]
console.log(`${today}: usd ${usd.size} prices (${d.usd.length} stored), eur ${eur.prices.size} prices (${d.eur.length} stored)`)
