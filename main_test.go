package main

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/legiosai/comandle/data"
	"github.com/legiosai/comandle/internal/game"
	"github.com/legiosai/comandle/internal/ui"
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

func TestPracticeArgs(t *testing.T) {
	type o = practiceOpts
	for _, tc := range []struct {
		args []string
		want practiceOpts
		bad  bool
	}{
		{nil, o{}, false},
		{[]string{"nmap"}, o{pick: "nmap"}, false},
		{[]string{"-l", "4"}, o{letters: 4}, false},
		{[]string{"-l5"}, o{letters: 5}, false},
		{[]string{"-l=6"}, o{letters: 6}, false},
		{[]string{"--letras", "4"}, o{letters: 4}, false},
		{[]string{"--letras=4"}, o{letters: 4}, false},
		{[]string{"-c", "redes"}, o{category: "redes"}, false},
		{[]string{"-credes"}, o{category: "redes"}, false},
		{[]string{"-c=redes"}, o{category: "redes"}, false},
		{[]string{"--categoria", "Redes"}, o{category: "redes"}, false},
		{[]string{"--categoría=redes"}, o{category: "redes"}, false},
		{[]string{"-n", "básico"}, o{level: "básico"}, false},
		{[]string{"-n", "basico"}, o{level: "básico"}, false},
		{[]string{"-n", "ba\u0301sico"}, o{level: "básico"}, false},
		{[]string{"-nintermedio"}, o{level: "intermedio"}, false},
		{[]string{"--nivel=AVANZADO"}, o{level: "avanzado"}, false},
		{[]string{"-c", "texto", "-n", "básico", "-l", "4"}, o{letters: 4, category: "texto", level: "básico"}, false},
		{[]string{"nmap", "-l", "4"}, o{}, true},
		{[]string{"nmap", "-c", "redes"}, o{}, true},
		{[]string{"-n", "básico", "nmap"}, o{}, true},
		{[]string{"-l"}, o{}, true},
		{[]string{"-l", "x"}, o{}, true},
		{[]string{"-l", "0"}, o{}, true},
		{[]string{"-c"}, o{}, true},
		{[]string{"-c="}, o{}, true},
		{[]string{"-c", "red"}, o{}, true},
		{[]string{"-n"}, o{}, true},
		{[]string{"-n", "facil"}, o{}, true},
		{[]string{"a", "b"}, o{}, true},
	} {
		got, err := practiceArgs(tc.args)
		if (err != nil) != tc.bad || got != tc.want {
			t.Errorf("practiceArgs(%q) = %+v, %v", tc.args, got, err)
		}
	}
}

// A missing or mistyped category or level lists the valid ones.
func TestPracticeArgsListValues(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"-c"}, "Falta la categoría. Elegí una: " + strings.Join(game.Categories, ", ") + "."},
		{[]string{"-c", "red"}, "«red» no es una categoría. Elegí una: " + strings.Join(game.Categories, ", ") + "."},
		{[]string{"--nivel"}, "Falta el nivel. Elegí uno: básico, intermedio, avanzado."},
		{[]string{"-n", "facil"}, "«facil» no es un nivel. Elegí uno: básico, intermedio, avanzado."},
	} {
		_, err := practiceArgs(tc.args)
		if err == nil || err.Error() != tc.want {
			t.Errorf("practiceArgs(%q) error = %v, want %q", tc.args, err, tc.want)
		}
	}
}

func TestPracticeLetters(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	var out bytes.Buffer
	if code := run([]string{"practica", "-l", "4", "nmap"}, nil, &out, launchDay); code != 2 {
		t.Errorf("-l with a command should exit 2, got %d", code)
	}
	if code := run([]string{"practica", "-l", "99"}, nil, &out, launchDay); code != 1 {
		t.Errorf("no commands of that length should exit 1, got %d", code)
	}
	if code := run([]string{"practica", "-l", "x"}, nil, &out, launchDay); code != 2 {
		t.Errorf("bad -l should exit 2, got %d", code)
	}
}

