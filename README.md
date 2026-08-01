# tracklink-kadel

Automatización del **Informe de Excesos de Velocidad (>100 km/h)** para KADEL,
clon parametrizado de [tracklink-santamarta](https://github.com/WurfelSPA/tracklink-santamarta).

Cada lunes a las 01:00 CLT, GitHub Actions descarga el reporte de TrackGTS,
lo fusiona con el historial y genera `reporte-semanal.pdf`. n8n lo descarga
y lo envía por email a las 07:00 CLT.

## Estado (2026-08-01)

- [x] Diseño confirmado (muestra enviada por Mauricio el 27/07, 5 páginas: portada, KPIs, unidades, distribución horaria, día + conclusiones)
- [x] `generate-pdf.js` — clon parametrizado, paleta navy/slate, agrupado por Unidad
- [x] `download-weekly.js` — clon parametrizado, unitIds vía secret `TL_UNIT_IDS`
- [x] `weekly-report.yml` — mismo horario que Santa Marta (lunes 01:00 CLT)
- [x] Mapeo patente → unitId resuelto vía HealthCheck_171 (ver tabla abajo)
- [x] Secrets `TL_USER` / `TL_PASSWORD` / `TL_DOMAIN` — mismos que Santa Marta
- [x] Workflow n8n de envío creado (Lunes 07:00 CLT) — [bHxQoP3c00Litycm](https://wurfel.app.n8n.cloud/workflow/bHxQoP3c00Litycm), inactivo, solo TEST a wurfel.cl@gmail.com
- [ ] **PENDIENTE: cargar el secret `TL_UNIT_IDS`** en GitHub (Settings → Secrets → Actions) con el valor de la sección siguiente
- [ ] Prueba end-to-end contra el Excel de referencia antes de producción
- [ ] Activar workflow n8n y GitHub Action una vez validado

## Mapeo de unidades (HealthCheck_171, 2026-08-01)

Valor a cargar en el secret `TL_UNIT_IDS` (36 unidades, ya excluye las 5 fuera de monitoreo):

```
6580,6581,6582,6583,6585,6586,6587,6588,6589,6592,6593,6594,6595,6596,6597,6598,6599,6600,6601,6602,6603,6604,6605,6606,6607,6608,6609,6610,6612,6614,6616,6617,6618,6619,6620,6621
```

Unidades **excluidas** (confirmadas por patente):

| unitId | Alias | Placa |
|--------|-------|-------|
| 5647 | CHEVROLET MONTANA SWFB-15 | SWFB-15 |
| 6579 | DONGFENG RICH 6 TVKC-50 | TVKC-50 |
| 6584 | MUSSO RHDZ-45 F REBOLLEDO | RHDZ-45 |
| 6590 | GC LTTW-96 JUAN SILVA | LTTW-96 |
| 6591 | TOYOTA-HILUX-PKGT-50 | PKGT-50 |

## Umbral de velocidad

La API de TrackGTS (`GetSpeedingReportByUnitsPagesZip`) no acepta un umbral
configurable — siempre devuelve lo que el sistema marca como "exceso" según
su propio default. `generate-pdf.js` aplica un filtro adicional
(`CONFIG.speedThreshold = 100`) como red de seguridad para respetar el
umbral pactado con el cliente.

## Secrets requeridos (Settings → Secrets → Actions)

| Secret        | Descripción                                                  |
|---------------|---------------------------------------------------------------|
| `TL_USER`     | Usuario TrackGTS                                              |
| `TL_PASSWORD` | Contraseña TrackGTS                                            |
| `TL_DOMAIN`   | Subdominio (ej. `tlchile`)                                     |
| `TL_UNIT_IDS` | unitIds de KADEL separados por coma, ya excluyendo las 5 unidades fuera de monitoreo |

## Destinatarios finales (confirmar antes de activar envío real)

- p.rebolledo@kadel.cl
- a.verc.kadel@gmail.com
- j.silva@kadel.cl
- francisca.lopez@tracklink.cl
