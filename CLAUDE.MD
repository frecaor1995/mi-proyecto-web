HOLA SOY KEVIN CON MI TIO FREDY

## Agentes

- **Agente Diseñador Web**: Su rol es crear, diseñar y estructurar páginas web modernas usando HTML, CSS y JavaScript. Se encarga de maquetar interfaces atractivas, responsivas y accesibles para el usuario final.
- **Agente Desarrollador Frontend**: Su rol es construir componentes interactivos y funcionales para páginas web, implementando frameworks como React o Vue, optimizando el rendimiento y garantizando una experiencia de usuario fluida y profesional.

---

# Protocolo de protección — fly-electric / calculadora.html

Reglas obligatorias para **todas** las sesiones futuras (Claude Code u otro asistente) que trabajen en este repositorio. Léelas antes de tocar cualquier archivo.

## 1. Versión estable actual

La versión estable y validada es el tag **`v1.1-pin-fix`** (commit `591f273`). Si existe un tag `vX.Y-validada` más reciente, ese es el que manda — siempre usa el **último tag `-validada`** como fuente de verdad, no asumas que `v1.1-pin-fix` sigue siendo el más nuevo sin comprobarlo (`git tag -l`).

**NUNCA modificar `main` directamente.** Todo cambio pasa por una rama.

## 2. Flujo obligatorio para cualquier cambio

1. Verifica el punto de partida antes de editar nada:
   ```
   git status
   git log -1
   ```
   Si `git status` no está limpio o `HEAD` no es lo que esperas, detente y pregunta antes de continuar.

2. Crea una rama nueva: `feature/nombre-del-cambio` (nunca trabajes directo en `main`).

3. Un solo cambio por rama. **Prohibido tocar código no relacionado** con lo que se pidió explícitamente — no aproveches para "limpiar" o "mejorar" algo más mientras estás ahí.

4. Antes de dar el cambio por terminado, prueba con Playwright los **tres flujos obligatorios**:
   - **Estimate**: libre, sin PIN, en cualquier carga de página.
   - **Official Quote**: pide PIN `2025` en cada carga nueva de página (la sesión desbloqueada vive en `sessionStorage`, dura solo mientras la pestaña esté abierta).
   - **Contrato**: el botón/vista solo es accesible después de desbloquear Official Quote con el PIN en esa misma sesión de pestaña; incluye firma digital de cliente y técnico por canvas, y PDF con ambas firmas.

5. **No hacer merge a `main` hasta que Fredy confirme explícitamente que lo validó visualmente.** "Los tests pasan" no es autorización para mergear — se necesita su confirmación explícita después de que él (o quien opere el proyecto) lo haya visto funcionar.

6. Después de un merge a `main` ya validado por Fredy, crea un tag incremental (`v1.2-validada`, `v1.3-validada`, etc.) sobre ese commit y publícalo (`git push origin <tag>`).

## 3. Protección de `main`

La rama `main` en GitHub tiene protección configurada para impedir push directo sin revisión (pull request requerido). Si alguna vez un push directo a `main` es rechazado, **esa es la protección funcionando correctamente** — no la desactives; abre una rama y un PR en su lugar.

## 4. Respaldo externo

Existe un respaldo zip de cada versión validada en `C:/Users/sirua/Backups/` (fuera del repo), generado con `git archive`. Antes de operaciones riesgosas (rebase, cambios grandes de arquitectura), genera uno nuevo del tag validado más reciente:
```
git archive -o C:/Users/sirua/Backups/fly-electric-<tag>.zip <tag>
```

## 5. Contexto del proyecto (para no repetir descubrimientos ya hechos)

- El sitio se despliega en `flyelectricsolution.com` vía **GitHub Actions** (`.github/workflows/pages.yml`), no vía el pipeline legacy de GitHub Pages (ese se abandonó porque se quedaba colgado sin dar error). El artifact que se publica es solo `index.html`, `calculadora.html`, `estimator.html`, `CNAME`, `robots.txt`, `sitemap.xml` y los logos — nunca subas `.env.local`, `node_modules`, `.git` ni archivos de backup/debug al artifact público.
- El PIN de Official Quote es `2025`, validado con `sessionStorage` (no `localStorage`) para que expire al cerrar la pestaña.
- Antes de asumir que algo "no funciona en producción", compara el hash del archivo local contra el publicado (`curl` + `md5sum`, normalizando `\r` con `tr -d '\r'` porque Windows usa CRLF y los runners de Linux usan LF — no es un bug si solo difieren por eso) y revisa el estado real de los builds/deploys antes de tocar código que ya funciona.
