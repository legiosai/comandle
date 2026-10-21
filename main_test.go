package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/legiosai/comandle/data"
	"github.com/legiosai/comandle/internal/game"
)

var launchDay = time.Date(2026, 10, 20, 15, 0, 0, 0, game.Argentina)

func TestEmbeddedDataLoads(t *testing.T) {
	b, err := game.Load(data.Commands, data.Allowed)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Commands) < 30 {
		t.Errorf("only %d commands embedded", len(b.Commands))
	}
	for _, c := range b.Commands {
		for _, ex := range c.Examples {
			for _, bad := range []string{"rm -rf", "mkfs", "chmod 777", "chmod -R 777", "of=/dev/"} {
				if strings.Contains(ex.Cmd, bad) {
					t.Errorf("%s: example %q contains %q", c.ID, ex.Cmd, bad)
				}
			}
		}
	}
}

func TestDailyRoundEndToEnd(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	b, _ := game.Load(data.Commands, data.Allowed)
	answer := b.Daily(1).ID

	// A wrong-length guess, an unknown word, then the answer.
	in := strings.NewReader("ab\n" + strings.Repeat("q", len(answer)) + "\n" + answer + "\n")
	var out bytes.Buffer
	if code := run(nil, in, &out, launchDay); code != 0 {
		t.Fatalf("exit %d\n%s", code, out.String())
	}
	got := out.String()
	for _, want := range []string{"comandle #1", "Tiene que tener", "no está en la lista", "¡Bien! Lo sacaste en 1/6.", "Ejemplos", "comandle #1 1/6", "🟩"} {
		if !strings.Contains(got, want) {
			t.Errorf("output lacks %q\n%s", want, got)
		}
	}

	// Playing again the same day shows the result instead of a new round.
	out.Reset()
	run(nil, strings.NewReader(""), &out, launchDay.Add(time.Hour))
	if !strings.Contains(out.String(), "Ya jugaste el de hoy.") {
		t.Errorf("second run should not start a new round:\n%s", out.String())
	}

	out.Reset()
	run([]string{"stats"}, nil, &out, launchDay)
	if !strings.Contains(out.String(), "jugados 1") || !strings.Contains(out.String(), "racha 1") {
		t.Errorf("stats after one win:\n%s", out.String())
	}
}

func TestQuestionMarkListsAllWords(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	var out bytes.Buffer
	run([]string{"practica", "nmap"}, strings.NewReader("?\nkill\nping\n?\nnmap\n"), &out, launchDay)
	got := out.String()
	first := strings.Index(got, "comandos de 4 letras:")
	last := strings.LastIndex(got, "comandos de 4 letras:")
	if first < 0 || first == last {
		t.Fatalf("? should print the list both times:\n%s", got)
	}
	header := func(i int) string { return strings.SplitN(got[i:], "\n", 2)[0] }
	if header(first) != header(last) {
		t.Errorf("the list must not narrow with guesses: %q vs %q", header(first), header(last))
	}
	if !strings.Contains(got, "comandle (práctica) 3/6") {
		t.Errorf("? must not count as a try:\n%s", got)
	}
}

func TestQuitDoesNotRecord(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	var out bytes.Buffer
	run(nil, strings.NewReader("salir\n"), &out, launchDay)
	if !strings.Contains(out.String(), "Quedó a medias") {
		t.Errorf("quitting message missing:\n%s", out.String())
	}
	out.Reset()
	run([]string{"stats"}, nil, &out, launchDay)
	if !strings.Contains(out.String(), "jugados 0") {
		t.Errorf("an abandoned round must not count:\n%s", out.String())
	}
}

func TestExplainListHelp(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	b, _ := game.Load(data.Commands, data.Allowed)
	first := b.Commands[0]

	var out bytes.Buffer
	if code := run([]string{"explicar", strings.ToUpper(first.ID)}, nil, &out, launchDay); code != 0 {
		t.Fatalf("explicar exit %d", code)
	}
	card := out.String()
	firstWords := strings.Join(strings.Fields(first.Summary)[:3], " ")
	if !strings.Contains(card, first.ID) || !strings.Contains(card, firstWords) || !strings.Contains(card, "Ejemplos") || !strings.Contains(card, "Seguridad:") {
		t.Errorf("explicar output:\n%s", out.String())
	}

	out.Reset()
	if code := run([]string{"explicar", "no-existe"}, nil, &out, launchDay); code != 1 {
		t.Errorf("unknown command should exit 1, got %d", code)
	}

	out.Reset()
	run([]string{"lista"}, nil, &out, launchDay.AddDate(0, 0, 3))
	listing := out.String()
	if !strings.Contains(listing, "#1") || !strings.Contains(listing, b.Daily(3).ID) || strings.Contains(listing, "#4   "+b.Daily(4).ID) {
		t.Errorf("lista should show past days and hide today:\n%s", listing)
	}

	out.Reset()
	if code := run([]string{"cualquiera"}, nil, &out, launchDay); code != 2 || !strings.Contains(out.String(), "comandle practica") {
		t.Errorf("unknown subcommand should print help and exit 2")
	}
}

func TestPracticeWithACommand(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	var out bytes.Buffer
	if code := run([]string{"practica", "nmap"}, strings.NewReader("nmap\n"), &out, launchDay); code != 0 {
		t.Fatalf("exit %d\n%s", code, out.String())
	}
	if !strings.Contains(out.String(), "comandle (práctica) 1/6") {
		t.Errorf("practice share line missing:\n%s", out.String())
	}
	out.Reset()
	run([]string{"stats"}, nil, &out, launchDay)
	if !strings.Contains(out.String(), "jugados 0") {
		t.Errorf("practice must not count:\n%s", out.String())
	}
	if code := run([]string{"practica", "nope"}, nil, &out, launchDay); code != 1 {
		t.Errorf("unknown practice command should exit 1, got %d", code)
	}
}
