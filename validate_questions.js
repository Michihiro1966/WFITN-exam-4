'use strict';

const questions = require('../data/questions.json');

const errors = [];
if (questions.length !== 40) errors.push(`Expected 40 questions; found ${questions.length}`);
questions.forEach((q, index) => {
  if (q.id !== index + 1) errors.push(`Question index mismatch at position ${index + 1}: Q${q.id}`);
  if (!q.prompt) errors.push(`Q${q.id}: missing prompt`);
  if (!Array.isArray(q.options) || q.options.length !== 5) errors.push(`Q${q.id}: expected five options`);
  if (!Array.isArray(q.correct) || !q.correct.length) errors.push(`Q${q.id}: missing answer key`);
  if (![1, 2].includes(q.selectCount)) errors.push(`Q${q.id}: selectCount must be 1 or 2`);
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('OK: 40 questions validated.');
