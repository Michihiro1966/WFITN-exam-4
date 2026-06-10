'use strict';

// Builds data/questions.json from the Markdown question bank.
//
// Usage: node src/build_questions.js [path-to-md]
// Default source: cerebrovascular_MCQ_select1or2_variant_R4.md (repo root)
//
// The Markdown format expected per question:
//   **Q1.** <prompt> **(Select TWO.)**
//
//   a. option text
//   b. option text
//   ...
//
//   > **Answer: b, c.** <explanation...>
//   > **Source:** <optional source line>

const fs = require('fs');
const path = require('path');

const ALLOWED = ['a', 'b', 'c', 'd', 'e'];

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const questions = [];
  let section = '';
  let current = null;
  let answerOpen = false;

  const flush = () => {
    if (current) {
      questions.push(current);
      current = null;
    }
    answerOpen = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    const sectionMatch = line.match(/^##\s+(Section\s+.+)$/);
    if (sectionMatch) {
      flush();
      section = sectionMatch[1].trim();
      continue;
    }

    const questionMatch = line.match(/^\*\*Q(\d+)\.\*\*\s*(.*)$/);
    if (questionMatch) {
      flush();
      const id = Number.parseInt(questionMatch[1], 10);
      let prompt = questionMatch[2].trim();
      let selectCount = null;
      const selectMatch = prompt.match(/\*\*\(Select\s+(ONE|TWO)\.?\)\*\*\s*$/i);
      if (selectMatch) {
        selectCount = selectMatch[1].toUpperCase() === 'TWO' ? 2 : 1;
        prompt = prompt.replace(/\*\*\(Select\s+(?:ONE|TWO)\.?\)\*\*\s*$/i, '').trim();
      }
      current = { id, section, prompt, selectCount, options: [], correct: [], explanation: '', source: '' };
      continue;
    }

    if (!current) continue;

    // Answer / explanation blockquote lines.
    const answerMatch = line.match(/^>\s*\*\*Answer:\s*([^*]+?)\s*\*\*\s*(.*)$/i);
    if (answerMatch) {
      const letters = answerMatch[1]
        .replace(/\.\s*$/, '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(s => ALLOWED.includes(s));
      current.correct = letters;
      current.explanation = answerMatch[2].trim();
      answerOpen = true;
      continue;
    }

    const sourceMatch = line.match(/^>\s*\*\*Source:\*\*\s*(.*)$/i);
    if (sourceMatch) {
      current.source = sourceMatch[1].trim();
      answerOpen = false;
      continue;
    }

    if (answerOpen) {
      const cont = line.match(/^>\s?(.*)$/);
      if (cont) {
        const text = cont[1].trim();
        if (text) current.explanation += (current.explanation ? ' ' : '') + text;
        continue;
      }
      answerOpen = false;
    }

    // Option lines: "a. text"
    const optionMatch = line.match(/^([a-e])\.\s+(.*)$/);
    if (optionMatch && current.correct.length === 0) {
      current.options.push({ key: optionMatch[1].toLowerCase(), text: optionMatch[2].trim() });
    }
  }
  flush();

  // Fill selectCount from answer length when not stated explicitly.
  for (const q of questions) {
    if (!q.selectCount) q.selectCount = q.correct.length === 2 ? 2 : 1;
    if (!q.source) delete q.source;
  }

  return questions;
}

function validate(questions) {
  const errors = [];
  if (questions.length !== 40) errors.push(`Expected 40 questions; found ${questions.length}`);
  questions.forEach((q, index) => {
    if (q.id !== index + 1) errors.push(`Question order mismatch at position ${index + 1}: Q${q.id}`);
    if (!q.prompt) errors.push(`Q${q.id}: missing prompt`);
    if (q.options.length !== 5) errors.push(`Q${q.id}: expected 5 options, found ${q.options.length}`);
    const keys = q.options.map(o => o.key).join(',');
    if (keys !== 'a,b,c,d,e') errors.push(`Q${q.id}: option keys are "${keys}"`);
    if (q.correct.length < 1 || q.correct.length > 2) errors.push(`Q${q.id}: ${q.correct.length} correct answers`);
    if (q.correct.length !== q.selectCount) errors.push(`Q${q.id}: selectCount ${q.selectCount} != correct length ${q.correct.length}`);
    if (!q.explanation) errors.push(`Q${q.id}: missing explanation`);
  });
  return errors;
}

function main() {
  const source = process.argv[2] || path.join(__dirname, '..', 'cerebrovascular_MCQ_select1or2_variant_R4.md');
  const md = fs.readFileSync(source, 'utf8');
  const questions = parseMarkdown(md);
  const errors = validate(questions);
  if (errors.length) {
    console.error('Validation failed:\n' + errors.join('\n'));
    process.exit(1);
  }
  const outPath = path.join(__dirname, '..', 'data', 'questions.json');
  fs.writeFileSync(outPath, JSON.stringify(questions, null, 2) + '\n');
  console.log(`OK: wrote ${questions.length} questions to ${path.relative(path.join(__dirname, '..'), outPath)} from ${path.basename(source)}`);
}

main();
