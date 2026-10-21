package game

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// MaxTries is how many guesses a round allows.
const MaxTries = 6

// Mark is the feedback for one letter of a guess.
type Mark int

const (
	Absent  Mark = iota // the letter is not in the answer (or not that many times)
	Present             // the letter is in the answer, somewhere else
	Correct             // right letter, right place
)

// Launch is day #1, at midnight in Argentina. The game day changes at
// midnight Argentina time for everyone; Argentina has no daylight saving.
var (
	Argentina = time.FixedZone("ART", -3*60*60)
	Launch    = time.Date(2026, time.October, 20, 0, 0, 0, 0, Argentina)
)

// DayNumber returns the comandle number for an instant (1 on launch day).
func DayNumber(t time.Time) int {
	t = t.In(Argentina)
	day := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, Argentina)
	n := int(day.Sub(Launch).Hours()/24) + 1
	if n < 1 {
		return 1
	}
	return n
}

// NextDay returns when the next comandle starts after t.
func NextDay(t time.Time) time.Time {
	t = t.In(Argentina)
	return time.Date(t.Year(), t.Month(), t.Day()+1, 0, 0, 0, 0, Argentina)
}

// Score compares a guess with the answer, Wordle style. A letter counts as
// Present only as many times as it still appears in the answer after the
// exact matches are taken out, so "mama" against "mamo" marks one 'a', not two.
func Score(guess, answer string) []Mark {
	g, a := []rune(guess), []rune(answer)
	marks := make([]Mark, len(g))
	left := map[rune]int{}
	for i := range g {
		if i < len(a) && g[i] == a[i] {
			marks[i] = Correct
			continue
		}
		if i < len(a) {
			left[a[i]]++
		}
	}
	for i := range g {
		if marks[i] == Correct {
			continue
		}
		if left[g[i]] > 0 {
			marks[i] = Present
			left[g[i]]--
		}
	}
	return marks
}

// Errors a guess can be rejected with. The round does not count them.
var (
	ErrLength   = errors.New("wrong length")
	ErrUnknown  = errors.New("not a known command")
	ErrRepeated = errors.New("already tried")
	ErrOver     = errors.New("the round is over")
)

// Round is one game in progress.
type Round struct {
	Answer  *Command
	Guesses []string
	Marks   [][]Mark
	book    *Book
}

// NewRound starts a round for an answer.
func NewRound(b *Book, answer *Command) *Round {
	return &Round{Answer: answer, book: b}
}

// Try plays a guess. A rejected guess returns an error and is not counted.
func (r *Round) Try(guess string) ([]Mark, error) {
	guess = strings.ToLower(strings.TrimSpace(guess))
	if r.Over() {
		return nil, ErrOver
	}
	if len([]rune(guess)) != len([]rune(r.Answer.ID)) {
		return nil, fmt.Errorf("%w: %d", ErrLength, len([]rune(r.Answer.ID)))
	}
	for _, prev := range r.Guesses {
		if prev == guess {
			return nil, ErrRepeated
		}
	}
	if !r.book.Valid(guess) {
		return nil, ErrUnknown
	}
	m := Score(guess, r.Answer.ID)
	r.Guesses = append(r.Guesses, guess)
	r.Marks = append(r.Marks, m)
	return m, nil
}

// Won reports whether the last guess was the answer.
func (r *Round) Won() bool {
	return len(r.Guesses) > 0 && r.Guesses[len(r.Guesses)-1] == r.Answer.ID
}

// Over reports whether the round has ended, won or lost.
func (r *Round) Over() bool { return r.Won() || len(r.Guesses) >= MaxTries }

// CluesVisible is how many clues the player sees: one after two misses, two
// after four, all three after five.
func (r *Round) CluesVisible() int {
	misses := len(r.Guesses)
	if r.Won() {
		misses--
	}
	switch {
	case misses >= 5:
		return 3
	case misses >= 4:
		return 2
	case misses >= 2:
		return 1
	}
	return 0
}

// LetterState summarizes what the player has learned about each letter: the
// best mark it got in any guess.
func (r *Round) LetterState() map[rune]Mark {
	state := map[rune]Mark{}
	for i, g := range r.Guesses {
		for j, ch := range []rune(g) {
			m := r.Marks[i][j]
			if cur, ok := state[ch]; !ok || m > cur {
				state[ch] = m
			}
		}
	}
	return state
}

// Words lists every valid guess with the answer's length. It is a reference
// list, not a hint: it does not narrow with the feedback from past guesses.
func (r *Round) Words() []string { return r.book.Words(len([]rune(r.Answer.ID))) }

// Share is the spoiler-free result to paste on social media.
func (r *Round) Share(day int, practice bool) string {
	score := "X"
	if r.Won() {
		score = fmt.Sprint(len(r.Guesses))
	}
	title := fmt.Sprintf("comandle #%d %s/%d", day, score, MaxTries)
	if practice {
		title = fmt.Sprintf("comandle (práctica) %s/%d", score, MaxTries)
	}
	var sb strings.Builder
	sb.WriteString(title)
	sb.WriteString("\n")
	for _, row := range r.Marks {
		for _, m := range row {
			switch m {
			case Correct:
				sb.WriteString("🟩")
			case Present:
				sb.WriteString("🟨")
			default:
				sb.WriteString("⬛")
			}
		}
		sb.WriteString("\n")
	}
	sb.WriteString("comandle.valentorassa.com")
	return sb.String()
}
