#!/usr/bin/env node
/**
 * Builds products.json for Babysteg's Smart kjøp: each independently tested product (tests.json) together with
 * the shops that sell it right now – picture, price, stock and a buy link – from affiliate product feeds
 * (feeds.json; the feed URLs come from GitHub secrets). Runs every morning in GitHub Actions
 * (.github/workflows/products.yml) and commits products.json to the Pages site; the app reads it from there.
 *
 *   node products/build.mjs                    → writes ./products.json (feeds whose secret is missing are skipped)
 *   node products/build.mjs --feed file.csv    → test the matching against a local feed file
 *
 * No dependencies: Node 20+ (fetch, zlib). Handles CSV/TSV/semicolon, XML (Google Shopping RSS and plain <product>
 * lists), JSON arrays, and gzip.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.PRODUCTS_OUT || join(here, '..', 'products.json');
const MAX_OFFERS = 4;
const CATS = ['mom', 'baby-sleep', 'baby-clothes', 'baby-care', 'baby-feeding', 'baby-transport', 'baby-play', 'hospital-bag', 'partner-bag'];

/* ───────── parsing ───────── */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a').replace(/[äá]/g, 'a').replace(/[öó]/g, 'o').replace(/[üú]/g, 'u').replace(/[éèê]/g, 'e')
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function parseCSV(text) {
  const first = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const unxml = (s) => s.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
export function parseXML(text) {
  const tag = ['item', 'product', 'entry', 'offer'].find((t) => new RegExp(`<${t}[\\s>]`, 'i').test(text));
  if (!tag) return [];
  const out = [];
  const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'gi');
  for (const m of text.matchAll(re)) {
    const rec = {};
    const inner = m[0].replace(/^<[^>]*>/, '').replace(/<\/[^>]*>$/, '');
    for (const f of inner.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
      const k = f[1].toLowerCase();
      if (!(k in rec)) rec[k] = unxml(f[2]);
    }
    out.push(rec);
  }
  return out;
}

export function parseFeed(buf, format = 'auto') {
  let b = buf;
  if (b[0] === 0x1f && b[1] === 0x8b) b = gunzipSync(b);
  const text = b.toString('utf8');
  const head = text.trimStart().slice(0, 1);
  if (format === 'json' || (format === 'auto' && (head === '[' || head === '{'))) {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : j.products || j.items || j.data || [];
    return arr.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')])));
  }
  if (format === 'xml' || (format === 'auto' && head === '<')) return parseXML(text);
  return parseCSV(text);
}

