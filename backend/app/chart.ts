/** Prepare chart items from facts; the encounter service owns disclosure. */
import { isRecord, isText, validateProfile, type PatientProfile, type Visibility } from './profiles.js';
import type { ChartCategory, ChartItem, ChartResponse, SourceReference } from '../docs/chart-contract.js';

export class ChartValidationError extends Error {}
export type PreparedChartItem = ChartItem & { visibility: Visibility; topics: string[] };
const categories = new Set<ChartCategory>(['vitals', 'labs', 'history', 'nutrition', 'communication']);
function requireChart(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ChartValidationError(message);
}
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
/** Server-only items, including hidden facts and disclosure topics. */
export function prepareChartItems(profile: PatientProfile): PreparedChartItem[] {
  validateProfile(profile);
  const sources = new Map(profile.sources.map(source => [source.id, source]));
  const items: PreparedChartItem[] = [];
  for (const fact of profile.facts) {
    if (!Object.hasOwn(fact, 'chart')) continue;
    const chart = fact.chart;
    requireChart(isRecord(chart) && isText(chart.label), 'Chart label must be nonempty');
    requireChart(categories.has(chart.category as ChartCategory), 'Unknown chart category');
    requireChart(sources.get(fact.source_id)?.kind === 'provided_csv', 'Chart facts require CSV provenance');
    requireChart(isText(fact.source_field) && Object.hasOwn(profile.source_record, fact.source_field), 'Chart fact must reference an existing CSV field');
    const source_reference: SourceReference = { source_id: fact.source_id, filename: profile.provenance.source_filename, patient_uuid: profile.id, field: fact.source_field };
    const base = { item_id: fact.id, label: chart.label, category: chart.category as ChartCategory, source_reference, visibility: fact.visibility, topics: [...fact.topics] };
    if (!Object.hasOwn(fact, 'measurement')) {
      items.push({ ...base, value_type: 'text', value: fact.text, display_value: fact.text, unit: null });
      continue;
    }
    const measurement: unknown = fact.measurement;
    requireChart(isRecord(measurement), 'Measurement must be an object');
    const unit = measurement.unit;
    requireChart(Object.hasOwn(measurement, 'unit') && (unit === null || isText(unit)), 'Measurement unit must be a string or explicit null');
    if (hasKeys(measurement, ['value', 'unit'])) {
      requireChart(finiteNumber(measurement.value), 'Measurement value must be a finite number');
      items.push({ ...base, value_type: 'number', value: measurement.value, display_value: String(measurement.value), unit });
    } else if (hasKeys(measurement, ['systolic', 'diastolic', 'unit'])) {
      requireChart(finiteNumber(measurement.systolic) && finiteNumber(measurement.diastolic), 'Blood pressure requires finite systolic and diastolic values');
      requireChart(unit === 'mmHg', 'Blood pressure unit must be mmHg');
      const value = { systolic: measurement.systolic, diastolic: measurement.diastolic };
      items.push({ ...base, value_type: 'blood_pressure', value, display_value: `${value.systolic}/${value.diastolic}`, unit });
    } else throw new ChartValidationError('Unsupported measurement shape');
  }
  requireChart(items.length > 0, 'Profile has no chart items');
  return items;
}
/** Pass the pinned profile and accumulated ids from trusted encounter state. */
export function buildChartResponse(profile: PatientProfile, releasedFactIds: Iterable<string> = []): ChartResponse {
  requireChart(typeof releasedFactIds !== 'string' && releasedFactIds != null && typeof releasedFactIds[Symbol.iterator] === 'function', 'Released ids must be an iterable of strings');
  const released = [...releasedFactIds];
  requireChart(released.every(isText), 'Released ids must be strings');
  const items = prepareChartItems(profile);
  const known = new Set(profile.facts.map(fact => fact.id));
  requireChart(released.every(id => known.has(id)), 'Released ids include an unknown fact');
  const releasedIds = new Set(released);
  return {
    schema_version: 1, patient_id: profile.id, patient_version: profile.version,
    items: items.filter(item => item.visibility === 'initial' || releasedIds.has(item.item_id)).map(item => {
      const { visibility, topics, ...publicItem } = item;
      return structuredClone(publicItem);
    }),
  };
}
