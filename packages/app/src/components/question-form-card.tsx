import { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Platform } from "react-native";
import { StyleSheet, useUnistyles, UnistylesRuntime } from "react-native-unistyles";
import { Check, CircleHelp, X } from "lucide-react-native";
import type { PendingPermission } from "@/types/shared";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import type { AgentPermissionResponse } from "@server/server/agent/agent-sdk-types";
import {
  applyQuestionShortcutSelection,
  areAllQuestionsAnswered,
  buildQuestionAnswers,
  findFirstUnansweredQuestionIndex,
  parseQuestions,
  setQuestionOtherText,
  toggleQuestionOption,
  type QuestionOtherTexts,
  type QuestionSelections,
} from "./question-form-card.utils";

interface QuestionFormCardProps {
  permission: PendingPermission;
  onRespond: (response: AgentPermissionResponse) => void;
  isResponding: boolean;
}

export interface QuestionFormCardHandle {
  selectOption(index: number): boolean;
}

const IS_WEB = Platform.OS === "web";

export const QuestionFormCard = forwardRef<QuestionFormCardHandle, QuestionFormCardProps>(
  function QuestionFormCard({ permission, onRespond, isResponding }, ref) {
    const { theme } = useUnistyles();
    const isMobile = UnistylesRuntime.breakpoint === "xs" || UnistylesRuntime.breakpoint === "sm";
    const questions = parseQuestions(permission.request.input);
    const firstOptionShortcut = useShortcutKeys("agent-prompt-select-1");
    const secondOptionShortcut = useShortcutKeys("agent-prompt-select-2");
    const thirdOptionShortcut = useShortcutKeys("agent-prompt-select-3");
    const optionShortcuts = [
      firstOptionShortcut,
      secondOptionShortcut,
      thirdOptionShortcut,
    ] as const;

    const [selections, setSelections] = useState<QuestionSelections>({});
    const [otherTexts, setOtherTexts] = useState<QuestionOtherTexts>({});
    const [respondingAction, setRespondingAction] = useState<"submit" | "dismiss" | null>(null);

    const applyAnswerState = useCallback(
      (next: { selections: QuestionSelections; otherTexts: QuestionOtherTexts }) => {
        setSelections(next.selections);
        setOtherTexts(next.otherTexts);
      },
      [],
    );

    const submitResponses = useCallback(
      (nextSelections: QuestionSelections, nextOtherTexts: QuestionOtherTexts) => {
        if (!questions) {
          return;
        }
        setRespondingAction("submit");
        const answers = buildQuestionAnswers({
          questions,
          selections: nextSelections,
          otherTexts: nextOtherTexts,
        });

        onRespond({
          behavior: "allow",
          updatedInput: { ...permission.request.input, answers },
        });
      },
      [onRespond, permission.request.input, questions],
    );

    const toggleOption = useCallback(
      (questionIndex: number, optionIndex: number) => {
        if (!questions) {
          return;
        }
        applyAnswerState(
          toggleQuestionOption({
            questions,
            selections,
            otherTexts,
            questionIndex,
            optionIndex,
          }),
        );
      },
      [applyAnswerState, otherTexts, questions, selections],
    );

    const setOtherText = useCallback(
      (questionIndex: number, text: string) => {
        applyAnswerState(
          setQuestionOtherText({
            selections,
            otherTexts,
            questionIndex,
            text,
          }),
        );
      },
      [applyAnswerState, otherTexts, selections],
    );

    const handleSubmit = useCallback(() => {
      submitResponses(selections, otherTexts);
    }, [otherTexts, selections, submitResponses]);

    const handleDeny = useCallback(() => {
      setRespondingAction("dismiss");
      onRespond({
        behavior: "deny",
        message: "Dismissed by user",
      });
    }, [onRespond]);

    useImperativeHandle(
      ref,
      () => ({
        selectOption(index: number) {
          if (isResponding || !questions) {
            return false;
          }

          const result = applyQuestionShortcutSelection({
            questions,
            selections,
            otherTexts,
            optionIndex: index - 1,
          });
          if (!result.applied) {
            return false;
          }

          applyAnswerState({
            selections: result.selections,
            otherTexts: result.otherTexts,
          });
          if (result.shouldAutoSubmit) {
            submitResponses(result.selections, result.otherTexts);
          }
          return true;
        },
      }),
      [applyAnswerState, isResponding, otherTexts, questions, selections, submitResponses],
    );

    if (!questions) {
      return null;
    }

    const activeShortcutQuestionIndex = findFirstUnansweredQuestionIndex({
      questions,
      selections,
      otherTexts,
    });
    const allAnswered = areAllQuestionsAnswered({
      questions,
      selections,
      otherTexts,
    });

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.border,
          },
        ]}
      >
        {questions.map((q, qIndex) => {
          const selected = selections[qIndex] ?? new Set<number>();
          const otherText = otherTexts[qIndex] ?? "";

          return (
            <View key={qIndex} style={styles.questionBlock}>
              <View style={styles.questionHeader}>
                <Text style={[styles.questionText, { color: theme.colors.foreground }]}>
                  {q.question}
                </Text>
                <CircleHelp size={14} color={theme.colors.foregroundMuted} />
              </View>
              <View style={styles.optionsWrap}>
                {q.options.map((opt, optIndex) => {
                  const isSelected = selected.has(optIndex);
                  const shortcutKeys =
                    activeShortcutQuestionIndex === qIndex
                      ? optionShortcuts[optIndex] ?? null
                      : null;
                  return (
                    <Pressable
                      key={optIndex}
                      style={({ pressed, hovered = false }) => [
                        styles.optionItem,
                        (hovered || isSelected) && {
                          backgroundColor: theme.colors.surface2,
                        },
                        pressed && styles.optionItemPressed,
                      ]}
                      onPress={() => toggleOption(qIndex, optIndex)}
                      disabled={isResponding}
                    >
                      <View style={styles.optionItemContent}>
                        <View style={styles.optionTextBlock}>
                          <Text style={[styles.optionLabel, { color: theme.colors.foreground }]}>
                            {opt.label}
                          </Text>
                          {opt.description ? (
                            <Text
                              style={[
                                styles.optionDescription,
                                { color: theme.colors.foregroundMuted },
                              ]}
                            >
                              {opt.description}
                            </Text>
                          ) : null}
                        </View>
                        {shortcutKeys ? (
                          <Shortcut chord={shortcutKeys} style={styles.optionShortcut} />
                        ) : null}
                        {isSelected ? (
                          <View style={styles.optionCheckSlot}>
                            <Check size={16} color={theme.colors.foregroundMuted} />
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              <TextInput
                style={[
                  styles.otherInput,
                  {
                    borderColor:
                      otherText.length > 0 ? theme.colors.borderAccent : theme.colors.border,
                    color: theme.colors.foreground,
                    backgroundColor: theme.colors.surface2,
                  },
                  // @ts-expect-error - outlineStyle is web-only
                  IS_WEB && {
                    outlineStyle: "none",
                    outlineWidth: 0,
                    outlineColor: "transparent",
                  },
                ]}
                placeholder="Other..."
                placeholderTextColor={theme.colors.foregroundMuted}
                value={otherText}
                onChangeText={(text) => setOtherText(qIndex, text)}
                editable={!isResponding}
              />
            </View>
          );
        })}

        <View style={[styles.actionsContainer, !isMobile && styles.actionsContainerDesktop]}>
          <Pressable
            style={({ pressed, hovered = false }) => [
              styles.actionButton,
              {
                backgroundColor: hovered ? theme.colors.surface2 : theme.colors.surface1,
                borderColor: theme.colors.borderAccent,
              },
              pressed && styles.optionItemPressed,
            ]}
            onPress={handleDeny}
            disabled={isResponding}
          >
            {respondingAction === "dismiss" ? (
              <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
            ) : (
              <View style={styles.actionContent}>
                <X size={14} color={theme.colors.foregroundMuted} />
                <Text style={[styles.actionText, { color: theme.colors.foregroundMuted }]}>
                  Dismiss
                </Text>
              </View>
            )}
          </Pressable>

          <Pressable
            style={({ pressed, hovered = false }) => {
              const disabled = !allAnswered || isResponding;
              return [
                styles.actionButton,
                {
                  backgroundColor:
                    hovered && !disabled ? theme.colors.surface2 : theme.colors.surface1,
                  borderColor: disabled ? theme.colors.border : theme.colors.borderAccent,
                  opacity: disabled ? 0.5 : 1,
                },
                pressed && !disabled ? styles.optionItemPressed : null,
              ];
            }}
            onPress={handleSubmit}
            disabled={!allAnswered || isResponding}
          >
            {respondingAction === "submit" ? (
              <ActivityIndicator size="small" color={theme.colors.foreground} />
            ) : (
              <View style={styles.actionContent}>
                <Check
                  size={14}
                  color={allAnswered ? theme.colors.foreground : theme.colors.foregroundMuted}
                />
                <Text
                  style={[
                    styles.actionText,
                    {
                      color: allAnswered ? theme.colors.foreground : theme.colors.foregroundMuted,
                    },
                  ]}
                >
                  Submit
                </Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[3],
    borderRadius: theme.spacing[2],
    borderWidth: 1,
    gap: theme.spacing[3],
  },
  questionBlock: {
    gap: theme.spacing[2],
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  questionText: {
    flex: 1,
    fontSize: theme.fontSize.base,
    lineHeight: 22,
  },
  optionsWrap: {
    gap: theme.spacing[1],
  },
  optionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  optionItemPressed: {
    opacity: 0.9,
  },
  optionItemContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  optionTextBlock: {
    flex: 1,
    gap: 2,
  },
  optionShortcut: {},
  optionLabel: {
    fontSize: theme.fontSize.sm,
  },
  optionDescription: {
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  optionCheckSlot: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  otherInput: {
    borderWidth: 1,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
  },
  actionsContainer: {
    gap: theme.spacing[2],
  },
  actionsContainerDesktop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
  },
  actionButton: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    borderWidth: theme.borderWidth[1],
  },
  actionContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionText: {
    fontSize: theme.fontSize.sm,
  },
}));
