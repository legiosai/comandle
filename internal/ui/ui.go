// Package ui draws comandle in the terminal: the board, the clues, the
// letters used and the explanation card. Colors follow the Dracula palette
// and switch off with NO_COLOR or when the output is not a terminal.
package ui

import (
	"fmt"
	"io"
	"os"
	"strings"
	"unicode/utf8"

	"golang.org/x/term"

	"github.com/legiosai/comandle/internal/game"
)

// Dracula palette.
const (
	bg      = "40;42;54"
	current = "68;71;90"
	fg      = "248;248;242"
	comment = "98;114;164"
	cyan    = "139;233;253"
	green   = "80;250;123"
	orange  = "255;184;108"
	pink    = "255;121;198"
	purple  = "189;147;249"
	yellow  = "241;250;140"
)

// UI writes to one output, with or without color.
type UI struct {
	w     io.Writer
	color bool
	width int
}

// New returns a UI for stdout, deciding on color the usual way and wrapping
// text to the terminal when it is narrower than the usual 72 columns.
func New(w io.Writer) *UI {
	return &UI{w: w, color: wantsColor(w), width: widthFor(w)}
}

const (
	maxWidth = 72
	minWidth = 40
)

// widthFor is the text width for w: 72 columns, or less on a narrow terminal
// (a phone, a split pane) so lines wrap between words instead of the terminal
// cutting them. Two columns go to the left margin every line starts with.
func widthFor(w io.Writer) int {
	f, ok := w.(*os.File)
	if !ok {
		return maxWidth
	}
	cols, _, err := term.GetSize(int(f.Fd()))
	if err != nil || cols <= 0 {
		return maxWidth
	}
	return max(minWidth, min(maxWidth, cols-2))
}

