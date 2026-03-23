export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export type QuestionSelections = Record<number, Set<number>>;
export type QuestionOtherTexts = Record<number, string>;

type QuestionAnswerState = {
  questions: readonly Question[];
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
};

function cloneSelections(input: QuestionSelections): QuestionSelections {
  const next: QuestionSelections = {};
  for (const [key, value] of Object.entries(input)) {
    next[Number(key)] = new Set(value);
  }
  return next;
}

function cloneOtherTexts(input: QuestionOtherTexts): QuestionOtherTexts {
  return { ...input };
}

function isQuestionAnswered(input: {
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  questionIndex: number;
}): boolean {
  const selected = input.selections[input.questionIndex];
  const otherText = input.otherTexts[input.questionIndex]?.trim();
  return (selected && selected.size > 0) || Boolean(otherText && otherText.length > 0);
}

export function parseQuestions(input: unknown): Question[] | null {
  if (
    typeof input !== "object" ||
    input === null ||
    !("questions" in input) ||
    !Array.isArray((input as Record<string, unknown>).questions)
  ) {
    return null;
  }

  const raw = (input as Record<string, unknown>).questions as unknown[];
  const questions: Question[] = [];

  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const question = item as Record<string, unknown>;
    if (typeof question.question !== "string" || typeof question.header !== "string") {
      return null;
    }
    if (!Array.isArray(question.options)) {
      return null;
    }

    const options: QuestionOption[] = [];
    for (const option of question.options as unknown[]) {
      if (typeof option !== "object" || option === null) return null;
      const candidate = option as Record<string, unknown>;
      if (typeof candidate.label !== "string") return null;
      options.push({
        label: candidate.label,
        description: typeof candidate.description === "string" ? candidate.description : undefined,
      });
    }

    questions.push({
      question: question.question,
      header: question.header,
      options,
      multiSelect: question.multiSelect === true,
    });
  }

  return questions.length > 0 ? questions : null;
}

export function areAllQuestionsAnswered(input: QuestionAnswerState): boolean {
  return input.questions.every((_, questionIndex) =>
    isQuestionAnswered({
      selections: input.selections,
      otherTexts: input.otherTexts,
      questionIndex,
    }),
  );
}

export function findFirstUnansweredQuestionIndex(input: QuestionAnswerState): number | null {
  for (let questionIndex = 0; questionIndex < input.questions.length; questionIndex += 1) {
    if (
      !isQuestionAnswered({
        selections: input.selections,
        otherTexts: input.otherTexts,
        questionIndex,
      })
    ) {
      return questionIndex;
    }
  }
  return null;
}

export function toggleQuestionOption(input: {
  questions: readonly Question[];
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  questionIndex: number;
  optionIndex: number;
}): {
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
} {
  const question = input.questions[input.questionIndex];
  if (!question || !question.options[input.optionIndex]) {
    return {
      selections: input.selections,
      otherTexts: input.otherTexts,
    };
  }

  const selections = cloneSelections(input.selections);
  const otherTexts = cloneOtherTexts(input.otherTexts);
  const current = selections[input.questionIndex] ?? new Set<number>();
  const next = new Set(current);

  if (question.multiSelect) {
    if (next.has(input.optionIndex)) {
      next.delete(input.optionIndex);
    } else {
      next.add(input.optionIndex);
    }
  } else if (next.has(input.optionIndex)) {
    next.clear();
  } else {
    next.clear();
    next.add(input.optionIndex);
  }

  selections[input.questionIndex] = next;
  delete otherTexts[input.questionIndex];

  return { selections, otherTexts };
}

export function setQuestionOtherText(input: {
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  questionIndex: number;
  text: string;
}): {
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
} {
  const selections = cloneSelections(input.selections);
  const otherTexts = cloneOtherTexts(input.otherTexts);

  otherTexts[input.questionIndex] = input.text;
  if (input.text.length > 0) {
    selections[input.questionIndex] = new Set<number>();
  }

  return { selections, otherTexts };
}

export function buildQuestionAnswers(input: QuestionAnswerState): Record<string, string> {
  const answers: Record<string, string> = {};

  for (let questionIndex = 0; questionIndex < input.questions.length; questionIndex += 1) {
    const question = input.questions[questionIndex];
    if (!question) {
      continue;
    }

    const selected = input.selections[questionIndex];
    const otherText = input.otherTexts[questionIndex]?.trim();

    if (otherText && otherText.length > 0) {
      answers[question.header] = otherText;
      continue;
    }

    if (!selected || selected.size === 0) {
      continue;
    }

    const labels = Array.from(selected)
      .map((optionIndex) => question.options[optionIndex]?.label)
      .filter((label): label is string => typeof label === "string");
    if (labels.length > 0) {
      answers[question.header] = labels.join(", ");
    }
  }

  return answers;
}

export function applyQuestionShortcutSelection(input: {
  questions: readonly Question[];
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  optionIndex: number;
}): {
  applied: boolean;
  selections: QuestionSelections;
  otherTexts: QuestionOtherTexts;
  shouldAutoSubmit: boolean;
  questionIndex: number | null;
} {
  const questionIndex = findFirstUnansweredQuestionIndex({
    questions: input.questions,
    selections: input.selections,
    otherTexts: input.otherTexts,
  });
  if (questionIndex === null) {
    return {
      applied: false,
      selections: input.selections,
      otherTexts: input.otherTexts,
      shouldAutoSubmit: false,
      questionIndex: null,
    };
  }

  const question = input.questions[questionIndex];
  if (!question || !question.options[input.optionIndex]) {
    return {
      applied: false,
      selections: input.selections,
      otherTexts: input.otherTexts,
      shouldAutoSubmit: false,
      questionIndex,
    };
  }

  const next = toggleQuestionOption({
    questions: input.questions,
    selections: input.selections,
    otherTexts: input.otherTexts,
    questionIndex,
    optionIndex: input.optionIndex,
  });

  return {
    applied: true,
    selections: next.selections,
    otherTexts: next.otherTexts,
    shouldAutoSubmit:
      areAllQuestionsAnswered({
        questions: input.questions,
        selections: next.selections,
        otherTexts: next.otherTexts,
      }) && input.questions.every((candidate) => candidate.multiSelect !== true),
    questionIndex,
  };
}
