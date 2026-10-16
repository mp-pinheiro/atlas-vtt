import { type FeedbackSender } from '../protocol/index.ts';
export const COMPANION_REPORTS_NOTE = 'Off by default. When enabled, Atlas Online error reports are sent to the configured relay. The relay discards them and does not file issues or retain submissions.';
export interface CompanionFeedback extends FeedbackSender { reportsErrors(): boolean; setReportErrors(on: boolean): void; enabled(): boolean; }
