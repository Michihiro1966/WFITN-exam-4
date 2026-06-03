'use strict';

const questions = require('../data/questions.json');

function normalizeSelection(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(['a', 'b', 'c', 'd', 'e']);
  return Array.from(new Set(value.map(v => String(v).toLowerCase()).filter(v => allowed.has(v)))).sort();
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function scoreAnswers(answersByQuestionId) {
  const details = questions.map(question => {
    const selected = normalizeSelection(answersByQuestionId[String(question.id)] || answersByQuestionId[question.id] || []);
    const correct = normalizeSelection(question.correct);
    const isCorrect = arraysEqual(selected, correct);
    return {
      questionId: question.id,
      selected,
      correct,
      isCorrect
    };
  });

  const score = details.filter(detail => detail.isCorrect).length;
  return { score, total: questions.length, details };
}

function cohortStats(scores) {
  if (!scores.length) return { mean: 0, sd: 0 };
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const variance = scores.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / scores.length;
  return { mean, sd: Math.sqrt(variance) };
}

function deviationValue(score, mean, sd) {
  if (!Number.isFinite(sd) || sd === 0) return 50;
  return 50 + 10 * ((score - mean) / sd);
}

function publicQuestions() {
  return questions.map(question => ({
    id: question.id,
    section: question.section,
    prompt: question.prompt,
    selectCount: question.selectCount,
    options: question.options
  }));
}

module.exports = {
  questions,
  normalizeSelection,
  scoreAnswers,
  cohortStats,
  deviationValue,
  publicQuestions
};
