#!/usr/bin/env node
/**
 * download-weekly.js — KADEL
 * Descarga el reporte de excesos de velocidad de TrackGTS
 * para un rango exacto Lunes–Domingo usando las variables de entorno:
 *   TL_START     — "YYYY/MM/DD 00:00:00"
 *   TL_END       — "YYYY/MM/DD 23:59:59"
 *   TL_UNIT_IDS  — lista de unitIds separados por coma (ya excluye las
 *                  unidades fuera de monitoreo: LTTW96, TVKC50, PKGT50,
 *                  RHDZ45, SWFB15 — ver README para el mapeo patente→unitId)
 *
 * Clon de download-weekly.js (tracklink-santamarta), parametrizado por
 * cliente vía TL_UNIT_IDS en vez de hardcodear los unitIds en el código.
 */
'use strict';

const puppeteer = require('puppeteer');
const AdmZip    = require('adm-zip');
const fs        = require('fs');
const path      = require('path');

async function main() {
  const { TL_USER, TL_PASSWORD, TL_DOMAIN, TL_START, TL_END, TL_UNIT_IDS } = process.env;

  if (!TL_USER || !TL_PASSWORD || !TL_DOMAIN) {
    throw new Error('Faltan variables de entorno: TL_USER, TL_PASSWORD, TL_DOMAIN');
  }
  if (!TL_START || !TL_END) {
    throw new Error('Faltan variables TL_START y TL_END (calculadas por el step anterior)');
  }
  if (!TL_UNIT_IDS) {
    throw new Error('Falta TL_UNIT_IDS — lista de unitIds de KADEL (excluyendo LTTW96, TVKC50, PKGT50, RHDZ45, SWFB15). Ver README.md.');
  }

  console.log(`=== Download Weekly KADEL: ${TL_START} → ${TL_END} ===`);
  console.log(`Unidades incluidas: ${TL_UNIT_IDS}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);

    // ── 1. Login ──────────────────────────────────────────────────────────────
    const loginUrl = `https://${TL_DOMAIN}.trackgts.com/admin/login.html`;
    console.log(`[1] Login en: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: 'networkidle0', timeout: 60_000 });
    await page.waitForSelector('#username', { timeout: 30_000 });

    await page.evaluate(() => localStorage.setItem('sltLanguage', '0'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('#username', { timeout: 30_000 });

    await page.evaluate((user, password, domain) => {
      const K  = 'd5fg4df5sg4ds5fg';
      const S  = { a:'1', b:'2', c:'3', d:'4', e:'5', f:'6', g:'7', h:'8', i:'9' };
      const k  = CryptoJS.enc.Utf8.parse(K);
      const iv = CryptoJS.enc.Utf8.parse(K);
      const a  = [];
      for (const c of password) {
        a.push(
          CryptoJS.AES.encrypt(
            CryptoJS.enc.Utf8.parse(S[c] || c), k,
            { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
          ).toString()
        );
      }
      ARRAYPSWD = a;
      document.getElementById('username').value = user;
      document.getElementById('domain').value   = domain;
      document.getElementById('password').value = '********';
      LOGININPROCESS = false;
      onLoginOn();
    }, TL_USER, TL_PASSWORD, TL_DOMAIN);

    console.log('[2] Esperando sesión (15s)...');
    await new Promise(r => setTimeout(r, 15_000));
    console.log(`[2] URL actual: ${page.url()}`);

    // ── 2. Descargar reporte para el rango exacto ─────────────────────────────
    console.log(`[3] Descargando: ${TL_START} → ${TL_END}`);
    const result = await page.evaluate(async (startDate, endDate, unitIds) => {
      const h    = JSONUSER.hash;
      const body = JSON.stringify({
        startDate,
        endDate,
        unitIds,
        reportName:          'INFORME EXCESOS DE VELOCIDAD',
        parameters:          'undefined',
        userTimeZone:        -4,
        userfuelMeasure:     0,
        userMeasureDistance: 0,
        speed:               NaN,
        language:            0,
      });
      const res = await fetch(
        `https://www.trackgts.com:82/api/reportTravel/GetSpeedingReportByUnitsPagesZip/25/${h}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json;charset=UTF-8' }, body }
      );
      const json = await res.json();
      if (!json.FileContents)
        return { error: `Sin FileContents: ${JSON.stringify(json).slice(0, 300)}` };
      return { fileContents: json.FileContents };
    }, TL_START, TL_END, TL_UNIT_IDS);

    if (result.error) throw new Error(result.error);

    // ── 3. Extraer .xlsx del ZIP ───────────────────────────────────────────────
    const zip  = new AdmZip(Buffer.from(result.fileContents, 'base64'));
    const xlsx = zip.getEntries().find(e => e.entryName.toLowerCase().endsWith('.xlsx'));
    if (!xlsx) throw new Error(`Sin .xlsx en ZIP. Entradas: ${zip.getEntries().map(e => e.entryName).join(', ')}`);

    const dest = path.join(process.cwd(), 'latest.xlsx');
    fs.writeFileSync(dest, xlsx.getData());
    console.log(`[4] Guardado como: ${dest}`);
    console.log('=== COMPLETADO ===');

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
