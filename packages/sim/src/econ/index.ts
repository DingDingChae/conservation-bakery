/**
 * The business layer: what turns a simulator into a game. Model only — no
 * UI, no DOM, no Electron. Everything here is subordinate to CONTRACT.md's
 * two rules: cash moves only through a balanced `Posting` against a real
 * counterparty (rule 1), and every hazard modelled here is an equipment,
 * product or regulatory-conformance event only — see rule 2.
 */

export type { CashMovement, SaleParams, WagePaymentParams, EnergyBillParams, SparePartsPurchaseParams, WasteDisposalParams } from './ledgerAccounts.js';
export {
  CASH,
  CASH_CURRENCY,
  ECON_ACCOUNTS,
  buySpareParts,
  cashOnHand,
  openEconAccounts,
  payEnergyBill,
  payWages,
  payWasteDisposal,
  postCashMovement,
  recordSale,
  seedInitialCash,
} from './ledgerAccounts.js';

export type { EnergyTariffSchedule, MonthlyMultiplier, SeasonalPriceModel } from './market.js';
export {
  BUTTER_PRICE_MODEL,
  HEN_EGG_PRICE_MODEL,
  IngredientMarket,
  SUCROSE_PRICE_MODEL,
  TYPICAL_ENERGY_TARIFF,
  WHEAT_FLOUR_PRICE_MODEL,
  energyBillMinorUnits,
  energyTariffMinorUnitsPerKwh,
  harvestShockMultiplier,
  hourOfDayFromTick,
  isPeakHour,
  priceForMass,
} from './market.js';

export type {
  Contract,
  Customer,
  HolidayDemand,
  Order,
  OrderGenerationParams,
  OrderSpecification,
  OrderStatus,
} from './orders.js';
export {
  CANCELLATION_REASONS,
  DuplicateOrderError,
  InvalidOrderTransitionError,
  OrderBook,
  SEASONAL_HOLIDAYS,
  UnknownOrderError,
  contractDueTicks,
  generateContractOrder,
  generateDailyOrders,
  orderValueMinorUnits,
  seasonalDemandMultiplier,
} from './orders.js';

export type {
  AvailabilityCheck,
  ShiftDefinition,
  Skill,
  StaffRespirationParams,
  StockProvisionsParams,
  UnavailabilityReason,
  Worker,
} from './staff.js';
export {
  ShiftOverlapError,
  StaffRoster,
  UnknownWorkerError,
  shiftHours,
  staffGlucoseEquivalentMass,
  staffRespiration,
  stockProvisions,
  wagesOwedMinorUnits,
} from './staff.js';

export type {
  Allergen,
  AllergenProfile,
  CcpEvaluation,
  ConformanceCheck,
  ConformanceOutcome,
  CriticalControlPoint,
  HaccpPlan,
  RecallReport,
  ShipmentRecord,
  TemperatureLogEntry,
} from './quality.js';
export { ALLERGENS, ShipmentIndex, condemnLot, evaluateCcp, evaluateTemperatureLog, requiresChangeover, traceRecall } from './quality.js';

export type { GrainStoreConditions, SpoilageConditions, SpoilageStep } from './spoilage.js';
export {
  MOULD_CONDEMNATION_INDEX,
  PEST_CONDEMNATION_INDEX,
  RANCIDITY_CONDEMNATION_INDEX,
  mouldGrowthRateFactor,
  pestPressureRateFactor,
  rancidityRateFactor,
  stepMouldGrowth,
  stepPestPressure,
  stepRancidity,
  temperatureFactor,
  waterActivityFactor,
} from './spoilage.js';

export type { Difficulty, InspectionFinding, InspectionResult } from './regulator.js';
export { inspect } from './regulator.js';
