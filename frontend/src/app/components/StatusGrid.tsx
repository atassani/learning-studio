import { useEffect } from 'react';
import { QuestionType, AreaType } from '../types';
import { groupBySection, formatRichText } from '../utils';
import {
  EMOJI_SUCCESS,
  EMOJI_FAIL,
  EMOJI_ASK,
  EMOJI_SECTION,
  EMOJI_PROGRESS,
  EMOJI_DONE,
} from '../constants';
import { useI18n } from '../i18n/I18nProvider';
import { normalizeTrueFalseValue } from '../trueFalse';

interface StatusGridProps {
  selectedArea: AreaType | null;
  questions: QuestionType[];
  status: Record<number, 'correct' | 'fail' | 'pending'>;
  userAnswers: Record<number, string>;
  currentQuizType: 'True False' | 'Multiple Choice' | null;
  handleContinue: (option: string) => void;
  pendingQuestions: () => [number, QuestionType][];
  resetQuiz: () => void;
  setShowAreaSelection: (show: boolean) => void;
  setShowStatus: (show: boolean) => void;
  setShowResult: (result: null | { correct: boolean; explanation: string }) => void;
  originalSectionOrder: string[];
  selectedFailedQuestionNumber: number | null;
  onOpenFailedQuestion: (questionNumber: number) => void;
  onCloseFailedQuestion: () => void;
}

// Helper to display MCQ answer as "A) Option 1."
export function getUserAnswerDisplay(userAnswer: string, options?: string[]): string {
  if (!userAnswer) return '';
  if (options) {
    const index = options.findIndex((option) => option === userAnswer);
    const letter = index >= 0 ? String.fromCharCode(65 + index) : userAnswer.toUpperCase();
    const optionText = index >= 0 ? options[index] : userAnswer;
    return `${letter}) ${optionText}.`;
  }
  return userAnswer;
}

