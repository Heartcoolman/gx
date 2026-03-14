import axios from 'axios';
import type {
  ObserveReq, ObserveResp,
  CycleReq, CycleResp,
  BatchPredictReq, BatchPredictResp,
  SystemConfig,
} from '../types/api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (globalThis as any).process?.env ?? {};
const baseURL: string = env.API_BASE_URL ?? '/api/v1';

const http = axios.create({ baseURL, timeout: 10000 });

export async function observeRides(req: ObserveReq): Promise<ObserveResp> {
  const { data } = await http.post<ObserveResp>('/predict/observe', req);
  return data;
}

export async function rebalanceCycle(req: CycleReq): Promise<CycleResp> {
  const { data } = await http.post<CycleResp>('/rebalance/cycle', req);
  return data;
}

export async function batchPredict(req: BatchPredictReq): Promise<BatchPredictResp> {
  const { data } = await http.post<BatchPredictResp>('/predict/demand/batch', req);
  return data;
}

export async function getConfig(): Promise<SystemConfig> {
  const { data } = await http.get<SystemConfig>('/config');
  return data;
}

export async function updateConfig(config: SystemConfig): Promise<SystemConfig> {
  const { data } = await http.put<SystemConfig>('/config', config);
  return data;
}

export async function resetPredictor(): Promise<void> {
  await http.post('/predict/reset');
}
