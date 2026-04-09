import { Injectable } from '@nestjs/common';

type MetricLabels = Record<string, string | number | boolean>;
type MetricType = 'counter' | 'gauge' | 'summary';
type SummaryValue = {
  count: number;
  sum: number;
};

@Injectable()
export class PrometheusMetricsService {
  private readonly metadata = new Map<
    string,
    { help: string; type: MetricType }
  >();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly summaries = new Map<string, SummaryValue>();

  incrementCounter(
    name: string,
    value = 1,
    labels: MetricLabels = {},
    help = `${name} counter`,
  ): void {
    this.registerMetric(name, help, 'counter');
    const key = this.buildSeriesKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  setGauge(
    name: string,
    value: number,
    labels: MetricLabels = {},
    help = `${name} gauge`,
  ): void {
    this.registerMetric(name, help, 'gauge');
    const key = this.buildSeriesKey(name, labels);
    this.gauges.set(key, value);
  }

  observeSummary(
    name: string,
    value: number,
    labels: MetricLabels = {},
    help = `${name} summary`,
  ): void {
    this.registerMetric(name, help, 'summary');
    const key = this.buildSeriesKey(name, labels);
    const current = this.summaries.get(key) ?? { count: 0, sum: 0 };
    current.count += 1;
    current.sum += value;
    this.summaries.set(key, current);
  }

  renderPrometheus(): string {
    const lines: string[] = [];
    const metricNames = Array.from(this.metadata.keys()).sort();

    for (const metricName of metricNames) {
      const metadata = this.metadata.get(metricName);
      if (!metadata) {
        continue;
      }

      lines.push(`# HELP ${metricName} ${metadata.help}`);
      lines.push(`# TYPE ${metricName} ${metadata.type}`);

      switch (metadata.type) {
        case 'counter':
          this.appendSeries(lines, metricName, this.counters);
          break;
        case 'gauge':
          this.appendSeries(lines, metricName, this.gauges);
          break;
        case 'summary':
          this.appendSummarySeries(lines, metricName);
          break;
      }
    }

    return `${lines.join('\n')}\n`;
  }

  private registerMetric(name: string, help: string, type: MetricType): void {
    const existing = this.metadata.get(name);
    if (existing) {
      return;
    }

    this.metadata.set(name, { help, type });
  }

  private appendSeries(
    lines: string[],
    metricName: string,
    values: Map<string, number>,
  ): void {
    const entries = Array.from(values.entries())
      .filter(([seriesKey]) => seriesKey.startsWith(`${metricName}|`))
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [seriesKey, value] of entries) {
      lines.push(`${this.decodeSeriesKey(seriesKey)} ${value}`);
    }
  }

  private appendSummarySeries(lines: string[], metricName: string): void {
    const entries = Array.from(this.summaries.entries())
      .filter(([seriesKey]) => seriesKey.startsWith(`${metricName}|`))
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [seriesKey, value] of entries) {
      const decoded = this.decodeSeriesKey(seriesKey);
      lines.push(`${decoded}_count ${value.count}`);
      lines.push(`${decoded}_sum ${value.sum}`);
    }
  }

  private buildSeriesKey(name: string, labels: MetricLabels): string {
    const normalizedLabels = Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([label, value]) => [label, String(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right));

    return `${name}|${JSON.stringify(normalizedLabels)}`;
  }

  private decodeSeriesKey(seriesKey: string): string {
    const separatorIndex = seriesKey.indexOf('|');
    if (separatorIndex === -1) {
      return seriesKey;
    }

    const metricName = seriesKey.slice(0, separatorIndex);
    const rawLabels = seriesKey.slice(separatorIndex + 1);
    const labels = JSON.parse(rawLabels) as Array<[string, string]>;

    if (!labels.length) {
      return metricName;
    }

    const formattedLabels = labels
      .map(([label, value]) => `${label}="${this.escapeLabelValue(value)}"`)
      .join(',');

    return `${metricName}{${formattedLabels}}`;
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
}
