# comandle

Adiviná el comando del día en 6 intentos, desde la terminal o en el navegador. Cuando termina la
ronda, comandle te explica el comando: qué hace, tres ejemplos y qué tener en
cuenta de seguridad.

**Jugalo en el navegador: https://comandle.valentorassa.com** (mismo comando del día que la terminal).

![Una ronda de práctica: kill, ping y nmap, y la ficha que explica nmap](docs/demo.gif)

## Cómo se juega

- Todos los días hay un comando nuevo de Linux o de seguridad, el mismo para
  todos, en la terminal y en la web. Cambia a medianoche, hora de Argentina. El
  #1 fue el 20/10/2026.
- Escribís un comando con la misma cantidad de letras. Cada letra queda
  **verde** si está en su lugar, **amarilla** si está en otra posición y **gris**
  si no está.
- Ves la categoría desde el principio (archivos, redes, permisos...). Con dos
  intentos fallidos se destapa una pista, con cuatro otra y con cinco la última.
- Solo valen nombres de comandos reales: la lista está en
  [`data/allowed.txt`](data/allowed.txt). En la terminal escribí `?` para ver
  todos los comandos válidos con esa cantidad de letras; en la web están detrás
  de «N comandos» y `tab` completa.
- Al final copiás el resultado para compartirlo sin spoilers:

```
comandle #1 4/6
⬛🟨⬛⬛⬛
🟩⬛🟨⬛⬛
🟩🟩⬛🟩⬛
🟩🟩🟩🟩🟩
```

## En la web

![La web: tablero, teclado y vt, el pingüino, citando a Ken Thompson](docs/web.png)

Un personaje ASCII comenta la ronda como lo haría `cowsay`: cambia los ojos
cuando vas mal, festeja con `exit 0` y muere con un `segmentation fault`. Si lo
tocás, corre `fortune`. Por defecto es vt, el pingüino; desde el selector podés
cambiarlo por la vaca, un conejo, un gato, un búho, un cangrejo o un fantasma, y
la web recuerda tu elección.

Debajo del título se ven las partidas terminadas hoy, ayer y desde el lanzamiento
público (28/10/2026). Tocá ese contador para abrir el ranking: agrupa los resultados
por intentos, comparte puesto entre empates y resalta tu resultado guardado en
este navegador. Podés alternar hoy y ayer. Solo suma partidas diarias de la web;
la práctica y la terminal no participan. No hace falta elegir nombre ni crear cuenta.

Para previsualizar la web localmente: `node scripts/preview.mjs` y abrí
`http://127.0.0.1:4173`. El contador necesita el endpoint público de Pluma;
para probar un cambio del backend, definí `COMANDLE_API_URL` con la URL local de
`/api/comandle`. Jugar en localhost no manda eventos al contador de producción.

## Instalación

Con Go 1.27 o superior:

```bash
go install github.com/legiosai/comandle@latest
```

O bajá el binario para Linux, macOS o Windows desde
[Releases](https://github.com/legiosai/comandle/releases) y verificá su
SHA256 contra `SHA256SUMS`.

## Comandos

```bash
comandle                  # el comandle de hoy
comandle practica         # una ronda al azar que no suma a tus estadísticas
comandle practica nmap    # practicá un comando puntual (sirve para dar en clase)
comandle explicar chmod   # la ficha de cualquier comando de la lista
comandle lista            # los comandos de los días que ya pasaron
comandle stats            # tus estadísticas y tu racha
```

Sin colores (`NO_COLOR=1` o salida que no es una terminal), las letras se marcan
así: `[x]` en su lugar, `(x)` en otra posición.

## Privacidad

La versión de terminal no se conecta a internet. La web no usa cookies ni
guarda nada que te identifique: cuando empezás o terminás una partida, o copiás
el resultado, suma 1 a un contador del día y a otro de la hora en que llega
(hora de Argentina; la anota el servidor, el juego no manda nada más). Así sabemos
cuántas partidas hay, en cuántos intentos se resuelven, cuántos días seguidos se
juega (en tramos) y de qué sitio y a qué hora llegan las visitas, sin IP ni
identificador. Si tu navegador tiene
activado Global Privacy Control, no manda eventos. Consultar el ranking solo lee
los contadores públicos.

En la terminal, tus estadísticas quedan en un archivo que
solo puede leer tu usuario: `$XDG_STATE_HOME/comandle/stats.json` si definiste
esa variable, y si no `~/.config/comandle/` en Linux o
`~/Library/Application Support/comandle/` en macOS. En la web quedan en el
almacenamiento local de tu navegador.

## Sumá un comando

La lista crece con la comunidad. Cada comando es una entrada en
[`data/commands.json`](data/commands.json) con pistas, explicación, ejemplos y
una nota de seguridad. Los pasos están en [CONTRIBUTING.md](CONTRIBUTING.md).

## English

comandle is a daily Wordle-like game for Linux and security commands, played in
the terminal or the browser and written in Spanish. When a round ends it explains the command
with examples and a security note. The terminal version has no network access
and no telemetry; stats stay in a local file. The web adds 1 to anonymous daily
counters (rounds, results, where visits come from), with no cookies or
identifiers, and sends no play events when Global Privacy Control is on. Public
daily counts and an anonymous ranking are available in the browser. Play it at https://comandle.valentorassa.com or install it with `go install github.com/legiosai/comandle@latest`.

## Licencia

[Apache-2.0](LICENSE). Hecho por [VT Security](https://valentorassa.com), publicado por
[Legios](https://github.com/legiosai).
