import {z} from 'zod';
export const ChartCategorySchema=z.enum(['vitals','labs','history','nutrition','communication']);
export type ChartCategory=z.infer<typeof ChartCategorySchema>;
export const SourceReferenceSchema=z.object({source_id:z.string(),filename:z.string(),patient_uuid:z.string(),field:z.string()});
export type SourceReference=z.infer<typeof SourceReferenceSchema>;
const base={item_id:z.string(),label:z.string(),category:ChartCategorySchema,display_value:z.string(),source_reference:SourceReferenceSchema};
export const ChartItemSchema=z.discriminatedUnion('value_type',[
  z.object({...base,value_type:z.literal('text'),value:z.string(),unit:z.null()}),
  z.object({...base,value_type:z.literal('number'),value:z.number(),unit:z.string().nullable()}),
  z.object({...base,value_type:z.literal('blood_pressure'),value:z.object({systolic:z.number(),diastolic:z.number()}),unit:z.literal('mmHg')}),
]);
export type ChartItem=z.infer<typeof ChartItemSchema>;
export const ChartResponseSchema=z.object({schema_version:z.literal(1),patient_id:z.string(),patient_version:z.number().int().positive(),items:z.array(ChartItemSchema)});
export type ChartResponse=z.infer<typeof ChartResponseSchema>;
