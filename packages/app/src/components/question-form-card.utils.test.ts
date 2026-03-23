import { describe, expect, it } from "vitest";

import {
  applyQuestionShortcutSelection,
  areAllQuestionsAnswered,
  buildQuestionAnswers,
  findFirstUnansweredQuestionIndex,
  parseQuestions,
  type Question,
  type QuestionOtherTexts,
  type QuestionSelections,
} from "./question-form-card.utils";

const singleChoiceQuestions: Question[] = [
  {
    header: "deploy_target",
    question: "Where should this go?",
    multiSelect: false,
    options: [{ label: "Production" }, { label: "Staging" }, { label: "Preview" }],
  },
  {
    header: "rollout",
    question: "How should I roll this out?",
    multiSelect: false,
    options: [{ label: "Gradual" }, { label: "Immediate" }],
  },
];

function selections(
  input: Array<[number, number[]]> = [],
): QuestionSelections {
  return Object.fromEntries(
    input.map(([questionIndex, optionIndices]) => [questionIndex, new Set(optionIndices)]),
  ) as QuestionSelections;
}

function otherTexts(input: Array<[number, string]> = []): QuestionOtherTexts {
  return Object.fromEntries(input) as QuestionOtherTexts;
}

describe("question-form-card utils", () => {
  it("parses structured question input", () => {
    expect(
      parseQuestions({
        questions: [
          {
            header: "approval",
            question: "Proceed?",
            options: [{ label: "Yes", description: "Ship it" }, { label: "No" }],
          },
        ],
      }),
    ).toEqual([
      {
        header: "approval",
        question: "Proceed?",
        multiSelect: false,
        options: [{ label: "Yes", description: "Ship it" }, { label: "No" }],
      },
    ]);
  });

  it("selects the first unanswered question when using shortcut options", () => {
    const result = applyQuestionShortcutSelection({
      questions: singleChoiceQuestions,
      selections: selections([[0, [1]]]),
      otherTexts: {},
      optionIndex: 0,
    });

    expect(result.applied).toBe(true);
    expect(result.questionIndex).toBe(1);
    expect(result.shouldAutoSubmit).toBe(true);
    expect(result.selections[1]).toEqual(new Set([0]));
  });

  it("does not auto-submit multi-select questionnaires", () => {
    const result = applyQuestionShortcutSelection({
      questions: [
        {
          header: "files",
          question: "Which files should I include?",
          multiSelect: true,
          options: [{ label: "src" }, { label: "docs" }],
        },
      ],
      selections: {},
      otherTexts: {},
      optionIndex: 1,
    });

    expect(result.applied).toBe(true);
    expect(result.shouldAutoSubmit).toBe(false);
    expect(result.selections[0]).toEqual(new Set([1]));
  });

  it("tracks unanswered questions from selections and freeform answers", () => {
    expect(
      findFirstUnansweredQuestionIndex({
        questions: singleChoiceQuestions,
        selections: selections([[0, [2]]]),
        otherTexts: otherTexts([[1, "later"]]),
      }),
    ).toBeNull();

    expect(
      areAllQuestionsAnswered({
        questions: singleChoiceQuestions,
        selections: selections([[0, [2]]]),
        otherTexts: otherTexts([[1, "later"]]),
      }),
    ).toBe(true);
  });

  it("builds answers from selected options and trimmed other text", () => {
    expect(
      buildQuestionAnswers({
        questions: singleChoiceQuestions,
        selections: selections([[0, [0]], [1, [1]]]),
        otherTexts: otherTexts([[1, "  manual rollout  "]]),
      }),
    ).toEqual({
      deploy_target: "Production",
      rollout: "manual rollout",
    });
  });
});