export function StatusGrid({
  selectedArea,
  questions,
  status,
  userAnswers,
  currentQuizType,
  handleContinue,
  pendingQuestions,
  resetQuiz,
  setShowAreaSelection,
  setShowStatus,
  setShowResult,
  originalSectionOrder,
  selectedFailedQuestionNumber,
  onOpenFailedQuestion,
  onCloseFailedQuestion,
}: StatusGridProps) {
  const { t } = useI18n();
  const selectedQuestion =
    selectedFailedQuestionNumber === null
      ? null
      : questions.find(
          (question) =>
            question.number === selectedFailedQuestionNumber && status[question.index] === 'fail'
        ) || null;

  // Prevent body scroll when overlay is open
  useEffect(() => {
    if (selectedQuestion) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [selectedQuestion]);

  // Close overlay with Esc key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedQuestion) {
        onCloseFailedQuestion();
      }
    };

    if (selectedQuestion) {
      document.addEventListener('keydown', handleKeyDown);
    }

    // Cleanup function to remove event listener
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedQuestion, onCloseFailedQuestion]);

  const grouped = groupBySection(questions);
  const correctCount = Object.values(status).filter((s) => s === 'correct').length;
  const failCount = Object.values(status).filter((s) => s === 'fail').length;
  const pendingCount = questions.length - (correctCount + failCount);

  const actionButtons = (
    <div className="flex gap-4 mt-6">
      <button
        className="px-4 py-2 bg-blue-600 text-white rounded"
        data-testid="status-continue-button"
        onClick={() => handleContinue('C')}
        disabled={pendingQuestions().length === 0}
        aria-label={t('common.continue')}
      >
        {pendingQuestions().length === 0
          ? `${EMOJI_DONE} ${t('status.completedButton')}`
          : t('common.continue')}
      </button>
      <button
        className="px-4 py-2 bg-orange-500 text-white rounded"
        data-testid="reset-quiz-button"
        onClick={resetQuiz}
        onTouchEnd={resetQuiz}
        aria-label={t('quiz.restart')}
      >
        {t('quiz.restart')}
      </button>
      <button
        className="px-4 py-2 bg-gray-500 text-white rounded"
        data-testid="change-area-button"
        onClick={() => {
          setShowAreaSelection(true);
          setShowStatus(false);
          setShowResult(null);
        }}
        aria-label={t('menu.changeAreaAria')}
      >
        {t('menu.changeArea')}
      </button>
    </div>
  );

  return (
    <div className="space-y-8 relative">
      {/* Question Details Overlay */}
      {selectedQuestion && (
        <div
          className="fixed inset-0 w-screen h-screen flex items-center justify-center z-[9999] bg-black/50"
          onClick={onCloseFailedQuestion}
        >
          <div
            className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border-2 border-gray-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-red-600">
                {EMOJI_FAIL} {t('status.failedQuestionTitle', { number: selectedQuestion.number })}
              </h2>
              <button
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                onClick={onCloseFailedQuestion}
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>

            <div className="space-y-6">
              {/* Question Text */}
              <div
                className="text-xl font-semibold rich-content question-text"
                dangerouslySetInnerHTML={formatRichText(
                  `${selectedQuestion.number}. ${selectedQuestion.question}`
                )}
              ></div>

              {/* Options for MCQ */}
              {currentQuizType === 'Multiple Choice' && Array.isArray(selectedQuestion.options) && (
                <div>
                  <div className="bg-gray-50 p-4 rounded border border-gray-200">
                    {selectedQuestion.options.map((option: string, index: number) => {
                      const letter = String.fromCharCode(65 + index); // 'A', 'B', 'C', etc.
                      const isCorrect = option.trim() === selectedQuestion.answer.trim();
                      const userAnswer = userAnswers[selectedQuestion.index];
                      const isUserChoice =
                        userAnswer && userAnswer.toLowerCase() === letter.toLowerCase();

                      return (
                        <div
                          key={index}
                          className={`text-base py-2 px-3 mb-2 rounded ${
                            isCorrect
                              ? 'bg-green-100 border-l-4 border-green-500 text-green-800'
                              : isUserChoice
                                ? 'bg-red-100 border-l-4 border-red-500 text-red-800'
                                : 'bg-white border border-gray-200'
                          }`}
                        >
                          <span className="font-bold">{letter})</span> {option}
                          {isCorrect && (
                            <span className="ml-2 text-green-600 font-semibold">
                              {t('status.correctBadge')}
                            </span>
                          )}
                          {isUserChoice && !isCorrect && (
                            <span className="ml-2 text-red-600 font-semibold">
                              {t('status.yourAnswerBadge')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* True/False Correct Answer */}
              {currentQuizType === 'True False' && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">{t('quiz.correctAnswer')}</h3>
                  {(() => {
                    const isTrueAnswer = normalizeTrueFalseValue(selectedQuestion.answer) === 'TRUE';
                    return (
                  <div
                    className={`p-3 rounded border-l-4 ${
                      isTrueAnswer
                        ? 'bg-green-50 border-green-500'
                        : 'bg-red-50 border-red-500'
                    }`}
                  >
                    <span
                      className={`font-medium ${
                        isTrueAnswer
                          ? 'text-green-800'
                          : 'text-red-800'
                      }`}
                    >
                      {isTrueAnswer ? t('status.trueLabel') : t('status.falseLabel')}
                    </span>
                  </div>
                    );
                  })()}
                </div>
              )}

              {/* Your Answer for MCQ only */}
              {currentQuizType === 'Multiple Choice' && userAnswers[selectedQuestion.index] && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">{t('quiz.yourAnswer')}</h3>
                  <div className="bg-red-50 p-3 rounded border-l-4 border-red-500">
                    <span data-testid="failed-answer-text" className="text-red-800 font-medium">
                      ❌{' '}
                      {currentQuizType === 'Multiple Choice' && selectedQuestion.options
                        ? getUserAnswerDisplay(
                            userAnswers[selectedQuestion.index],
                            selectedQuestion.options
                          )
                        : userAnswers[selectedQuestion.index]}
                    </span>
                  </div>
                </div>
              )}

              {/* Explanation */}
              {selectedQuestion.explanation && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">{t('status.explanation')}</h3>
                  <div className="bg-blue-50 p-4 rounded border-l-4 border-blue-500">
                    <p className="text-blue-900 leading-relaxed">{selectedQuestion.explanation}</p>
                  </div>
                </div>
              )}

              {/* Appears In */}
              {selectedQuestion.appearsIn && (
                <div>
                  <h3 className="font-semibold text-gray-700 mb-2">{t('common.appearsIn')}</h3>
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                    {Array.isArray(selectedQuestion.appearsIn) ? (
                      <ul className="list-disc list-inside space-y-1">
                        {selectedQuestion.appearsIn.map((ref: string, idx: number) => (
                          <li key={idx} className="text-sm text-yellow-800">
                            {ref}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-yellow-800">{selectedQuestion.appearsIn}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                onClick={onCloseFailedQuestion}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Show area name at top */}
      {selectedArea && (
        <div className="text-lg font-bold text-blue-600 mb-2">
          🎓 {t('common.areaLabel')}: {selectedArea.area}
        </div>
      )}
      {actionButtons}
      <div className="mt-2 text-base flex items-center gap-2">
        {EMOJI_PROGRESS} {questions.length}
        <span className="ml-2">
          | {EMOJI_SUCCESS} {correctCount}
        </span>
        <span>
          | {EMOJI_FAIL} {failCount}
        </span>
        <span>
          | {EMOJI_ASK} {pendingCount}
        </span>
      </div>
      {[...grouped.entries()]
        .sort(([sectionA], [sectionB]) => {
          const indexA = originalSectionOrder.indexOf(sectionA);
          const indexB = originalSectionOrder.indexOf(sectionB);
          return indexA - indexB;
        })
        .map(([section, qs]) => (
          <div key={section}>
            <div className="font-bold text-lg mb-2">
              {EMOJI_SECTION} {section}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {qs.map((q: QuestionType) => {
                let emoji = EMOJI_ASK;
                if (status[q.index] === 'correct') emoji = EMOJI_SUCCESS;
                else if (status[q.index] === 'fail') {
                  emoji = EMOJI_FAIL;
                  return (
                    <div
                      key={q.index}
                      className="flex flex-col items-center cursor-pointer hover:bg-gray-100 p-1 rounded transition-colors"
                      onClick={() => onOpenFailedQuestion(q.number)}
                      title={t('status.questionTooltip', { number: q.number })}
                    >
                      <span className="text-2xl">
                        {q.number}
                        {emoji}
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={q.index} className="flex flex-col items-center">
                    <span className="text-2xl">
                      {q.number}
                      {emoji}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      <div className="mt-4">
        <span>
          {EMOJI_SUCCESS} = {t('quiz.legendCorrect')}{' '}
        </span>
        <span>
          {EMOJI_FAIL} = {t('quiz.legendFailed')}{' '}
        </span>
        <span>
          {EMOJI_ASK} = {t('quiz.legendPending')}
        </span>
      </div>
      {actionButtons}
    </div>
  );
}
