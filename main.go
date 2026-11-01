// comandle is a daily guessing game for Linux and security commands, played
// in the terminal. When the round ends it explains the command: what it does,
// examples, and what to watch out for.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"github.com/legiosai/comandle/data"
	"github.com/legiosai/comandle/internal/game"
	"github.com/legiosai/comandle/internal/stats"
	"github.com/legiosai/comandle/internal/ui"
)

// version is set at release time with -ldflags "-X main.version=...".
var version = "dev"

const contributing = "https://github.com/legiosai/comandle/blob/main/CONTRIBUTING.md"

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, time.Now()))
}

func run(args []string, in io.Reader, out io.Writer, now time.Time) int {
	u := ui.New(out)
	book, err := game.Load(data.Commands, data.Allowed)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}

	cmd := ""
	if len(args) > 0 {
		cmd = args[0]
	}
	switch cmd {
	case "", "hoy", "jugar":
		return daily(book, u, in, now)
	case "practica", "práctica", "practice":
		opts, err := practiceArgs(args[1:])
		if err != nil {
			u.Problem(err.Error())
			return 2
		}
		return practice(book, u, in, opts)
	case "explicar", "explain":
		if len(args) < 2 {
			u.Problem("Uso: comandle explicar <comando>")
			return 2
		}
		return explain(book, u, args[1])
	case "lista", "list":
		return list(book, u, now)
	case "stats", "estadisticas", "estadísticas":
		return showStats(u)
	case "version", "--version", "-v":
		fmt.Fprintln(out, "comandle", currentVersion())
		return 0
	case "ayuda", "help", "--help", "-h":
		help(out)
		return 0
	default:
		help(out)
		return 2
	}
}

// currentVersion is the release tag for release binaries, and the module
// version Go records for `go install ...@v0.1.0` builds.
func currentVersion() string {
	if version != "dev" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version
	}
	return version
}

func help(out io.Writer) {
	fmt.Fprint(out, `comandle: adiviná el comando del día en 6 intentos

  comandle                  juega el comandle de hoy
  comandle practica [cmd]   una ronda que no suma a tus estadísticas: al azar, o con ese comando
  comandle practica -l 5    lo mismo pero con un comando de 5 letras (también --letras)
  comandle practica -c redes -n básico
                            al azar entre los de esa categoría y ese nivel (también
                            --categoria y --nivel); se combinan entre sí y con -l
  comandle explicar <cmd>   explica un comando de la lista
  comandle lista            los comandos de los días que ya pasaron
  comandle stats            tus estadísticas
  comandle version

Cómo se juega: escribís un comando con la misma cantidad de letras. Cada letra
queda verde si está en su lugar, amarilla si está en otra posición y gris si no
está. Ves la categoría desde el principio y se destapan pistas a medida que
fallás. Escribí ? para ver todos los comandos válidos con esa cantidad de
letras. El comando cambia a medianoche (hora de Argentina) y es el mismo para
todos. Sin colores: [x] en su lugar, (x) en otra posición.

Todo queda en tu máquina: comandle no se conecta a internet.
`)
}

func daily(book *game.Book, u *ui.UI, in io.Reader, now time.Time) int {
	day := game.DayNumber(now)
	answer := book.Daily(day)
	path, err := stats.Path()
	if err != nil {
		u.Problem("No encuentro dónde guardar tus estadísticas: " + err.Error())
		return 1
	}
	st, err := stats.Load(path)
	if err != nil {
		u.Problem("No pude leer tus estadísticas (" + err.Error() + "); arranco de cero.")
		st = stats.Stats{}
	}

	title := fmt.Sprintf("comandle #%d", day)
	if st.PlayedDay(day) {
		// Already played today: show how it went instead of a second round.
		r := game.NewRound(book, answer)
		for _, g := range st.LastGuesses {
			r.Try(g)
		}
		u.Header(title, answer)
		u.Muted("Ya jugaste el de hoy.")
		u.Board(r)
		u.Result(r)
		u.Card(answer)
		u.Share(r.Share(day, false))
		u.Stats(st.Played, st.Wins, st.Streak, st.MaxStreak, st.Dist)
		nextIn(u, now)
		return 0
	}

	r, finished := play(book, u, in, title, answer)
	if !finished {
		u.Muted("Quedó a medias: volvé cuando quieras, el de hoy sigue esperándote.")
		return 0
	}
	st.Record(day, r.Won(), r.Guesses)
	if err := stats.Save(path, st); err != nil {
		u.Problem("No pude guardar tus estadísticas: " + err.Error())
	}
	u.Card(answer)
	u.Share(r.Share(day, false))
	u.Stats(st.Played, st.Wins, st.Streak, st.MaxStreak, st.Dist)
	nextIn(u, now)
	return 0
}

