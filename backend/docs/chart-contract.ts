/** Chart contract v1. These are types, not a running API or UI. */
export type ChartCategory = "vitals" | "labs" | "history" | "nutrition" | "communication";

export interface SourceReference {
  source_id: string;
  filename: string;
  patient_uuid: string;
  field: string;
}

interface ChartItemBase {
  /** Stable within a patient's profile; combine with patient_id across patients. */
  item_id: string;
  label: string;
  category: ChartCategory;
  /** Value only. Append unit once when present. */
  display_value: string;
  source_reference: SourceReference;
}

export type ChartItem = ChartItemBase & (
  | { value_type: "text"; value: string; unit: null }
  | { value_type: "number"; value: number; unit: string | null }
  | {
      value_type: "blood_pressure";
      value: { systolic: number; diastolic: number };
      unit: "mmHg";
    }
);

export interface ChartResponse {
  schema_version: 1;
  patient_id: string;
  patient_version: number;
  /** Full currently visible snapshot, not a list of changes. */
  items: ChartItem[];
}