func wantsColor(w io.Writer) bool {
	if os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	f, ok := w.(*os.File)
	if !ok {
		return false
	}
	info, err := f.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

func (u *UI) paint(rgb, s string) string {
	if !u.color {
		return s
	}
	return "\x1b[38;2;" + rgb + "m" + s + "\x1b[0m"
}

func (u *UI) bold(rgb, s string) string {
	if !u.color {
		return s
	}
	return "\x1b[1;38;2;" + rgb + "m" + s + "\x1b[0m"
}

func (u *UI) tile(ch rune, m game.Mark) string {
	if !u.color {
		switch m {
		case game.Correct:
			return "[" + string(ch) + "]"
		case game.Present:
			return "(" + string(ch) + ")"
		}
		return " " + string(ch) + " "
	}
	back, front := current, fg
	switch m {
	case game.Correct:
		back, front = green, bg
	case game.Present:
		back, front = yellow, bg
	}
	return "\x1b[1;48;2;" + back + ";38;2;" + front + "m " + string(ch) + " \x1b[0m"
}

func (u *UI) printf(format string, a ...any) { fmt.Fprintf(u.w, format, a...) }

// Header opens a round.
func (u *UI) Header(title string, answer *game.Command) {
	n := utf8.RuneCountInString(answer.ID)
	u.printf("\n  %s  %s\n", u.bold(pink, title), u.paint(comment, "adiviná el comando en 6 intentos"))
	u.printf("  %s %s   %s %s\n",
		u.paint(comment, "categoría:"), u.bold(purple, answer.Category),
		u.paint(comment, "letras:"), u.bold(cyan, fmt.Sprint(n)))
	u.printf("  %s\n", u.blanks(n))
	u.printf("  %s\n", u.paint(comment, "? lista los comandos válidos"))
	if !u.color {
		u.printf("  %s\n", "[x] letra en su lugar   (x) está en otra posición   x no está")
	}
	u.printf("\n")
}

func (u *UI) blanks(n int) string {
	var parts []string
	for range n {
		parts = append(parts, u.paint(comment, "_"))
	}
	return strings.Join(parts, " ")
}

// Row draws one scored guess.
func (u *UI) Row(guess string, marks []game.Mark) {
	var sb strings.Builder
	for i, ch := range []rune(guess) {
		sb.WriteString(u.tile(ch, marks[i]))
		if u.color {
			sb.WriteString(" ")
		}
	}
	u.printf("  %s\n", sb.String())
}

// Board redraws every guess so far.
func (u *UI) Board(r *game.Round) {
	for i, g := range r.Guesses {
		u.Row(g, r.Marks[i])
	}
}

// Letters shows what the player knows about each key, keyboard style.
func (u *UI) Letters(state map[rune]game.Mark) {
	rows := []string{"qwertyuiop", "asdfghjkl-", "zxcvbnm0123456789"}
	for _, row := range rows {
		var sb strings.Builder
		for _, ch := range row {
			m, seen := state[ch]
			key := string(ch)
			switch {
			case !seen:
				key = u.paint(fg, key)
			case m == game.Correct:
				key = u.bold(green, key)
			case m == game.Present:
				key = u.bold(yellow, key)
			default:
				if u.color {
					key = u.paint(current, key)
				} else {
					key = "·"
				}
			}
			sb.WriteString(key)
			sb.WriteString(" ")
		}
		u.printf("  %s\n", sb.String())
	}
}

// Clue shows a newly unlocked clue.
func (u *UI) Clue(n int, text string) {
	label := fmt.Sprintf("pista %d:", n)
	u.printf("  %s %s\n", u.bold(orange, label), u.wrapAfter(text, 2+utf8.RuneCountInString(label)+1, 4))
}

// Words lists every valid command with the answer's length.
func (u *UI) Words(words []string) {
	n := 0
	if len(words) > 0 {
		n = utf8.RuneCountInString(words[0])
	}
	u.printf("  %s\n", u.bold(cyan, fmt.Sprintf("%d comandos de %d letras:", len(words), n)))
	const show = 120
	line := ""
	for i, w := range words {
		if i == show {
			break
		}
		next := w
		if line != "" {
			next = line + "  " + w
		}
		if utf8.RuneCountInString(next) > u.width-2 {
			u.printf("  %s\n", u.paint(fg, line))
			next = w
		}
		line = next
	}
	if line != "" {
		u.printf("  %s\n", u.paint(fg, line))
	}
	if len(words) > show {
		u.printf("  %s\n", u.paint(comment, fmt.Sprintf("y %d más.", len(words)-show)))
	}
}

// Problem explains why a guess was not counted.
func (u *UI) Problem(msg string) { u.printf("  %s\n", u.paint(orange, msg)) }

// Prompt asks for the next guess.
func (u *UI) Prompt(try int) {
	u.printf("  %s ", u.paint(purple, fmt.Sprintf("intento %d/%d ›", try, game.MaxTries)))
}

// Result announces the end of the round.
func (u *UI) Result(r *game.Round) {
	u.printf("\n")
	if r.Won() {
		u.printf("  %s\n", u.bold(green, fmt.Sprintf("¡Bien! Lo sacaste en %d/%d.", len(r.Guesses), game.MaxTries)))
		return
	}
	u.printf("  %s %s\n", u.bold(orange, "Esta vez no. Era"), u.bold(green, r.Answer.ID))
}

// Card is the explanation shown when a round ends, and by `comandle explicar`.
func (u *UI) Card(c *game.Command) {
	line := u.paint(comment, strings.Repeat("─", u.width))
	u.printf("\n  %s\n", line)
	u.printf("  %s  %s\n", u.bold(green, c.ID), u.paint(comment, c.Category+" · "+c.Level))
	u.printf("  %s\n\n", u.bold(fg, u.wrap(c.Summary, 2)))
	u.printf("  %s\n\n", u.wrap(c.Explanation, 2))
	u.printf("  %s\n", u.bold(purple, "Ejemplos"))
	for _, ex := range c.Examples {
		u.printf("    %s %s\n", u.paint(green, "$"), u.paint(cyan, ex.Cmd))
		u.printf("      %s\n", u.paint(comment, u.wrap(ex.Desc, 6)))
	}
	u.printf("\n  %s %s\n", u.bold(pink, "Seguridad:"), u.wrapAfter(c.Security, 13, 12))
	if c.Lab != "" {
		u.printf("  %s %s\n", u.bold(purple, "Practicalo:"), u.paint(cyan, c.Lab))
	}
	u.printf("  %s\n", line)
}

// Share prints the spoiler-free result to copy.
func (u *UI) Share(text string) {
	u.printf("\n  %s\n", u.paint(comment, "Para compartir:"))
	for l := range strings.SplitSeq(text, "\n") {
		u.printf("  %s\n", l)
	}
}

// Stats prints the player's record.
func (u *UI) Stats(played, wins, streak, maxStreak int, dist [6]int) {
	pct := 0
	if played > 0 {
		pct = wins * 100 / played
	}
	u.printf("\n  %s %d   %s %d%%   %s %d   %s %d\n",
		u.paint(comment, "jugados"), played, u.paint(comment, "ganados"), pct,
		u.paint(comment, "racha"), streak, u.paint(comment, "mejor racha"), maxStreak)
	top := 1
	for _, n := range dist {
		top = max(top, n)
	}
	for i, n := range dist {
		bar := strings.Repeat("█", 1+n*24/top)
		u.printf("  %d %s %d\n", i+1, u.paint(purple, bar), n)
	}
}

// Line prints a plain line.
func (u *UI) Line(s string) { u.printf("  %s\n", s) }

// Muted prints a secondary line.
func (u *UI) Muted(s string) { u.printf("  %s\n", u.paint(comment, s)) }

// wrap breaks text to the UI width; indent is the column continuation
// lines start at.
func (u *UI) wrap(text string, indent int) string { return u.wrapAfter(text, indent, indent) }

// wrapAfter is wrap for text printed after a label: the first line starts at
// column first and the rest at column indent.
func (u *UI) wrapAfter(text string, first, indent int) string {
	words := strings.Fields(text)
	var lines []string
	cur := ""
	limit := u.width - first
	for _, w := range words {
		if cur != "" && utf8.RuneCountInString(cur)+1+utf8.RuneCountInString(w) > limit {
			lines = append(lines, cur)
			cur = w
			limit = u.width - indent
			continue
		}
		if cur == "" {
			cur = w
		} else {
			cur += " " + w
		}
	}
	if cur != "" {
		lines = append(lines, cur)
	}
	return strings.Join(lines, "\n"+strings.Repeat(" ", indent))
}