// practiceOpts is what "practica" was asked for: one command to play, or the
// filters for a random one. Zero values mean any.
type practiceOpts struct {
	pick     string // a command name: play that one
	letters  int    // -l/--letras
	category string // -c/--categoria, one of game.Categories
	level    string // -n/--nivel, one of game.Levels
}

func (o practiceOpts) filtered() bool { return o.letters != 0 || o.category != "" || o.level != "" }

// practiceFlags are the filters "practica" takes, by short and long name.
var practiceFlags = []struct{ short, long string }{
	{"-l", "--letras"},
	{"-c", "--categoria"},
	{"-n", "--nivel"},
}

// practiceFlag reports whether a is one of practiceFlags, by its short name,
// and the value when it comes attached: -l5, -l=5 or --letras=5. Long names
// also work with an accent or in capitals (--categoría).
func practiceFlag(a string) (flag, val string, attached, ok bool) {
	for _, f := range practiceFlags {
		if strings.HasPrefix(a, "--") {
			name, v, eq := strings.Cut(a, "=")
			if fold(name) == f.long {
				return f.short, v, eq, true
			}
			continue
		}
		if a == f.short {
			return f.short, "", false, true
		}
		if rest, found := strings.CutPrefix(a, f.short); found {
			return f.short, strings.TrimPrefix(rest, "="), true, true
		}
	}
	return "", "", false, false
}

// practiceArgs parses the arguments after "practica": an optional command
// name, or the filters -l <letras>, -c <categoría> and -n <nivel> in any
// combination (each also as -l5, -l=5, --letras 5 or --letras=5). Not a
// command and a filter: the command already decides all of that.
func practiceArgs(args []string) (practiceOpts, error) {
	usage := errors.New("Uso: comandle practica [cmd | -c <categoría> -n <nivel> -l <letras>]")
	var o practiceOpts
	for i := 0; i < len(args); i++ {
		flag, val, attached, ok := practiceFlag(args[i])
		if !ok {
			if o.pick != "" {
				return practiceOpts{}, usage
			}
			o.pick = args[i]
			continue
		}
		if !attached {
			if i+1 < len(args) {
				i++
				val = args[i]
			} else if flag == "-l" {
				return practiceOpts{}, usage
			}
		}
		var err error
		switch flag {
		case "-l":
			n, convErr := strconv.Atoi(val)
			if convErr != nil || n < 1 {
				return practiceOpts{}, errors.New("-l tiene que ser un número de letras mayor que 0.")
			}
			o.letters = n
		case "-c":
			o.category, err = option(game.Categories, val, "Falta la categoría", "no es una categoría", "Elegí una")
		case "-n":
			o.level, err = option(game.Levels, val, "Falta el nivel", "no es un nivel", "Elegí uno")
		}
		if err != nil {
			return practiceOpts{}, err
		}
	}
	if o.pick != "" && o.filtered() {
		return practiceOpts{}, usage
	}
	return o, nil
}

// option returns the one of options that val names, ignoring case and
// accents, so -n basico is básico. When there is none, the error lists them.
func option(options []string, val, missing, unknown, choose string) (string, error) {
	list := " " + choose + ": " + strings.Join(options, ", ") + "."
	if strings.TrimSpace(val) == "" {
		return "", errors.New(missing + "." + list)
	}
	for _, o := range options {
		if fold(o) == fold(val) {
			return o, nil
		}
	}
	return "", errors.New("«" + val + "» " + unknown + "." + list)
}

// unaccent also drops a combining acute, for input typed already decomposed.
var unaccent = strings.NewReplacer("á", "a", "é", "e", "í", "i", "ó", "o", "ú", "u", "\u0301", "")

func fold(s string) string { return unaccent.Replace(strings.ToLower(strings.TrimSpace(s))) }

// practicePool is every command the filters allow, in calendar order.
func practicePool(cmds []game.Command, o practiceOpts) []*game.Command {
	var pool []*game.Command
	for i := range cmds {
		c := &cmds[i]
		if (o.letters == 0 || len([]rune(c.ID)) == o.letters) &&
			(o.category == "" || c.Category == o.category) &&
			(o.level == "" || c.Level == o.level) {
			pool = append(pool, c)
		}
	}
	return pool
}

