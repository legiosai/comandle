package ui

import (
	"bytes"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/legiosai/comandle/data"
	"github.com/legiosai/comandle/internal/game"
)

// Every clue and every card must fit the UI width, labels included, so an
// 80-column terminal never breaks a line in the middle of a word.
func TestTextFitsTheWidth(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	book, err := game.Load(data.Commands, data.Allowed)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range book.Commands {
		var buf bytes.Buffer
		u := New(&buf)
		for i, clue := range c.Clues {
			u.Clue(i+1, clue)
		}
		u.Card(&c)
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
