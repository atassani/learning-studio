import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
  getDefaultLanguage,
  isLanguageSelectionEnabled,
  normalizeLanguage,
} from '../../src/app/i18n/config';
import { I18nProvider, useI18n } from '../../src/app/i18n/I18nProvider';
import { translate } from '../../src/app/i18n/messages';

const PREV_DEFAULT_LANGUAGE = process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE;
const PREV_LANGUAGE_SELECTION = process.env.NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED;
const PREV_FORCE_TEST_LANGUAGE = process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE;

function Probe() {
  const { activeLanguage, t } = useI18n();
  return (
    <div>
      <span data-testid="lang">{activeLanguage}</span>
      <span data-testid="loading">{t('common.loading')}</span>
      <span data-testid="study-aria">{t('areas.selection.studyAria', { area: 'IPC' })}</span>
    </div>
  );
}

describe('i18n', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE = PREV_DEFAULT_LANGUAGE;
    process.env.NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED = PREV_LANGUAGE_SELECTION;
    process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE = PREV_FORCE_TEST_LANGUAGE;
    localStorage.removeItem('learningStudio');
  });

  it('translates messages in English and Catalan', () => {
    expect(translate('en', 'common.loading')).toBe('Loading...');
    expect(translate('ca', 'common.loading')).toBe('Carregant...');
    expect(translate('en', 'areas.selection.studyAria', { area: 'IPC' })).toBe('Study IPC');
  });

  it('initializes provider language from NEXT_PUBLIC_DEFAULT_LANGUAGE', () => {
    process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE = 'true';
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE = 'en';

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    expect(screen.getByTestId('lang').textContent).toBe('en');
    expect(screen.getByTestId('loading').textContent).toBe('Loading...');
    expect(screen.getByTestId('study-aria').textContent).toBe('Study IPC');
  });

  it('falls back to Spanish when NEXT_PUBLIC_DEFAULT_LANGUAGE is invalid', () => {
    process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE = 'true';
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE = 'de';

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    expect(screen.getByTestId('lang').textContent).toBe('es');
    expect(screen.getByTestId('loading').textContent).toBe('Cargando...');
  });

  it('hydrates provider language from persisted state when available', async () => {
    process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE = 'true';
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE = 'en';
    localStorage.setItem('learningStudio', JSON.stringify({ areas: {}, language: 'ca' }));

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('lang').textContent).toBe('ca');
      expect(screen.getByTestId('loading').textContent).toBe('Carregant...');
    });
  });

  it('parses language config flags correctly', () => {
    process.env.NEXT_PUBLIC_FORCE_TEST_LANGUAGE = 'true';
    process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE = 'ca';
    process.env.NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED = 'true';

    expect(normalizeLanguage('EN')).toBe('en');
    expect(getDefaultLanguage()).toBe('ca');
    expect(isLanguageSelectionEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_LANGUAGE_SELECTION_ENABLED = 'false';
    expect(isLanguageSelectionEnabled()).toBe(false);
  });
});