// practica -c -n only ever picks a command of that category and level.
func TestPracticeFilters(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", t.TempDir())
	t.Setenv("NO_COLOR", "1")
	b, _ := game.Load(data.Commands, data.Allowed)
	for range 30 {
		var out bytes.Buffer
		if code := run([]string{"practica", "-c", "redes", "-n", "basico"}, strings.NewReader("salir\n"), &out, launchDay); code != 0 {
			t.Fatalf("exit %d\n%s", code, out.String())
		}
		got := out.String()
		_, after, ok := strings.Cut(got, "Práctica cortada. Era ")
		if !ok {
			t.Fatalf("no answer in the output:\n%s", got)
		}
		id := strings.TrimSuffix(strings.Fields(after)[0], ".")
		c, ok := b.Get(id)
		if !ok || c.Category != "redes" || c.Level != "básico" {
			t.Fatalf("practica -c redes -n basico played %q", id)
		}
		if !strings.Contains(got, "categoría: redes") {
			t.Errorf("the header should show the category:\n%s", got)
		}
	}

	var out bytes.Buffer
	if code := run([]string{"practica", "-c", "redes", "nmap"}, nil, &out, launchDay); code != 2 {
		t.Errorf("-c with a command should exit 2, got %d", code)
	}
	if code := run([]string{"practica", "-n", "experto"}, nil, &out, launchDay); code != 2 {
		t.Errorf("an unknown level should exit 2, got %d", code)
	}

	// A category and a level with no command between them, if the data has one.
	for _, cat := range game.Categories {
		for _, lvl := range game.Levels {
			if len(practicePool(b.Commands, practiceOpts{category: cat, level: lvl})) > 0 {
				continue
			}
			out.Reset()
			if code := run([]string{"practica", "-c", cat, "-n", lvl}, nil, &out, launchDay); code != 1 {
				t.Errorf("-c %s -n %s has no commands and should exit 1, got %d", cat, lvl, code)
			}
			if want := "No hay comandos con categoría " + cat + " y nivel " + lvl + "."; !strings.Contains(out.String(), want) {
				t.Errorf("output lacks %q:\n%s", want, out.String())
			}
			return
		}
	}
}

// When nothing is left, the hints name the values that would leave something.
func TestNoPracticeHints(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	cmds := []game.Command{
		{ID: "grep", Category: "texto", Level: "básico"},
		{ID: "nmap", Category: "redes", Level: "intermedio"},
		{ID: "tcpdump", Category: "redes", Level: "avanzado"},
	}
	for _, tc := range []struct {
		opts practiceOpts
		want []string
	}{
		{practiceOpts{category: "texto", level: "avanzado"}, []string{
			"No hay comandos con categoría texto y nivel avanzado.",
			"Probá otra categoría: redes.",
			"Probá otro nivel: básico.",
		}},
		{practiceOpts{letters: 5, category: "redes"}, []string{
			"No hay comandos de 5 letras con categoría redes.",
			"Probá otra cantidad de letras: 4, 7.",
		}},
		{practiceOpts{letters: 99}, []string{
			"No hay comandos de 99 letras.",
			"Probá otra cantidad de letras: 4, 7.",
		}},
		{practiceOpts{letters: 5, category: "texto", level: "avanzado"}, []string{
			"No hay comandos de 5 letras con categoría texto y nivel avanzado.",
			"Probá con menos filtros.",
		}},
	} {
		var out bytes.Buffer
		noPractice(cmds, ui.New(&out), tc.opts)
		var lines []string
		for l := range strings.SplitSeq(strings.TrimSpace(out.String()), "\n") {
			lines = append(lines, strings.TrimSpace(l))
		}
		if strings.Join(lines, "\n") != strings.Join(tc.want, "\n") {
			t.Errorf("noPractice(%+v):\n%s\nwant:\n%s", tc.opts, strings.Join(lines, "\n"), strings.Join(tc.want, "\n"))
		}
	}
}
