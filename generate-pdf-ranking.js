#!/usr/bin/env node
'use strict';
/**
 * generate-pdf-ranking.js — KADEL
 * "Ranking de uso fuera de horario", basado en eventos de encendido
 * (download-weekly-events.js). Mismo estilo visual (5 páginas, paleta navy)
 * que generate-pdf.js (Excesos de Velocidad) — el cliente pidió "formato
 * estándar Tracklink" para este informe, que aún no confirmó cuál es;
 * mientras tanto se usa la misma línea gráfica ya validada con KADEL.
 *
 * Regla de "fuera de horario" (confirmada por Rafael Nieto, Track Link,
 * 2026-08-01): lunes a viernes 19:00–07:00, sábado y domingo todo el día.
 * La clasificación ya viene calculada en el Excel (columna "Fuera de
 * Horario") por download-weekly-events.js — este script no la recalcula.
 *
 * Variables de entorno esperadas:
 *   REPORT_START — "YYYY-MM-DD"
 *   REPORT_END   — "YYYY-MM-DD"
 *
 * Entrada:  latest-events.xlsx (hoja "Detalle")
 * Salida:   ranking-fuera-horario.pdf
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');

const CONFIG = {
  siteName:      'KADEL',
  footerLabel:   'KADEL',
  logoUrl:       null, // mismo wordmark de texto que Excesos hasta tener el logo real
  colorDark:     '#1a2744',
  colorDarker:   '#0f1c33',
  colorMid:      '#22406f',
  colorRankFrom: '#1e2f52',
  colorRankTo:   '#94a3b8',
  colorAccent:   '#1a2744',
};

const EXCEL_FILE = path.join(process.cwd(), 'latest-events.xlsx');
const OUTPUT_PDF = path.join(process.cwd(), 'ranking-fuera-horario.pdf');

const DIAS_ES      = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_ES_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_ES     = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const PAGE_W = 1280;
const PAGE_H = 720;

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startDate = process.env.REPORT_START;
  const endDate   = process.env.REPORT_END;
  if (!startDate || !endDate) throw new Error('Faltan variables REPORT_START y REPORT_END.');

  console.log(`[pdf-ranking] Generando ranking fuera de horario: ${startDate} → ${endDate}`);
  if (!fs.existsSync(EXCEL_FILE)) throw new Error(`No se encontró: ${EXCEL_FILE}`);

  const rows = parseAndFilter(fs.readFileSync(EXCEL_FILE), startDate, endDate);
  console.log(`[pdf-ranking] Encendidos en el período: ${rows.length} (fuera de horario: ${rows.filter(r => r.fuera).length})`);

  const stats = computeStats(rows, startDate, endDate);
  const html  = generateHTML(stats);

  fs.writeFileSync(path.join(process.cwd(), 'ranking-preview.html'), html);

  const puppeteer = require('puppeteer');
  console.log('[pdf-ranking] Iniciando Puppeteer...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: PAGE_W, height: PAGE_H });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 40000 });
    const pdf = await page.pdf({
      width: `${PAGE_W}px`, height: `${PAGE_H}px`,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    fs.writeFileSync(OUTPUT_PDF, pdf);
    console.log(`[pdf-ranking] ✅ PDF guardado: ${OUTPUT_PDF} (${pdf.length} bytes)`);
  } finally {
    await browser.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSEO
// ─────────────────────────────────────────────────────────────────────────────
function parseAndFilter(buffer, startDate, endDate) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets['Detalle'] || wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { raw: false });

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const startTs = new Date(sy, sm - 1, sd, 0, 0, 0).getTime();
  const endTs   = new Date(ey, em - 1, ed, 23, 59, 59).getTime();

  const rows = [];
  for (const r of data) {
    const alias = String(r['Unidad'] || '').trim();
    const fechaStr = String(r['Fecha y Hora'] || '').trim();
    if (!alias || !fechaStr) continue;

    const m = fechaStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const fecha = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const ts = fecha.getTime();
    if (ts < startTs || ts > endTs) continue;

    rows.push({
      alias,
      fecha,
      fuera: String(r['Fuera de Horario'] || '').trim().toUpperCase() === 'SI',
    });
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function pad(n) { return String(n).padStart(2, '0'); }

function splitAlias(alias) {
  const parts = String(alias || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { model: '', code: '' };
  // El código de unidad en KADEL suele ser el segmento con guión (ej. "TDKV-89")
  const codeIdx = parts.findIndex(p => /-/.test(p));
  if (codeIdx >= 0) return { model: parts.slice(0, codeIdx).join(' '), code: parts[codeIdx] };
  return { model: parts.slice(0, -1).join(' '), code: parts[parts.length - 1] };
}

function fmtPct(v) { return Number(v).toFixed(1).replace('.', ','); }

function formatVerboseRange(startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (sy === ey && sm === em) return `${sd} al ${ed} de ${MESES_ES[em - 1]} de ${ey}`;
  if (sy === ey) return `${sd} de ${MESES_ES[sm - 1]} – ${ed} de ${MESES_ES[em - 1]} de ${ey}`;
  return `${sd} de ${MESES_ES[sm - 1]} de ${sy} – ${ed} de ${MESES_ES[em - 1]} de ${ey}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────────────────────────────────────
// ESTADÍSTICAS
// ─────────────────────────────────────────────────────────────────────────────
function computeStats(rows, startDate, endDate) {
  const totalEncendidos = rows.length;
  const fuera = rows.filter(r => r.fuera);
  const totalFuera = fuera.length;

  const porUnidad = {};
  const byDayMap  = {};
  const byHourArr = new Array(24).fill(0);

  fuera.forEach(r => {
    if (!porUnidad[r.alias]) porUnidad[r.alias] = { count: 0 };
    porUnidad[r.alias].count++;
    const d = r.fecha;
    const dayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    byDayMap[dayKey] = (byDayMap[dayKey] || 0) + 1;
    byHourArr[d.getHours()]++;
  });

  const unidadesArr = Object.entries(porUnidad)
    .map(([alias, data]) => {
      const { model, code } = splitAlias(alias);
      const totalUnidad = rows.filter(r => r.alias === alias).length;
      return {
        alias, unitCode: code, unitModel: model,
        count: data.count,
        totalUnidad,
        pctPropio: totalUnidad ? (data.count / totalUnidad) * 100 : 0,
        pct: totalFuera ? (data.count / totalFuera) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  const [sy, sm, sd] = startDate.split('-').map(Number);
  const dayCount = Math.round((new Date(endDate).setHours(12) - new Date(startDate).setHours(12)) / 86400000) + 1;
  const weekDays = Array.from({ length: Math.max(dayCount, 1) }, (_, i) => {
    const d   = new Date(sy, sm - 1, sd + i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { key, date: d, label: `${DIAS_ES[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`, count: byDayMap[key] || 0 };
  });
  const sortedDays = weekDays.slice().sort((a, b) => b.count - a.count);
  const peakDay = sortedDays[0] || { label: '—', count: 0, key: '', date: null };

  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: pad(h), fullLabel: `${pad(h)}:00–${pad(h)}:59`, count: byHourArr[h] }));
  const topHours = hours.slice().sort((a, b) => b.count - a.count);
  const peakHour = topHours[0] || { hour: 0, fullLabel: '—', count: 0 };

  const top3Count = unidadesArr.slice(0, 3).reduce((s, u) => s + u.count, 0);
  const top3Pct   = totalFuera ? (top3Count / totalFuera) * 100 : 0;

  const [ey, em, ed] = endDate.split('-').map(Number);
  return {
    startDate, endDate,
    startDisplay: `${pad(sd)}/${pad(sm)}/${sy}`,
    endDisplay:   `${pad(ed)}/${pad(em)}/${ey}`,
    rangeVerbose: formatVerboseRange(startDate, endDate),
    totalEncendidos, totalFuera,
    pctFuera: totalEncendidos ? (totalFuera / totalEncendidos) * 100 : 0,
    unidadesArr,
    weekDays, sortedDays, peakDay,
    hours, topHours, peakHour,
    top3Count, top3Pct,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GRÁFICOS SVG (mismas funciones que generate-pdf.js)
// ─────────────────────────────────────────────────────────────────────────────
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; }
function toHex(r, g, b) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function lerpColor(c1, c2, t) {
  const p1 = hexToRgb(c1), p2 = hexToRgb(c2);
  return toHex(p1.r + (p2.r - p1.r) * t, p1.g + (p2.g - p1.g) * t, p1.b + (p2.b - p1.b) * t);
}
function lighten(hex, amt) { return lerpColor(hex, '#ffffff', amt); }
function darken(hex, amt)  { return lerpColor(hex, '#000000', amt); }

function rankColor(rank, n) {
  if (n <= 1) return CONFIG.colorDark;
  return lerpColor(CONFIG.colorRankFrom, CONFIG.colorRankTo, rank / (n - 1));
}
function valueRankColors(values) {
  const idx = values.map((v, i) => i).sort((a, b) => values[b] - values[a]);
  const colors = new Array(values.length);
  idx.forEach((origIdx, rank) => { colors[origIdx] = rankColor(rank, values.length); });
  return colors;
}
function niceTicks(maxVal, targetCount) {
  maxVal = Math.max(maxVal, 1);
  const rawStep = maxVal / targetCount;
  const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let step;
  if (norm < 1.5) step = 1 * mag; else if (norm < 3) step = 2 * mag; else if (norm < 7) step = 5 * mag; else step = 10 * mag;
  const max = Math.ceil(maxVal / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  return { ticks, max };
}

function barDefs(idPrefix, colors) {
  const grads = colors.map((c, i) => `
    <linearGradient id="${idPrefix}-g${i}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${lighten(c, 0.32)}"/>
      <stop offset="55%" stop-color="${c}"/>
      <stop offset="100%" stop-color="${darken(c, 0.08)}"/>
    </linearGradient>`).join('');
  const shadow = `
    <filter id="${idPrefix}-shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="2" stdDeviation="2.2" flood-color="#1e293b" flood-opacity="0.22"/>
    </filter>`;
  return `<defs>${grads}${shadow}</defs>`;
}

function horizontalBarChart(items, { width, height, labelWidth = 205, xAxisLabel = '', yAxisLabel = '', idPrefix = 'hbar' }) {
  const values = items.map((i) => i.value);
  const colors = valueRankColors(values);
  const { ticks, max } = niceTicks(Math.max(...values, 1), 6);
  const topLabelPad = yAxisLabel ? 22 : 0;
  const plotX = labelWidth, plotW = width - labelWidth - 46;
  const topPad = 6 + topLabelPad, bottomPad = xAxisLabel ? 46 : 26, plotH = height - topPad - bottomPad;
  const rowH = plotH / items.length;
  const barH = Math.min(27, rowH * 0.62);

  let grid = '', axis = '', bars = '';
  ticks.forEach((t) => {
    const x = plotX + (t / max) * plotW;
    grid += `<line x1="${x.toFixed(1)}" y1="${topPad}" x2="${x.toFixed(1)}" y2="${topPad + plotH}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
    axis += `<text x="${x.toFixed(1)}" y="${topPad + plotH + 21}" font-size="13" fill="#94a3b8" text-anchor="middle" font-family="Inter,sans-serif">${t}</text>`;
  });
  items.forEach((it, i) => {
    const y = topPad + i * rowH + (rowH - barH) / 2;
    const w = Math.max((it.value / max) * plotW, 2);
    bars += `<text x="${plotX - 12}" y="${(y + barH / 2 + 5).toFixed(1)}" font-size="14.5" font-weight="700" fill="#334155" text-anchor="end" font-family="Inter,sans-serif">${escapeHtml(it.label)}</text>`;
    bars += `<rect x="${plotX}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${barH}" rx="${(barH / 2).toFixed(1)}" fill="url(#${idPrefix}-g${i})" filter="url(#${idPrefix}-shadow)"/>`;
    bars += `<text x="${(plotX + w + 9).toFixed(1)}" y="${(y + barH / 2 + 5).toFixed(1)}" font-size="15" font-weight="800" fill="#0f172a" font-family="Inter,sans-serif">${it.value}</text>`;
  });
  const labels = `${yAxisLabel ? `<text x="0" y="14" font-size="13" font-weight="700" fill="#64748b" font-family="Inter,sans-serif">${escapeHtml(yAxisLabel)}</text>` : ''}${xAxisLabel ? `<text x="${(plotX + plotW / 2).toFixed(1)}" y="${height - 6}" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(xAxisLabel)}</text>` : ''}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${barDefs(idPrefix, colors)}${grid}${bars}${axis}${labels}</svg>`;
}

function verticalBarChart(items, { width, height, showValueLabels = false, peakBadge = null, xAxisLabel = '', yAxisLabel = '', idPrefix = 'vbar' }) {
  const values = items.map((i) => i.value);
  const colors = valueRankColors(values);
  const { ticks, max } = niceTicks(Math.max(...values, 1), 5);
  const topBase = peakBadge ? 46 : (showValueLabels ? 34 : 14);
  const leftPad = 38, rightPad = 8, topPad = topBase + (yAxisLabel ? 20 : 0), bottomPad = xAxisLabel ? 46 : 30;
  const plotW = width - leftPad - rightPad, plotH = height - topPad - bottomPad;
  const n = items.length, slot = plotW / n;
  const barW = Math.min(slot * 0.62, 50);

  let grid = '', axisY = '', axisX = '', bars = '', peakLine = '';
  ticks.forEach((t) => {
    const y = topPad + plotH - (t / max) * plotH;
    grid  += `<line x1="${leftPad}" y1="${y.toFixed(1)}" x2="${leftPad + plotW}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3"/>`;
    axisY += `<text x="${leftPad - 8}" y="${(y + 3.5).toFixed(1)}" font-size="12.5" fill="#94a3b8" text-anchor="end" font-family="Inter,sans-serif">${t}</text>`;
  });

  let peakIdx = 0;
  items.forEach((it, i) => { if (it.value > items[peakIdx].value) peakIdx = i; });

  items.forEach((it, i) => {
    const x = leftPad + i * slot + (slot - barW) / 2;
    const h = (it.value / max) * plotH;
    const y = topPad + plotH - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" rx="6" fill="url(#${idPrefix}-g${i})" filter="url(#${idPrefix}-shadow)"/>`;
    if (showValueLabels) {
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" font-size="15" font-weight="800" fill="#0f172a" text-anchor="middle" font-family="Inter,sans-serif">${it.value}</text>`;
    }
    axisX += `<text x="${(x + barW / 2).toFixed(1)}" y="${(topPad + plotH + 20).toFixed(1)}" font-size="12" fill="#94a3b8" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(it.label)}</text>`;
  });

  if (peakBadge) {
    const py = topPad + plotH - (items[peakIdx].value / max) * plotH;
    peakLine += `<line x1="${leftPad}" y1="${py.toFixed(1)}" x2="${leftPad + plotW}" y2="${py.toFixed(1)}" stroke="${CONFIG.colorAccent}" stroke-width="1.4" stroke-dasharray="4,3" opacity="0.6"/>`;
    const bw = 142, bh = 28, bx = leftPad, by = Math.max(py - bh - 6, 2);
    peakLine += `<rect x="${bx}" y="${by.toFixed(1)}" width="${bw}" height="${bh}" rx="6" fill="${CONFIG.colorDark}"/>`;
    peakLine += `<text x="${bx + bw / 2}" y="${(by + bh / 2 + 4.5).toFixed(1)}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(peakBadge)}</text>`;
  }

  const labels = `${yAxisLabel ? `<text x="${leftPad}" y="14" font-size="13" font-weight="700" fill="#64748b" font-family="Inter,sans-serif">${escapeHtml(yAxisLabel)}</text>` : ''}${xAxisLabel ? `<text x="${(leftPad + plotW / 2).toFixed(1)}" y="${height - 6}" font-size="13" font-weight="700" fill="#64748b" text-anchor="middle" font-family="Inter,sans-serif">${escapeHtml(xAxisLabel)}</text>` : ''}`;
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${barDefs(idPrefix, colors)}${grid}${bars}${axisX}${axisY}${peakLine}${labels}</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — 5 páginas 1280×720 (16:9)
// ─────────────────────────────────────────────────────────────────────────────
function generateHTML(s) {
  const footer = `<div class="tl-footer">Tracklink Chile Fleet Dashboard · ${CONFIG.footerLabel} · ${s.startDisplay} — ${s.endDisplay}</div>`;

  const top12 = s.unidadesArr.slice(0, 12);
  const unidadChartItems = top12.map((u) => ({ label: u.unitCode || u.alias, value: u.count }));
  const unidadChartSvg   = horizontalBarChart(unidadChartItems, { width: 620, height: 400, xAxisLabel: 'Encendidos Fuera de Horario', yAxisLabel: 'Unidad', idPrefix: 'chartUnidad' });

  const tableRows = top12.map((u) => `<tr>
      <td>${escapeHtml(u.alias)}</td>
      <td class="num">${u.count}</td>
      <td class="num">${u.totalUnidad}</td>
      <td class="num">${fmtPct(u.pctPropio)}%</td>
    </tr>`).join('');

  const condN = top12.length || 1;
  let condPadY, condFontSize;
  if (condN <= 8)       { condPadY = 10; condFontSize = 15.5; }
  else if (condN <= 11) { condPadY = 6;  condFontSize = 14;   }
  else                  { condPadY = 4;  condFontSize = 12.5; }

  const top3Names = s.unidadesArr.slice(0, 3).map((u) => u.unitCode || u.alias);
  const top3Text  = top3Names.length >= 2
    ? `${top3Names.slice(0, -1).join(', ')} y ${top3Names[top3Names.length - 1]}`
    : (top3Names[0] || '—');

  const hourChartItems = s.hours.map((h) => ({ label: h.label, value: h.count }));
  const hourChartSvg   = verticalBarChart(hourChartItems, { width: 1168, height: 380, peakBadge: `Máximo: ${s.peakHour.count}`, xAxisLabel: 'Franja Horaria', yAxisLabel: 'Encendidos Fuera de Horario', idPrefix: 'chartHour' });

  const dayChartItems = s.sortedDays.map((d) => ({ label: d.label, value: d.count }));
  const dayChartSvg    = verticalBarChart(dayChartItems, { width: 600, height: 360, showValueLabels: true, xAxisLabel: 'Fecha', yAxisLabel: 'Encendidos Fuera de Horario', idPrefix: 'chartDay' });

  const criticalDayNames = s.sortedDays.filter(d => d.date).slice(0, 2).map((d) => DIAS_ES_FULL[d.date.getDay()]);
  const criticalDayText  = criticalDayNames.length >= 2 ? `${criticalDayNames[0]} y ${criticalDayNames[1]}` : (criticalDayNames[0] || '—');

  const eyebrow = CONFIG.logoUrl
    ? `<img src="${CONFIG.logoUrl}" style="height:140px;width:auto;object-fit:contain;" alt="">`
    : `<div style="font-size:32px;font-weight:800;letter-spacing:.2em;color:#1a202c;">${escapeHtml(CONFIG.siteName)}</div>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  @page{size:${PAGE_W}px ${PAGE_H}px;margin:0;}
  html,body{height:100%;}
  body{font-family:'Inter',system-ui,Arial,sans-serif;background:#fff;color:#1a202c;}
  .page{width:${PAGE_W}px;height:${PAGE_H}px;position:relative;overflow:hidden;page-break-after:always;background:#fff;}
  .page:last-child{page-break-after:avoid;}
  h1,h2,h3,.num-font{font-family:'Poppins',sans-serif;}

  .cover{display:flex;width:100%;height:100%;}
  .cv-left{width:44%;height:100%;background:linear-gradient(150deg,${CONFIG.colorDark} 0%,${CONFIG.colorMid} 45%,${CONFIG.colorDarker} 100%);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;}
  .cv-right{width:56%;height:100%;padding:64px 56px;display:flex;flex-direction:column;justify-content:center;gap:20px;}
  .cv-eyebrow{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;}
  .cv-title{font-size:46px;font-weight:800;color:#1a202c;line-height:1.15;}
  .cv-sub{font-size:18.5px;font-weight:600;color:#4a5568;}
  .cv-desc{font-size:17px;color:#718096;line-height:1.65;max-width:580px;}

  .pi{padding:46px 64px 40px;height:100%;display:flex;flex-direction:column;}
  .pg-title{font-size:38px;font-weight:800;color:#1a202c;margin-bottom:14px;}
  .pg-intro{font-size:17px;color:#4a5568;line-height:1.6;margin-bottom:18px;max-width:1180px;}
  .pg-intro strong{color:#1a202c;}
  .pf{position:absolute;bottom:16px;left:0;right:0;display:flex;justify-content:center;}
  .tl-footer{font-size:11px;color:#cbd5e0;letter-spacing:.03em;text-align:center;}

  .alert{padding:14px 18px;display:flex;gap:12px;align-items:flex-start;font-size:16px;line-height:1.5;border-radius:8px;}
  .alert span{flex-shrink:0;font-size:16px;margin-top:1px;}
  .alert-yellow{background:#fefce8;border-left:4px solid #eab308;color:#4a5568;}
  .alert-yellow strong{color:#1a202c;}
  .note-box{padding:14px 18px;display:flex;gap:12px;align-items:flex-start;font-size:15.5px;line-height:1.5;border-radius:8px;background:#eef2f7;color:#4a5568;}
  .note-box strong{color:#1a202c;}

  .kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;}
  .kpi{border:1px solid #e2e8f0;border-radius:10px;padding:18px 24px;text-align:center;}
  .kpi-val{font-size:58px;font-weight:800;color:#2d3748;line-height:1;margin-bottom:6px;}
  .kpi-lbl{font-size:17px;font-weight:700;color:#374151;margin-bottom:5px;}
  .kpi-desc{font-size:14px;color:#94a3b8;}

  .p3-row{display:flex;gap:32px;flex:1;min-height:0;align-items:stretch;}
  .p3-chart{flex:1 1 56%;}
  .p3-table-wrap{flex:1 1 44%;display:flex;flex-direction:column;min-height:0;}
  .cond-table-scroll{flex:1 1 auto;min-height:0;overflow:hidden;}
  table.cond-table{width:100%;border-collapse:collapse;font-size:${condFontSize}px;}
  .cond-table thead th{font-size:13px;font-weight:700;color:#fff;background:#374151;text-align:left;padding:11px 10px;}
  .cond-table td{padding:${condPadY}px 10px;border-bottom:1px solid #edf2f7;color:#334155;}
  .cond-table td.num{font-weight:600;text-align:right;}
  .p3-note{font-size:15px;color:#718096;line-height:1.6;margin-top:14px;flex-shrink:0;}

  .p4-chart-wrap{flex:1;display:flex;align-items:center;}

  .p5-row{display:flex;gap:32px;flex:1;min-height:0;}
  .p5-chart-col{flex:1 1 48%;display:flex;flex-direction:column;}
  .p5-chart-title{font-size:16px;font-weight:700;color:#374151;margin-bottom:8px;}
  .p5-actions-col{flex:1 1 52%;}
  .concl-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
  .concl-card{border-left:4px solid #2d3748;background:#f8fafc;border-radius:0 8px 8px 0;padding:14px 16px;}
  .concl-card h4{font-size:16px;font-weight:700;color:#2d3748;margin-bottom:6px;}
  .concl-card p{font-size:13.5px;color:#718096;line-height:1.5;}
</style>
</head><body>

<!-- PÁGINA 1 — PORTADA -->
<div class="page cover">
  <div class="cv-left">
    <svg width="360" height="230" viewBox="0 0 360 230" fill="none">
      <circle cx="180" cy="115" r="90" fill="#fff" opacity=".08"/>
      <circle cx="180" cy="115" r="62" fill="none" stroke="#fff" stroke-width="3" opacity=".35"/>
      <path d="M180 70 L180 115 L210 135" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
      <circle cx="180" cy="115" r="6" fill="#fbbf24"/>
    </svg>
  </div>
  <div class="cv-right">
    <div class="cv-eyebrow">${eyebrow}</div>
    <h1 class="cv-title">Informe Ejecutivo — Ranking de Uso Fuera de Horario</h1>
    <p class="cv-sub">${CONFIG.siteName} · Período: ${s.rangeVerbose}</p>
    <p class="cv-desc">Durante la semana analizada se registraron <strong>${s.totalFuera} encendidos fuera de horario</strong> de un total de ${s.totalEncendidos} encendidos registrados. Se considera fuera de horario: lunes a viernes de 19:00 a 07:00, y sábado y domingo todo el día. Este reporte identifica las unidades con mayor uso fuera de faena, con el objetivo de apoyar el control operacional.</p>
  </div>
</div>

<!-- PÁGINA 2 — RESUMEN EJECUTIVO -->
<div class="page"><div class="pi">
  <h2 class="pg-title">Resumen Ejecutivo</h2>
  <p class="pg-intro">Los indicadores del período permiten focalizar el control sobre las unidades con mayor actividad fuera del horario laboral acordado.</p>
  <div class="kpi-grid">
    <div class="kpi"><div class="kpi-val">${s.totalFuera}</div><div class="kpi-lbl">Encendidos Fuera de Horario</div><div class="kpi-desc">De un total de ${s.totalEncendidos} encendidos en el período</div></div>
    <div class="kpi"><div class="kpi-val">${fmtPct(s.pctFuera)}%</div><div class="kpi-lbl">Proporción Fuera de Horario</div><div class="kpi-desc">Sobre el total de encendidos registrados</div></div>
    <div class="kpi"><div class="kpi-val">${fmtPct(s.unidadesArr[0]?.pct || 0)}%</div><div class="kpi-lbl">Unidad Crítica</div><div class="kpi-desc">${s.unidadesArr[0]?.alias || '—'} concentra ${s.unidadesArr[0]?.count || 0} encendidos fuera de horario</div></div>
    <div class="kpi"><div class="kpi-val">${pad(s.peakHour.hour)}h</div><div class="kpi-lbl">Horario Punta</div><div class="kpi-desc">Franja ${s.peakHour.fullLabel} concentra el máximo (${s.peakHour.count})</div></div>
  </div>
  <div class="alert alert-yellow"><span class="icon-warn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3L22 20H2L12 3Z" stroke="#eab308" stroke-width="2" stroke-linejoin="round" fill="#fef9c3"/><path d="M12 10v4M12 17h.01" stroke="#a16207" stroke-width="2" stroke-linecap="round"/></svg></span><div>El ${DIAS_ES_FULL[s.peakDay.date ? s.peakDay.date.getDay() : 0]} ${s.peakDay.label.split(' ')[1] || ''} concentró la mayor cantidad de encendidos fuera de horario del período (<strong>${s.peakDay.count}</strong>).</div></div>
  <div class="pf">${footer}</div>
</div></div>

<!-- PÁGINA 3 — RANKING POR UNIDAD -->
<div class="page"><div class="pi">
  <h2 class="pg-title">Ranking por Unidad</h2>
  <p class="pg-intro">Las tres unidades con más encendidos fuera de horario acumulan el <strong>${fmtPct(s.top3Pct)}% del total</strong>, lo que indica la necesidad de intervención focalizada. Lidera ${top3Text}.</p>
  <div class="p3-row">
    <div class="p3-chart">${unidadChartSvg}</div>
    <div class="p3-table-wrap">
      <div class="cond-table-scroll"><table class="cond-table"><thead><tr><th>Unidad</th><th style="text-align:right;">Fuera Horario</th><th style="text-align:right;">Total</th><th style="text-align:right;">% Propio</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      <p class="p3-note">"% Propio" es la proporción de encendidos de esa unidad que ocurrieron fuera de horario, sobre su propio total de encendidos.</p>
    </div>
  </div>
  <div class="pf">${footer}</div>
</div></div>

<!-- PÁGINA 4 — DISTRIBUCIÓN HORARIA -->
<div class="page"><div class="pi">
  <h2 class="pg-title">Distribución Horaria</h2>
  <p class="pg-intro">Distribución de los encendidos fuera de horario según la franja horaria en que ocurrieron. El pico se registra a las ${s.peakHour.fullLabel} con ${s.peakHour.count} encendidos.</p>
  <div class="p4-chart-wrap">${hourChartSvg}</div>
  <div class="note-box"><span class="icon-info"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#64748b" stroke-width="2" fill="#e2e8f0"/><path d="M12 11v5M12 8h.01" stroke="#475569" stroke-width="2" stroke-linecap="round"/></svg></span><div>Se recomienda reforzar el control y la comunicación de la política de uso de vehículos en las franjas de mayor concentración.</div></div>
  <div class="pf">${footer}</div>
</div></div>

<!-- PÁGINA 5 — DÍAS Y CONCLUSIONES -->
<div class="page"><div class="pi">
  <h2 class="pg-title">Concentración por Día y Conclusiones</h2>
  <div class="p5-row">
    <div class="p5-chart-col">
      <div class="p5-chart-title">Encendidos Fuera de Horario por Día</div>
      ${dayChartSvg}
    </div>
    <div class="p5-actions-col">
      <div class="concl-grid">
        <div class="concl-card"><h4>Intervención Focalizada</h4><p>Priorizar a las unidades ${top3Text} en la revisión de uso fuera de faena; juntas concentran el ${fmtPct(s.top3Pct)}% del total.</p></div>
        <div class="concl-card"><h4>Control en Horario Crítico</h4><p>Reforzar la supervisión en la franja ${pad(s.peakHour.hour)}:00h y en el día más crítico (${criticalDayText}).</p></div>
        <div class="concl-card"><h4>Revisión de Unidad ${s.unidadesArr[0]?.unitCode || '—'}</h4><p>Verificar el motivo operacional del uso fuera de horario de esta unidad, dado que concentra el mayor número de encendidos fuera de faena del período.</p></div>
        <div class="concl-card"><h4>Seguimiento Continuo</h4><p>Establecer alertas automáticas para unidades que superen umbrales de uso fuera de horario definidos por la supervisión.</p></div>
      </div>
    </div>
  </div>
  <div class="pf">${footer}</div>
</div></div>

</body></html>`;
}

module.exports = { parseAndFilter, computeStats, generateHTML, PAGE_W, PAGE_H, CONFIG };
if (require.main === module) {
  main().catch((err) => { console.error('[pdf-ranking] ERROR FATAL:', err.stack || err.message); process.exit(1); });
}
