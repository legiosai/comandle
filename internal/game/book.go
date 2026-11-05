// Package game holds comandle's rules: the command list, the daily answer,
// how a guess is scored and what a round shares.
package game

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"regexp"
	"slices"
	"strings"
)

// Lengths an answer may have. Shorter commands make a dull board and longer
// ones turn the game into typing.
const (
	MinLen = 4
	MaxLen = 8
)

// Categories and levels a command may declare.
var (
	Categories = []string{"archivos", "texto", "procesos", "redes", "permisos", "sistema", "seguridad", "paquetes", "git", "contenedores"}
	Levels     = []string{"básico", "intermedio", "avanzado"}
)

var idPattern = regexp.MustCompile(`^[a-z0-9-]+$`)

// BookTitle is the book a card can point to, and BookURL its page: the ref
// tells the page's counters that the visit came from comandle.
const (
	BookTitle = "No podés defender lo que no entendés"
	BookURL   = "https://valentorassa.com/libro?ref=comandle"
)

// BookChapters are the book's chapter titles, chapter 1 first. A command's
// book entry must name its chapter with the same title.
var BookChapters = []string{
	"Toda abstracción filtra",
	"Del comando al kernel",
	"Programa, proceso, thread",
	"Quién actúa, y con qué permiso",
	"Todo es un archivo",
	"Arranque, servicios y logs",
	"Una request no es magia",
	"Un contenedor no es una VM",
	"La nube es la computadora de otro",
	"Agentes: el mismo problema con otra cara",
	"Debian, o el permiso para mirar",
	"La experiencia se demuestra",
}

// Chapter is the chapter of the book where a command is used.
type Chapter struct {
	Number int    `json:"chapter"`
	Title  string `json:"title"`
}

// Example is one way to run a command, with what it does.
type Example struct {
	Cmd  string `json:"cmd"`
	Desc string `json:"desc"`
}

// Command is one answer: the clues shown while playing and the card shown
// when the round ends.
type Command struct {
	ID          string    `json:"id"`
	Category    string    `json:"category"`
	Level       string    `json:"level"`
	Clues       []string  `json:"clues"`
	Summary     string    `json:"summary"`
	Explanation string    `json:"explanation"`
	Examples    []Example `json:"examples"`
	Security    string    `json:"security"`
	Lab         string    `json:"lab,omitempty"`
	InBook      *Chapter  `json:"book,omitempty"`
}

// Book is the whole game data: the answers in calendar order and the words a
// player may guess.
type Book struct {
	Commands []Command
	byID     map[string]int
	allowed  map[string]bool
}

// Load parses and validates the embedded data. Every problem is reported at
// once, so a contributor fixes their entry in one go.
func Load(commandsJSON, allowedTxt []byte) (*Book, error) {
	var cmds []Command
	dec := json.NewDecoder(bytes.NewReader(commandsJSON))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cmds); err != nil {
		return nil, fmt.Errorf("commands.json: %w", err)
	}
	b := &Book{Commands: cmds, byID: map[string]int{}, allowed: map[string]bool{}}

	sc := bufio.NewScanner(bytes.NewReader(allowedTxt))
	for sc.Scan() {
		w := strings.TrimSpace(sc.Text())
		if w == "" || strings.HasPrefix(w, "#") {
			continue
		}
		b.allowed[w] = true
	}

	var problems []string
	if len(cmds) == 0 {
		problems = append(problems, "commands.json has no entries")
	}
	for i, c := range cmds {
		where := fmt.Sprintf("entry %d (%q)", i, c.ID)
		switch {
		case !idPattern.MatchString(c.ID):
			problems = append(problems, where+": id must be lowercase letters, digits or '-'")
		case len(c.ID) < MinLen || len(c.ID) > MaxLen:
			problems = append(problems, fmt.Sprintf("%s: id must have %d to %d characters", where, MinLen, MaxLen))
		}
		if _, dup := b.byID[c.ID]; dup {
			problems = append(problems, where+": duplicate id")
		}
		b.byID[c.ID] = i
		if !slices.Contains(Categories, c.Category) {
			problems = append(problems, fmt.Sprintf("%s: unknown category %q", where, c.Category))
		}
		if !slices.Contains(Levels, c.Level) {
			problems = append(problems, fmt.Sprintf("%s: unknown level %q", where, c.Level))
		}
		if len(c.Clues) != 3 {
			problems = append(problems, where+": needs exactly 3 clues")
		}
		for _, clue := range c.Clues {
			if strings.Contains(strings.ToLower(clue), c.ID) {
				problems = append(problems, where+": a clue gives the answer away")
			}
		}
		if len(c.Examples) != 3 {
			problems = append(problems, where+": needs exactly 3 examples")
		}
		if c.Summary == "" || c.Explanation == "" || c.Security == "" {
			problems = append(problems, where+": summary, explanation and security are required")
		}
		if c.Lab != "" && !strings.HasPrefix(c.Lab, "https://") {
			problems = append(problems, where+": lab must be an https URL")
		}
		if ch := c.InBook; ch != nil {
			switch {
			case ch.Number < 1 || ch.Number > len(BookChapters):
				problems = append(problems, fmt.Sprintf("%s: the book has chapters 1 to %d", where, len(BookChapters)))
			case ch.Title != BookChapters[ch.Number-1]:
				problems = append(problems, fmt.Sprintf("%s: chapter %d of the book is %q", where, ch.Number, BookChapters[ch.Number-1]))
			}
		}
		b.allowed[c.ID] = true
	}
	if len(problems) > 0 {
		return nil, fmt.Errorf("invalid game data:\n  %s", strings.Join(problems, "\n  "))
	}
	return b, nil
}

// Get returns the command with that id, if it is in the book.
func (b *Book) Get(id string) (*Command, bool) {
	i, ok := b.byID[strings.ToLower(strings.TrimSpace(id))]
	if !ok {
		return nil, false
	}
	return &b.Commands[i], true
}

// Valid reports whether a word may be played as a guess.
func (b *Book) Valid(word string) bool { return b.allowed[word] }

// Words returns every valid guess with n letters, sorted.
func (b *Book) Words(n int) []string {
	var out []string
	for w := range b.allowed {
		if len([]rune(w)) == n {
			out = append(out, w)
		}
	}
	slices.Sort(out)
	return out
}

// Daily returns the answer for day n (1-based). The file order is the
// calendar: new commands are appended, so past and present days never change.
// Once every entry has been used, the days cycle through the list in a fixed
// pseudo-random order.
func (b *Book) Daily(n int) *Command {
	if n < 1 {
		n = 1
	}
	if n <= len(b.Commands) {
		return &b.Commands[n-1]
	}
	h := fnv.New32a()
	fmt.Fprintf(h, "comandle-%d", n)
	return &b.Commands[int(h.Sum32()%uint32(len(b.Commands)))]
}
