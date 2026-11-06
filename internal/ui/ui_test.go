package ui

import (
	"bytes"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/legiosai/comandle/data"
	"github.com/legiosai/comandle/internal/game"
)

// Every clue and every card must fit the UI width, labels included, so a
// terminal never breaks a line in the middle of a word: at the usual 72
// columns, on a phone-sized 44 and at the narrowest width the UI uses.
func TestTextFitsTheWidth(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	book, err := game.Load(data.Commands, data.Allowed)
	if err != nil {
		t.Fatal(err)
	}
	for _, width := range []int{maxWidth, 44, minWidth} {
		for _, c := range book.Commands {
			checkFits(t, &c, width)
		}
	}
}

func checkFits(t *testing.T, c *game.Command, width int) {
	t.Helper()
	{
		var buf bytes.Buffer
		u := New(&buf)
		u.width = width
		for i, clue := range c.Clues {
			u.Clue(i+1, clue)
		}
		u.Card(c)
		for _, line := range strings.Split(buf.String(), "\n") {
			// Commands, URLs and the rule are printed whole on purpose.
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "$ ") || strings.HasPrefix(trimmed, "Practicalo:") || strings.HasPrefix(trimmed, "https://") || strings.HasPrefix(trimmed, "─") {
				continue
			}
			if n := utf8.RuneCountInString(line); n > u.width {
				t.Errorf("%s: line has %d columns, more than %d:\n%s", c.ID, n, u.width, line)
			}
		}
	}
}

// A command the book uses gets one line with its chapter and the book's page;
// one the book does not use gets nothing.
func TestCardPointsToTheBook(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	book, err := game.Load(data.Commands, data.Allowed)
	if err != nil {
		t.Fatal(err)
	}
	card := func(id string) string {
		c, ok := book.Get(id)
		if !ok {
			t.Fatalf("%s is not in the data", id)
		}
		var buf bytes.Buffer
		New(&buf).Card(c)
		return strings.Join(strings.Fields(buf.String()), " ")
	}
	want := "Libro: curl aparece en el capítulo 7 de «No podés defender lo que no entendés». https://valentorassa.com/libro?ref=comandle"
	if got := card("curl"); !strings.Contains(got, want) {
		t.Errorf("the curl card should say %q:\n%s", want, got)
	}
	if got := card("nmap"); strings.Contains(got, "Libro:") || strings.Contains(got, "valentorassa.com/libro") {
		t.Errorf("nmap is not in the book, but its card points to it:\n%s", got)
	}
}

// Output that is not a terminal (a pipe, a file, a test) keeps the usual width.
func TestWidthForNonTerminal(t *testing.T) {
	if w := widthFor(&bytes.Buffer{}); w != maxWidth {
		t.Fatalf("widthFor(buffer) = %d, want %d", w, maxWidth)
	}
}

// A long problem (the list of categories after a typo) wraps between words.
func TestProblemWraps(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	var buf bytes.Buffer
	u := New(&buf)
	u.width = minWidth
	msg := "«red» no es una categoría. Elegí una: " + strings.Join(game.Categories, ", ") + "."
	u.Problem(msg)
	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	if len(lines) < 2 {
		t.Fatalf("expected the message to wrap at %d columns:\n%s", u.width, buf.String())
	}
	for _, line := range lines {
		if n := utf8.RuneCountInString(line); n > u.width {
			t.Errorf("line has %d columns, more than %d:\n%s", n, u.width, line)
		}
	}
	if got := strings.Join(strings.Fields(buf.String()), " "); got != msg {
		t.Errorf("wrapping changed the words:\n%s", got)
	}
}
