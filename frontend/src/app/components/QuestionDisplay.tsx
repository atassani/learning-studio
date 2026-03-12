import { QuestionType, AreaType } from '../types';
import { formatRichText } from '../utils';
import { EMOJI_SUCCESS, EMOJI_FAIL, EMOJI_ASK, EMOJI_SECTION, EMOJI_PROGRESS } from '../constants';
import { useI18n } from '../i18n/I18nProvider';

interface QuestionDisplayProps {
  selectedArea: AreaType | null;
  current: number | null;
  questions: QuestionType[];
  status: Record<number, 'correct' | 'fail' | 'pending'>;
  currentQuizType: 'True False' | 'Multiple Choice' | null;
  displayOptions: string[];
  handleAnswer: (answer: string) => void;
  goToStatusWithResume: () => void;
}

export function QuestionDisplay({
  selectedArea,
  current,
  questions,
  status,
  currentQuizType,
  displayOptions,
  handleAnswer,
  goToStatusWithResume,
}: QuestionDisplayProps) {
  const { t } = useI18n();
  if (current == null) return null;

  const q = questions[current];
  const correctCount = Object.values(status).filter((s) => s === 'correct').length;
  const failCount = Object.values(status).filter((s) => s === 'fail').length;
  const pendingCount = questions.length - (correctCount + failCount);

  return (
    <div className="space-y-6" data-testid="question-view">
      {/* Show area name at top */}
      {selectedArea && (
        <div className="text-lg font-bold text-blue-600 mb-2">
          🎓 {t('common.areaLabel')}: {selectedArea.area}
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <div className="font-bold text-lg flex-1">
          {EMOJI_SECTION} {q.section}
        </div>
        <button
          className="ml-2 text-2xl"
          aria-label={t('quiz.optionsAria')}
          data-testid="options-button"
          onClick={goToStatusWithResume}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '1.5rem',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          ⚙️
        </button>
      </div>
      <div className="mt-2 text-sm">
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
      </div>
      <div
        className="text-xl font-semibold rich-content question-text"
        dangerouslySetInnerHTML={formatRichText(`${q.number}. ${q.question}`)}
      ></div>
      {currentQuizType === 'Multiple Choice' && Array.isArray(q.options) && (
        <div className="mt-4 space-y-2 question-options">
          {(displayOptions || []).map((option: string, index: number) => {
            const letter = String.fromCharCode(65 + index); // 'A', 'B', 'C', etc.
            return (
              <div key={index} className="text-base">
                <span className="font-bold">{letter})</span> {option}
              </div>
            );
          })}
          {/* appearsIn bullet list if present */}
          {Array.isArray(q.appearsIn) && q.appearsIn.length > 0 && (
            <div className="mt-2">
              <div className="text-sm text-gray-500">{t('common.appearsIn')}</div>
              <ul className="list-disc list-inside ml-4 text-sm text-gray-500">
                {q.appearsIn.map((ref: string, idx: number) => (
                  <li key={idx}>{ref}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Render buttons based on quiz type */}
      {currentQuizType === 'True False' ? (
        <div className="flex gap-4 mt-4">
          <button
            className="px-6 py-2 bg-green-600 text-white rounded text-lg"
            data-testid="tf-answer-true"
            aria-label={t('status.trueLabel')}
            onClick={() => handleAnswer('V')}
          >
            {t('quiz.tfTrueButton')}
          </button>
          <button
            className="px-6 py-2 bg-red-600 text-white rounded text-lg"
            data-testid="tf-answer-false"
            aria-label={t('status.falseLabel')}
            onClick={() => handleAnswer('F')}
          >
            {t('quiz.tfFalseButton')}
          </button>
        </div>
      ) : (
        // Multiple Choice A/B/C buttons
        <div className="flex gap-4 mt-4">
          {(displayOptions || []).map((option: string, index: number) => {
            const letter = String.fromCharCode(65 + index); // 'A', 'B', 'C', etc.
            return (
              <button
                key={index}
                data-testid={`mcq-answer-${letter}`}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-lg"
                onClick={() => handleAnswer(letter.toLowerCase())}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
