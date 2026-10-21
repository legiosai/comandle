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
			// Commands, lab URLs and the rule are printed whole on purpose.
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "$ ") || strings.HasPrefix(trimmed, "Practicalo:") || strings.HasPrefix(trimmed, "─") {
				continue
			}
			if n := utf8.RuneCountInString(line); n > u.width {
				t.Errorf("%s: line has %d columns, more than %d:\n%s", c.ID, n, u.width, line)
			}
		}
	}
}

// Output that is not a terminal (a pipe, a file, a test) keeps the usual width.
func TestWidthForNonTerminal(t *testing.T) {
	if w := widthFor(&bytes.Buffer{}); w != maxWidth {
		t.Fatalf("widthFor(buffer) = %d, want %d", w, maxWidth)
	}
}
