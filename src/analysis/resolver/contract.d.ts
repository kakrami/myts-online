/** Pure resolver contract. Seconds are unrounded; null/omitted facts inherit, 0/false are explicit. */
export type HalfId = 1 | 2;
export type Format = 7 | 9;
export type Role = 'field' | 'goalkeeper' | 'unknown';
export type FactState = 'manual' | 'reported' | 'inferred' | 'estimated' | 'mixed' | 'season_default' | 'unknown';
export interface Provenance {
 kind: FactState; basis: string | null; sourceRefs: readonly string[];
 /** Structured dependency/allocation details; never credentials or source payloads. */
 [detail: string]: unknown;
}
export interface ResolvedFact<T> { readonly value: T | null; readonly state: FactState; readonly provenance: Provenance; }
export interface MatchFacts {
 totalSeconds?: number | null; fieldSeconds?: number | null; gkSeconds?: number | null;
 appearance?: boolean | null;
 /** A selected true start proves appearance without proving seconds, even without video.
  * Match start means first-half start, never second-half start. Derived appearance
  * retains the selected manual/reported start and its scope in provenance.parts. */
 started?: boolean | null;
 position?: string | null; role?: Role | null;
 /** Owner pitch anchor, 0..100, both coordinates required. Manual layer only. */
 slotX?: number | null; slotY?: number | null;
 goals?: number | null; assists?: number | null;
}
export interface HalfFacts extends Omit<MatchFacts, 'goals' | 'assists'> {
 /** Index in the selected 7/9 formation, one-based; slot 1 is keeper. */
 slot?: number | null;
}
export interface DecisionLayer {
 match?: MatchFacts;
 halves?: Partial<Record<HalfId, HalfFacts>>;
}
export interface ReportedDecisionLayer {
 match?: Omit<MatchFacts, 'slotX' | 'slotY'>;
 halves?: Partial<Record<HalfId, Omit<HalfFacts, 'slot' | 'slotX' | 'slotY'>>>;
}
export interface SpatialEvidence {
 avg_x?: number | null; avg_y?: number | null; samples?: number | null;
 display_orientation?: string | null; tactical_left_is_top?: boolean;
 grid_cols?: number | null; grid_rows?: number | null; grid?: readonly number[] | null;
 attacking_third_pct?: number | null; defensive_third_pct?: number | null; source?: string | null;
}
export interface ResolverPlayer {
 id: string;
 /** Adapter proves dated own-team eligibility; current roster is not historical proof. */
 eligible: boolean;
 manual?: DecisionLayer; reported?: ReportedDecisionLayer;
 season?: { position?: string | null };
 spatial?: { match?: SpatialEvidence | null; halves?: Partial<Record<HalfId, SpatialEvidence | null>> };
}
export interface HalfWindow {
 id: HalfId; start: number; end: number;
 /** Proven completeness permits late observed participation to imply non-start. */
 complete?: boolean;
 /** Verified FullGameVideo clock origins. Never use the first observed event as origin. */
 clockOriginMs?: number | null; reportedClockOriginSeconds?: number | null;
}
export interface Observation {
 id: string; playerId: string | null; half: HalfId;
 side: 'own' | 'opponent'; dummy: boolean; mapping: 'verified' | 'unresolved';
 /** Must be supported by source-role evidence, not a guessed keeper/person/position. */
 role: Role; segments: readonly (readonly [number, number])[];
 source: {id: string};
}
export interface ResolverInput {
 context: {
  teamId: string; seasonId: string; eventId: string;
  inputRevision?: string | number; sourceRevision?: string | number;
  /** Opaque accepted-season/revision token, echoed only. Publication adapter revalidates it. */
  commitSignature?: string; timezone?: string;
 };
 format?: {manual?: Format | null; reported?: Format | null; inferred?: Format | null};
 formatEvidence?: {ownSlots?: Format | null; baselineTracks?: number | null; bothSidesVerified?: boolean; historyFormatFamily?: '7_or_9'; declaredFormat?: number | null};
 expectedHalves?: HalfId; halves?: readonly HalfWindow[];
 players: readonly ResolverPlayer[]; observations?: readonly Observation[];
 estimateCapacity?: boolean;
}
export interface HalfPlayerResult {
 appearance: ResolvedFact<boolean>; started: ResolvedFact<boolean>; position: ResolvedFact<string>;
 role: ResolvedFact<Role>; slot: ResolvedFact<number>; slotX: ResolvedFact<number>; slotY: ResolvedFact<number>;
 totalSeconds: ResolvedFact<number>; fieldSeconds: ResolvedFact<number>; gkSeconds: ResolvedFact<number>;
 observedSeconds: number; estimatedSeconds: number; unknownRoleSeconds: number | null;
 /** Supported quantity floor; never a replacement for nullable effective total. */
 lowerBoundSeconds: ResolvedFact<number>;
}
export interface PlayerResult {
 id: string; eligible: boolean;
 appearance: ResolvedFact<boolean>; started: ResolvedFact<boolean>; position: ResolvedFact<string>;
 totalSeconds: ResolvedFact<number>; fieldSeconds: ResolvedFact<number>; gkSeconds: ResolvedFact<number>;
 minutes: ResolvedFact<number>; fieldMinutes: ResolvedFact<number>; gkMinutes: ResolvedFact<number>;
 goals: ResolvedFact<number>; assists: ResolvedFact<number>;
 halves: Partial<Record<HalfId, HalfPlayerResult>>;
 observedSeconds: number; estimatedSeconds: number;
}
export interface AllocationPlayer {
 id: string; totalSeconds: number | null; fieldSeconds: number | null; gkSeconds: number | null;
 lowerBoundSeconds: number | null;
 unknownRoleSeconds: number | null; observedSeconds: number; observedTotalSeconds: number;
 observedFieldSeconds: number; observedGkSeconds: number; inferredSeconds: number; estimatedSeconds: number;
 state: string; provenance: Readonly<Record<string, unknown>>; constraintViolations: readonly Constraint[];
}
export interface Constraint { code: string; [detail: string]: unknown; }
export interface HalfAccounting {
 players: readonly AllocationPlayer[];
 capacitySeconds: number | null; assignedSeconds: number | null; unallocatedSeconds: number | null;
 /** True if named accounting includes supported floors for unresolved totals. */
 assignedIsLowerBound: boolean;
 unassignedGkSeconds: number | null; overCapacity: boolean; publishable: boolean; coverage: string;
 violations: readonly Constraint[]; [detail: string]: unknown;
}
export interface LineupSlot {
 /** Canonical identity or null: empty places are not invented players. */
 player_id: string | null;
 [detail: string]: unknown;
}
export interface LineupResult {
 formation: string | null; slots: readonly LineupSlot[];
 positions?: readonly {player_id:string;x:number;y:number;label:string;basis:string}[];
 [detail: string]: unknown;
}
export interface ResolverOutput {
 readonly version: string; readonly context: Readonly<ResolverInput['context']>;
 readonly format: ResolvedFact<Format>; readonly durationSeconds: number | null;
 readonly players: readonly PlayerResult[];
 readonly lineups: Readonly<Partial<Record<HalfId, LineupResult>>>;
 readonly halfAccounting: Readonly<Partial<Record<HalfId, HalfAccounting>>>;
 readonly totals: Readonly<{
  capacitySeconds: number | null; assignedSeconds: number | null; unassignedGkSeconds: number | null;
  unallocatedSeconds: number | null; overCapacity: boolean; assignedIsLowerBound: boolean;
 }>;
 readonly unassigned: readonly {id:string;half:HalfId;sourceId:string;reason:string;observedSeconds:number}[];
 readonly issues: readonly (Constraint & {severity:'warning'|'error'})[];
 readonly publishable: boolean; readonly coverage: 'bounded' | 'partial';
}
