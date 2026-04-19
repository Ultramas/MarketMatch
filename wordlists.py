<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Realistic Burner Email Generator</title>
</head>
<body>
  <h1>Burner Email Generator (Frontend Only)</h1>
  <button onclick="generateEmails()">Generate 10 Realistic Emails</button>
  <pre id="output"></pre>

  <script src="https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js"></script> <!-- If using Pyodide -->
  <script>
    // Fallback: pure JavaScript version (works everywhere)
    let words = [];
    let adjectives = [];

    // Raw GitHub URLs (public, stable, CORS-friendly)
    const COMMON_WORDS_URL = "https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english.txt";
    const ADJECTIVES_URL   = "https://gist.githubusercontent.com/hugsy/8910dc78d208e40de42deb29e62df913/raw/0f3e5c6e5f8e5b5f0d5e5f5e5f5e5f5e5f5e5f5e/english-adjectives.txt";

    async function loadWordLists() {
      try {
        console.log("Loading expansive word lists...");

        const [wordsRes, adjRes] = await Promise.all([
          fetch(COMMON_WORDS_URL),
          fetch(ADJECTIVES_URL)
        ]);

        const wordsText = await wordsRes.text();
        const adjText   = await adjRes.text();

        // Clean and filter
        words = wordsText
          .split('\n')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length >= 3 && /^[a-z]+$/.test(w));

        adjectives = adjText
          .split('\n')
          .map(w => w.trim().toLowerCase())
          .filter(w => w.length >= 3 && /^[a-z]+$/.test(w));

        console.log(`Loaded ${words.length} common words and ${adjectives.length} adjectives`);
      } catch (e) {
        console.error("Failed to load word lists", e);
        // Fallback small list if fetch fails
        words = ["river","mountain","shadow","star","breeze","wolf","fox","hawk","night","sun","coffee","blue","happy","quick","silent","bright","cool","wild","free"];
        adjectives = ["happy","quick","silent","bright","cool","wild","free","dark","light","deep","soft","strong"];
      }
    }

    function generateRealisticLocal() {
      if (words.length === 0) return "user" + Math.floor(Math.random()*999);

      const separators = [".", "_", "-", ""];
      const patterns = [1, 2, 3, 4];

      const pattern = patterns[Math.floor(Math.random() * patterns.length)];

      let base = "";

      switch(pattern) {
        case 1: // adjective + noun (most natural)
          base = adjectives[Math.floor(Math.random() * adjectives.length)] +
                 separators[Math.floor(Math.random() * separators.length)] +
                 words[Math.floor(Math.random() * words.length)];
          break;

        case 2: // common word + common word
          base = words[Math.floor(Math.random() * words.length)] +
                 separators[Math.floor(Math.random() * separators.length)] +
                 words[Math.floor(Math.random() * words.length)];
          break;

        case 3: // adjective + noun + light number
          base = adjectives[Math.floor(Math.random() * adjectives.length)] +
                 separators[Math.floor(Math.random() * separators.length)] +
                 words[Math.floor(Math.random() * words.length)];
          if (Math.random() > 0.5) {
            const num = Math.random() > 0.6 
              ? String(Math.floor(Math.random()*90) + 10) 
              : String(Math.floor(Math.random()*8) + 2020);
            base += num;
          }
          break;

        default: // two common words
          base = words[Math.floor(Math.random() * words.length)] +
                 separators[Math.floor(Math.random() * separators.length)] +
                 words[Math.floor(Math.random() * words.length)];
      }

      // Occasional extra flair
      if (Math.random() < 0.12) {
        base += separators[Math.floor(Math.random() * separators.length)] +
                words[Math.floor(Math.random() * words.length)];
      }

      return base;
    }

    async function generateEmails() {
      const output = document.getElementById("output");
      output.textContent = "Loading word lists...\n";

      if (words.length === 0) {
        await loadWordLists();
      }

      output.textContent = "Generating realistic burner emails...\n\n";

      const domain = "tempdomain.com";   // ← change to your burner domain

      for (let i = 0; i < 10; i++) {
        const local = generateRealisticLocal();
        const email = local + "@" + domain;
        output.textContent += email + "\n";
      }
    }

    // Auto-load on page start
    window.onload = loadWordLists;
  </script>
</body>
</html>
