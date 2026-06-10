import type { AlertChannel, AlertPayload } from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * Microsoft Teams Incoming Webhook sender. (arch §14)
 *
 * Teams auth = URL secrecy (same model as Slack). The wire format
 * is the legacy "Office 365 Connector Card" — Microsoft's modern
 * Adaptive Card path requires a paid Power Automate flow, while the
 * connector-card endpoint is the no-extra-cost option that comes
 * with every Teams workspace. A 2026-cutoff for connector cards
 * has been floated by Microsoft repeatedly without follow-through;
 * if it does land, swap the `body` builder, leave the rest.
 *
 * Card structure:
 * - `themeColor` is the red bar across the card.
 * - `title` / `text` carry the rule name and reason.
 * - `sections[].facts[]` is a 2-column key/value grid (suite,
 *   provider, avg-score, regression count).
 * - Optional `potentialAction` of type OpenUri renders a "View run"
 *   button when `payload.runUrl` is set.
 */

const RED_THEME_COLOR = 'C0392B';

export interface TeamsSenderOptions {
  /** Override `globalThis.fetch` for tests. */
  fetch?: typeof globalThis.fetch;
  /** Cap on regression rows in the card body. Default 10. */
  maxRegressions?: number;
}

const DEFAULT_MAX_REGRESSIONS = 10;

export class TeamsSender implements AlertSender {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly maxRegressions: number;

  constructor(opts: TeamsSenderOptions = {}) {
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.maxRegressions = opts.maxRegressions ?? DEFAULT_MAX_REGRESSIONS;
  }

  async send(channel: AlertChannel, payload: AlertPayload): Promise<void> {
    if (channel.type !== 'teams') {
      throw new Error(
        `TeamsSender received non-teams channel type "${channel.type}"`,
      );
    }
    const body = buildTeamsBody(payload, this.maxRegressions);
    const res = await this.fetcher(channel.config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`teams POST failed: ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * Pure card-builder, exported for tests.
 */
export function buildTeamsBody(
  payload: AlertPayload,
  maxRegressions = DEFAULT_MAX_REGRESSIONS,
): TeamsConnectorCard {
  const visible = payload.regressions.slice(0, maxRegressions);
  const overflow = payload.regressions.length - visible.length;

  const regressionLines = visible
    .map((r) => `- \`${r.caseId}\`: ${r.score.toFixed(3)} (Δ ${r.delta.toFixed(3)})`)
    .join('\n\n');
  const regressionText = overflow > 0
    ? `${regressionLines}\n\n_…and ${overflow} more_`
    : regressionLines;

  const card: TeamsConnectorCard = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    themeColor: RED_THEME_COLOR,
    summary: `drift-ci alert: ${payload.ruleName}`,
    title: `🔴 drift-ci: ${payload.ruleName}`,
    text: payload.reason,
    sections: [
      {
        facts: [
          { name: 'Suite', value: payload.suiteId },
          { name: 'Provider', value: payload.provider },
          { name: 'Avg score', value: payload.avgScore.toFixed(3) },
          { name: 'Regressions', value: String(payload.regressions.length) },
        ],
      },
    ],
  };

  if (regressionText) {
    card.sections!.push({
      title: 'Regressed cases',
      text: regressionText,
    });
  }

  if (payload.runUrl) {
    card.potentialAction = [
      {
        '@type': 'OpenUri',
        name: 'View run',
        targets: [{ os: 'default', uri: payload.runUrl }],
      },
    ];
  }

  return card;
}

// ─── Teams Connector Card shape (subset we use) ─────────────────────────

export interface TeamsConnectorCard {
  '@type': 'MessageCard';
  '@context': 'https://schema.org/extensions';
  themeColor: string;
  summary: string;
  title: string;
  text: string;
  sections?: TeamsCardSection[];
  potentialAction?: TeamsCardAction[];
}

export interface TeamsCardSection {
  title?: string;
  text?: string;
  facts?: Array<{ name: string; value: string }>;
}

export interface TeamsCardAction {
  '@type': 'OpenUri';
  name: string;
  targets: Array<{ os: 'default'; uri: string }>;
}
