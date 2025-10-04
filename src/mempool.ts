import axios from "axios";
import { type Network } from "./config";

export type AddressSummary = {
  chain_stats: {
    tx_count: number,
    funded_txo_sum: number,
    spent_txo_sum: number
  },
  mempool_stats: {
    tx_count: number,
    funded_txo_sum: number,
    spent_txo_sum: number
  }
}

export type Transaction = {
  txid: string,
  vout: Array<{
    scriptpubkey_asm: string,
    scriptpubkey_type: "op_return",
    scriptpubkey_address: undefined,
    value: 0
  } | {
    scriptpubkey_asm: string,
    scriptpubkey_type: string,
    scriptpubkey_address: string,
    value: number
  }>
}

export type Utxo = {
  txid: string;
  vout: number;
  value: number;
}

export class MempoolApiClient {
  private baseUrl: string;

  constructor(network: Network) {
    this.baseUrl = network === 'mainnet'
      ? 'https://mempool.space/api'
      : `https://mempool.space/${network}/api`;
  }

  async getCurrentHeight(): Promise<number> {
    return axios.get(`${this.baseUrl}/blocks/tip/height`).then(res => res.data);
  }

  async getAddressBalance(address: string) {
    const summary = await axios.get<AddressSummary>(`${this.baseUrl}/address/${address}`)
      .then(res => res.data);
    const used = (summary.chain_stats.tx_count + summary.mempool_stats.tx_count) > 0;
    const balance = (summary.chain_stats.funded_txo_sum + summary.mempool_stats.funded_txo_sum) - (summary.chain_stats.spent_txo_sum + summary.mempool_stats.spent_txo_sum)
    return {
      used,
      balance
    }
  }

  async getAddressUtxos(address: string) {
    return axios.get<Utxo[]>(`${this.baseUrl}/address/${address}/utxo`)
      .then(res => res.data);
  }

  async getAddressTransactions(address: string) {
    return axios.get<Transaction[]>(`${this.baseUrl}/address/${address}/txs`)
      .then(res => res.data);
  }

  async getTransactionHex(txid: string): Promise<string> {
    return axios.get<string>(`${this.baseUrl}/tx/${txid}/hex`)
      .then(res => res.data);
  }

  async broadcastTransaction(rawTxHex: string): Promise<void> {
    await axios.post<{ txid: string }>(`${this.baseUrl}/tx`, rawTxHex, {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}