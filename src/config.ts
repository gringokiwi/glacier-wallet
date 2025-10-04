import * as bitcoin from 'bitcoinjs-lib';

export const MNEMONIC_PHRASE = "orphan tomorrow volcano pact enhance buffalo hurdle deal lucky exotic salute tenant";

export const networkConfig = {
  mainnet: {
    network: bitcoin.networks.bitcoin,
    path: "m/84'/0'/0'"
  },
  testnet4: {
    network: bitcoin.networks.testnet,
    path: "m/84'/1'/0'"
  }
};
export type Network = keyof typeof networkConfig;
export const NETWORK: Network = "testnet4";