/* Field names used by the common networks/formats, best first. */
const FIELDS = {
  name: ['product_name', 'productname', 'name', 'title', 'g:title', 'produktnavn'],
  brand: ['brand_name', 'brand', 'g:brand', 'manufacturer', 'merke'],
  price: ['search_price', 'sale_price', 'g:sale_price', 'price', 'g:price', 'display_price', 'pris', 'store_price'],
  image: ['merchant_image_url', 'aw_image_url', 'large_image', 'imageurl', 'image_url', 'image_link', 'g:image_link', 'image', 'bilde'],
  link: ['aw_deep_link', 'trackingurl', 'tracking_url', 'deeplink', 'deep_link', 'affiliate_link', 'link', 'g:link', 'producturl', 'product_url', 'url'],
  stock: ['in_stock', 'instock', 'availability', 'g:availability', 'stock_status', 'lagerstatus'],
  ean: ['ean', 'gtin', 'g:gtin', 'ean13'],
};
const pick = (r, list, override) => { for (const k of [override, ...list].filter(Boolean)) if (r[k]) return r[k]; return ''; };
export function priceOf(s) {
  const m = String(s).replace(/\s/g, '').replace(/(NOK|kr|,-)/gi, '').match(/\d+(?:[.,]\d+)*/);
  if (!m) return 0;
  let n = m[0];
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.'); else n = n.replace(/,/g, '');
  const v = parseFloat(n);
  return Number.isFinite(v) && v > 0 && v < 200000 ? Math.round(v) : 0;
}
const inStock = (s) => (s === '' ? true : /^(1|true|yes|ja|in ?stock|på lager|pa lager|instock|available)$/i.test(String(s).trim()));
const https = (u) => (/^https:\/\/[^\s"'<>]{4,600}$/.test(u) ? u : '');

export function rows2offers(rows, feed) {
  const f = feed.fields || {};
  return rows.map((r) => ({
    name: pick(r, FIELDS.name, f.name), brand: pick(r, FIELDS.brand, f.brand), price: priceOf(pick(r, FIELDS.price, f.price)),
    image: https(pick(r, FIELDS.image, f.image)), url: https(pick(r, FIELDS.link, f.link)), inStock: inStock(pick(r, FIELDS.stock, f.stock)),
    ean: pick(r, FIELDS.ean, f.ean), store: feed.store, aff: true,
  })).filter((o) => o.name && o.url && o.price);
}

/* ───────── matching ───────── */
export function matches(test, offer) {
  const words = ` ${norm(`${offer.brand} ${offer.name}`)} `;
  const has = (w) => words.includes(` ${norm(w)} `);
  if ((test.exclude || []).some(has)) return false;
  return (test.match || []).some((alt) => alt.every(has));
}

export function build(tests, offers, now = new Date()) {
  const products = tests.filter((t) => t.id && t.name && CATS.includes(t.category)).map((t) => {
    // never send people to buy a product a test failed
    const hits = t.rank === 'warning' ? [] : offers.filter((o) => matches(t, o));
    // cheapest offer per shop, in stock first
    const byStore = new Map();
    for (const o of hits.sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price)) if (!byStore.has(o.store)) byStore.set(o.store, o);
    const best = [...byStore.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.price - b.price).slice(0, MAX_OFFERS);
    return {
      id: t.id, category: t.category, items: t.items || [], name: t.name, brand: t.brand || '', kind: t.kind,
      test: { source: t.source, url: t.url, date: t.date, score: t.score, verdict: t.verdict, rank: t.rank || 'top' },
      image: best.find((o) => o.image)?.image || '',
      offers: best.map((o) => ({ store: o.store, price: o.price, url: o.url, inStock: o.inStock, aff: !!o.aff })),
      priceFrom: best.length ? Math.min(...(best.some((o) => o.inStock) ? best.filter((o) => o.inStock) : best).map((o) => o.price)) : undefined,
    };
  });
  return { v: 1, updated: now.toISOString(), products };
}

/* ───────── main ───────── */
async function main() {
  const tests = JSON.parse(readFileSync(join(here, 'tests.json'), 'utf8')).tests;
  const feeds = JSON.parse(readFileSync(join(here, 'feeds.json'), 'utf8')).feeds;
  const offers = [];
  const local = process.argv.indexOf('--feed');
  if (local > 0) {
    offers.push(...rows2offers(parseFeed(readFileSync(process.argv[local + 1])), { store: 'Lokal fil' }));
  } else {
    for (const feed of feeds) {
      const url = process.env[feed.url_secret || ''];
      if (!url) { console.log(`· ${feed.id}: no secret ${feed.url_secret} – skipped`); continue; }
      try {
        const r = await fetch(url, { headers: { 'user-agent': 'BabystegProducts/1.0 (+https://alishahab92.github.io/babysteg/)' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = parseFeed(Buffer.from(await r.arrayBuffer()), feed.format || 'auto');
        const o = rows2offers(rows, feed);
        offers.push(...o);
        console.log(`· ${feed.id}: ${rows.length} rows, ${o.length} usable`);
      } catch (e) { console.log(`· ${feed.id}: failed (${e.message}) – skipped`); }
    }
  }
  const out = build(tests, offers);
  // keep the old date when nothing changed, so the workflow does not commit every day for nothing
  try { const old = JSON.parse(readFileSync(OUT, 'utf8')); if (JSON.stringify(old.products) === JSON.stringify(out.products)) out.updated = old.updated; } catch { /* first run */ }
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`${out.products.length} tested products, ${out.products.filter((p) => p.offers.length).length} with shop offers → ${OUT}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e); process.exit(1); });