// noPractice says that the filters leave no command and, for each filter
// given, which other values would leave some with the rest unchanged.
func noPractice(cmds []game.Command, u *ui.UI, o practiceOpts) {
	msg := "No hay comandos"
	if o.letters != 0 {
		msg += fmt.Sprintf(" de %d letras", o.letters)
	}
	var with []string
	if o.category != "" {
		with = append(with, "categoría "+o.category)
	}
	if o.level != "" {
		with = append(with, "nivel "+o.level)
	}
	if len(with) > 0 {
		msg += " con " + strings.Join(with, " y ")
	}
	u.Problem(msg + ".")

	hinted := false
	hint := func(label string, values []string, swap func(*practiceOpts, string)) {
		var left []string
		for _, v := range values {
			alt := o
			swap(&alt, v)
			if len(practicePool(cmds, alt)) > 0 {
				left = append(left, v)
			}
		}
		if len(left) > 0 {
			u.Problem(label + ": " + strings.Join(left, ", ") + ".")
			hinted = true
		}
	}
	if o.category != "" {
		hint("Probá otra categoría", game.Categories, func(a *practiceOpts, v string) { a.category = v })
	}
	if o.level != "" {
		hint("Probá otro nivel", game.Levels, func(a *practiceOpts, v string) { a.level = v })
	}
	if o.letters != 0 {
		var lengths []string
		for n := game.MinLen; n <= game.MaxLen; n++ {
			lengths = append(lengths, strconv.Itoa(n))
		}
		hint("Probá otra cantidad de letras", lengths, func(a *practiceOpts, v string) { a.letters, _ = strconv.Atoi(v) })
	}
	if !hinted {
		u.Problem("Probá con menos filtros.")
	}
}

// practice plays a round that does not count. With a command name it plays
// that one, so a teacher can hand the class a specific command. Otherwise it
// picks a random command among the ones the filters allow.
func practice(book *game.Book, u *ui.UI, in io.Reader, o practiceOpts) int {
	var answer *game.Command
	if o.pick == "" {
		pool := practicePool(book.Commands, o)
		if len(pool) == 0 {
			noPractice(book.Commands, u, o)
			return 1
		}
		answer = pool[rand.IntN(len(pool))]
	} else {
		c, ok := book.Get(o.pick)
		if !ok {
			u.Problem("«" + o.pick + "» no está en la lista de comandos del juego.")
			return 1
		}
		answer = c
	}
	r, finished := play(book, u, in, "comandle · práctica", answer)
	if !finished {
		u.Muted("Práctica cortada. Era " + answer.ID + ".")
		return 0
	}
	u.Card(answer)
	u.Share(r.Share(0, true))
	return 0
}

// play runs one round reading guesses from in. It returns false when the
// input ends before the round does (Ctrl-D, or "salir").
func play(book *game.Book, u *ui.UI, in io.Reader, title string, answer *game.Command) (*game.Round, bool) {
	r := game.NewRound(book, answer)
	u.Header(title, answer)
	sc := bufio.NewScanner(in)
	shown := 0
	for !r.Over() {
		u.Prompt(len(r.Guesses) + 1)
		if !sc.Scan() {
			u.Line("")
			return r, false
		}
		guess := strings.ToLower(strings.TrimSpace(sc.Text()))
		if guess == "" {
			continue
		}
		if guess == "salir" || guess == "exit" {
			return r, false
		}
		if guess == "?" || guess == "lista" {
			u.Words(r.Words())
			continue
		}
		marks, err := r.Try(guess)
		switch {
		case errors.Is(err, game.ErrLength):
			u.Problem(fmt.Sprintf("Tiene que tener %d letras.", len([]rune(answer.ID))))
			continue
		case errors.Is(err, game.ErrUnknown):
			u.Problem("«" + guess + "» no está en la lista de comandos que acepta el juego.")
			continue
		case errors.Is(err, game.ErrRepeated):
			u.Problem("Ya lo probaste.")
			continue
		case err != nil:
			u.Problem(err.Error())
			continue
		}
		u.Row(guess, marks)
		if r.Over() {
			break
		}
		u.Letters(r.LetterState())
		for shown < r.CluesVisible() {
			u.Clue(shown+1, answer.Clues[shown])
			shown++
		}
	}
	u.Result(r)
	return r, true
}

func explain(book *game.Book, u *ui.UI, id string) int {
	c, ok := book.Get(id)
	if !ok {
		u.Problem("«" + id + "» todavía no está en comandle.")
		u.Muted("¿Lo sumás? " + contributing)
		return 1
	}
	u.Card(c)
	return 0
}

func list(book *game.Book, u *ui.UI, now time.Time) int {
	today := game.DayNumber(now)
	u.Line("Los comandos que ya salieron:")
	for d := 1; d < today; d++ {
		u.Line(fmt.Sprintf("#%-3d %s", d, book.Daily(d).ID))
	}
	u.Muted(fmt.Sprintf("#%-3d (el de hoy, jugalo con «comandle»)", today))
	return 0
}

func showStats(u *ui.UI) int {
	path, err := stats.Path()
	if err != nil {
		u.Problem(err.Error())
		return 1
	}
	st, err := stats.Load(path)
	if err != nil {
		u.Problem(err.Error())
		return 1
	}
	u.Stats(st.Played, st.Wins, st.Streak, st.MaxStreak, st.Dist)
	u.Muted("Guardadas en " + path)
	return 0
}

func nextIn(u *ui.UI, now time.Time) {
	left := game.NextDay(now).Sub(now).Round(time.Minute)
	h, m := int(left.Hours()), int(left.Minutes())%60
	u.Muted(fmt.Sprintf("\nEl próximo comandle sale en %dh %02dm.", h, m))
}
