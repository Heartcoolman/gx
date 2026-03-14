// Mirror of Rust incentive types

export type IncentiveType = 'departure_discount' | 'arrival_reward';

export type IncentiveReason = 'surplus' | 'predicted_shortage' | 'rebalancing';

export interface PriceIncentive {
  station_id: number;
  incentive_type: IncentiveType;
  discount_percent: number;
  reward_credits: number;
  valid_from: string;
  valid_until: string;
  reason: IncentiveReason;
}
