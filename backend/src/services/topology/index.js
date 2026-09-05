// Intelligent 2D/3D topology validation engine — barrel (Phase 7, additive).
//
//   Parcel/Building/Floor/Unit docs (Mongo)
//     -> geometry engine (shapely, ai-service — validity/self-intersection/overlap)
//     -> deterministic rule modules (rules/*.js — RULE_ENGINE, not AI)
//     -> findings + summary (result.js)
//     -> topologyValidationResults (Mongo, additive; never touches parcels/buildings/floors/propertyUnits)
//
// A finding NEVER modifies geometry. `suggestedFix` is guidance for a
// separate, explicit review action only.

export { evaluate, runValidation } from './engine.js'
export { makeFinding, summarize } from './result.js'
export { STATUS, SEVERITY, RULE_DEFAULTS, RULE_ALIASES, ruleMatches } from './severity.js'
export { TOPOLOGY_CONFIG, TOPOLOGY_DISCLAIMER, ML_DECISION_NOTE } from './tolerances.js'
export { topologyEngineConfig } from './geometryClient.js'
